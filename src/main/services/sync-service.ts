// 同步：根据 SyncRequest 生成 SQL 计划，可 dry-run（仅返回 SQL）或真实执行。
// 为了安全，所有破坏性操作（DROP / TRUNCATE）必须由用户在 UI 显式选择策略后才会出现在 plan 中。
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type {
  SyncPlan,
  SyncProgressEvent,
  SyncRequest,
  SyncStep,
  ColumnInfo,
  TableSchema
} from '../../shared/types'
import { mysqlService } from './mysql-service'
import { schemaService } from './schema-service'
import type { RowDataPacket } from 'mysql2'

const PREVIEW_ROW_LIMIT = 50
const INSERT_BATCH_SIZE = 200

interface PreparedTableSync {
  table: string
  description: string
  schema: TableSchema
  setupSQLs: string[]
  dataRowLimit?: number
  skip: boolean
}

interface SyncContext {
  sourceTables: Set<string>
  targetTables: Set<string>
}

export class SyncService {
  /** 生成同步计划（不执行） */
  async buildPlan(req: SyncRequest): Promise<SyncPlan> {
    const steps: SyncStep[] = []
    const context = await this.loadSyncContext(req)

    for (const table of req.tables) {
      const prepared = await this.prepareTableSync(table, req, context, true)
      const sqls = [...prepared.setupSQLs]

      if (!prepared.skip && req.syncData) {
        for await (const sql of this.generateInsertStatements(prepared, req)) {
          sqls.push(sql)
        }
      }

      steps.push({ table, description: prepared.description, sqls })
    }

    return { steps }
  }

  /** 真实执行：在目标库依次跑 SQL，并通过 SyncProgress 事件汇报进度 */
  async execute(req: SyncRequest): Promise<{ executed: number; errors: number }> {
    const win = BrowserWindow.getAllWindows()[0]
    const emit = (e: SyncProgressEvent) => win?.webContents.send(IPC.SyncProgress, e)
    const context = await this.loadSyncContext(req)

    let executed = 0
    let errors = 0
    let done = 0
    let total = 0

    for (const table of req.tables) {
      const prepared = await this.prepareTableSync(table, req, context, false)
      emit({
        table: prepared.table,
        step: 'start',
        done,
        total,
        level: 'info',
        message: prepared.description
      })

      const statements: AsyncIterable<string> = this.iterateStatements(prepared, req)
      for await (const sql of statements) {
        total++
        try {
          await mysqlService.executeSQL(req.targetConnectionId, sql, req.targetDatabase)
          executed++
        } catch (err) {
          errors++
          emit({
            table: prepared.table,
            step: 'error',
            done,
            total,
            level: 'error',
            message: `${(err as Error).message} :: ${sql.slice(0, 200)}`
          })
        }
        done++
        if (done % 20 === 0 || done === total) {
          emit({ table: prepared.table, step: 'progress', done, total, level: 'info' })
        }
      }
      emit({ table: prepared.table, step: 'done', done, total, level: 'info' })
    }

    return { executed, errors }
  }

  private async loadSyncContext(req: SyncRequest): Promise<SyncContext> {
    const [sourceTableList, targetTableList] = await Promise.all([
      mysqlService.listTables(req.sourceConnectionId, req.sourceDatabase),
      mysqlService.listTables(req.targetConnectionId, req.targetDatabase)
    ])
    return {
      sourceTables: new Set(sourceTableList),
      targetTables: new Set(targetTableList)
    }
  }

  private async prepareTableSync(
    table: string,
    req: SyncRequest,
    context: SyncContext,
    preview: boolean
  ): Promise<PreparedTableSync> {
    const existsInTarget = context.targetTables.has(table)
    const existsInSource = context.sourceTables.has(table)

    if (!existsInSource) {
      return {
        table,
        description: existsInTarget
          ? 'only in target, skipped (drop manually if intended)'
          : 'missing in both source and target, skipped',
        schema: this.emptySchema(table),
        setupSQLs: [],
        skip: true
      }
    }

    const schema = await schemaService.getTableSchema(
      req.sourceConnectionId,
      req.sourceDatabase,
      table
    )
    const setupSQLs: string[] = []
    const description: string[] = []

    if (existsInTarget && req.existingTableStrategy === 'skip') {
      return {
        table,
        description: 'skip existing table',
        schema,
        setupSQLs,
        skip: true
      }
    }

    if (req.syncStructure) {
      if (existsInTarget) {
        switch (req.existingTableStrategy) {
          case 'overwrite-structure':
            setupSQLs.push(`DROP TABLE IF EXISTS ${quoteTable(req.targetDatabase, table)};`)
            setupSQLs.push(ensureSemicolon(stripDefiner(schema.createSQL)))
            description.push('drop & recreate target table')
            break
          case 'append-data':
          case 'truncate-and-import':
            description.push('keep target structure')
            break
        }
      } else {
        setupSQLs.push(ensureSemicolon(stripDefiner(schema.createSQL)))
        description.push('create table')
      }
    }

    if (req.syncData) {
      if (existsInTarget && req.existingTableStrategy === 'truncate-and-import') {
        setupSQLs.push(`TRUNCATE TABLE ${quoteTable(req.targetDatabase, table)};`)
      }
      description.push(preview ? `data preview (${PREVIEW_ROW_LIMIT} rows)` : 'data sync')
    }

    return {
      table,
      description: description.join(', ') || 'noop',
      schema,
      setupSQLs,
      dataRowLimit: preview && req.syncData ? PREVIEW_ROW_LIMIT : undefined,
      skip: false
    }
  }

  private emptySchema(table: string): TableSchema {
    return {
      name: table,
      columns: [],
      indexes: [],
      primaryKey: [],
      createSQL: ''
    }
  }

  private async *iterateStatements(
    prepared: PreparedTableSync,
    req: SyncRequest
  ): AsyncGenerator<string> {
    for (const sql of prepared.setupSQLs) {
      yield sql
    }

    if (!req.syncData || prepared.skip) {
      return
    }

    for await (const sql of this.generateInsertStatements(prepared, req)) {
      yield sql
    }
  }

  private async *generateInsertStatements(
    prepared: PreparedTableSync,
    req: SyncRequest
  ): AsyncGenerator<string> {
    const { schema } = prepared
    if (schema.columns.length === 0) {
      return
    }

    const pool = await mysqlService.getPool(req.sourceConnectionId, req.sourceDatabase)
    const sourceTableName = quoteTable(req.sourceDatabase, prepared.table)
    const targetTableName = quoteTable(req.targetDatabase, prepared.table)
    const columnList = schema.columns.map((column) => quoteIdent(column.name)).join(', ')
    const orderClause = buildStableOrderClause(schema.columns, schema.primaryKey)

    let offset = 0
    let remaining = prepared.dataRowLimit
    while (remaining === undefined || remaining > 0) {
      const batchLimit =
        remaining === undefined ? INSERT_BATCH_SIZE : Math.min(INSERT_BATCH_SIZE, remaining)
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${columnList} FROM ${sourceTableName} ${orderClause} LIMIT ${batchLimit} OFFSET ${offset}`
      )
      if (rows.length === 0) return

      yield buildInsertSQL(targetTableName, schema.columns, rows as Record<string, unknown>[])

      offset += rows.length
      if (remaining !== undefined) {
        remaining -= rows.length
      }
      if (rows.length < batchLimit) return
    }
  }
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function quoteTable(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`
}

/** SHOW CREATE TABLE 在某些环境含 DEFINER / 注释，移除以便迁移 */
function stripDefiner(sql: string): string {
  return sql.replace(/\sDEFINER=`[^`]+`@`[^`]+`/g, '')
}

function ensureSemicolon(sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) return ''
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

function buildInsertSQL(
  targetTableName: string,
  columns: ColumnInfo[],
  rows: Record<string, unknown>[]
): string {
  const columnList = columns.map((column) => quoteIdent(column.name)).join(', ')
  const valuesSQL = rows
    .map((row) => {
      const vals = columns.map((column) => formatValue(row[column.name]))
      return `(${vals.join(', ')})`
    })
    .join(',\n  ')
  return `INSERT INTO ${targetTableName} (${columnList}) VALUES\n  ${valuesSQL};`
}

function buildStableOrderClause(columns: ColumnInfo[], primaryKey: string[]): string {
  const stableColumns = primaryKey.length > 0 ? primaryKey : columns.map((column) => column.name)
  if (stableColumns.length === 0) return ''
  return `ORDER BY ${stableColumns.map((column) => `${quoteIdent(column)} ASC`).join(', ')}`
}

/** 把 JS 值转为安全的 SQL 字面量。仅用于内部生成的脚本，不接受外部 SQL 注入面 */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? '1' : '0'
  if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`
  if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`
  if (typeof v === 'object') {
    const s = JSON.stringify(v).replace(/\\/g, '\\\\').replace(/'/g, "''")
    return `'${s}'`
  }
  // 兜底：字符串类型转义单引号 + 反斜杠
  const s = String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")
  return `'${s}'`
}

export const syncService = new SyncService()
