// 同步：根据 SyncRequest 生成 SQL 计划，可 dry-run（仅返回 SQL）或真实执行。
// 所有方言相关的 DDL / 字面量格式化都委托给目标 driver 的 Dialect。
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type {
  SyncPlan,
  SyncProgressEvent,
  SyncRequest,
  SyncStep,
  TableSchema
} from '../../shared/types'
import { dbService } from './db-service'
import type { DbDriver } from './drivers/types'
import { buildCreateTableSQL } from './export-service'
import { schemaService } from './schema-service'

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
  sourceDriver: DbDriver
  targetDriver: DbDriver
  sourceTables: Set<string>
  targetTables: Set<string>
  crossEngine: boolean
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
        for await (const sql of this.generateInsertStatements(prepared, req, context)) {
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

      const statements = this.iterateStatements(prepared, req, context)
      for await (const sql of statements) {
        total++
        try {
          await context.targetDriver.executeSQL(sql, req.targetDatabase)
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
    const [sourceDriver, targetDriver] = await Promise.all([
      dbService.getDriver(req.sourceConnectionId),
      dbService.getDriver(req.targetConnectionId)
    ])
    const [sourceTableList, targetTableList] = await Promise.all([
      sourceDriver.listTables(req.sourceDatabase),
      targetDriver.listTables(req.targetDatabase)
    ])
    return {
      sourceDriver,
      targetDriver,
      sourceTables: new Set(sourceTableList),
      targetTables: new Set(targetTableList),
      crossEngine: sourceDriver.engine !== targetDriver.engine
    }
  }

  private async prepareTableSync(
    table: string,
    req: SyncRequest,
    context: SyncContext,
    preview: boolean
  ): Promise<PreparedTableSync> {
    const targetDialect = context.targetDriver.dialect
    const existsInTarget = context.targetTables.has(table)
    const existsInSource = context.sourceTables.has(table)

    if (!existsInSource) {
      return {
        table,
        description: existsInTarget
          ? 'only in target, skipped (drop manually if intended)'
          : 'missing in both source and target, skipped',
        schema: emptySchema(table),
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
    const targetScope = getTargetTableScope(context.targetDriver, req.targetDatabase)

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
            setupSQLs.push(targetDialect.renderDropIfExists(targetScope, table))
            setupSQLs.push(buildTargetCreateTableSQL(schema, req, context, targetScope))
            description.push('drop & recreate target table')
            break
          case 'append-data':
          case 'truncate-and-import':
            description.push(
              context.crossEngine ? 'reuse existing target structure' : 'keep target structure'
            )
            break
        }
      } else {
        setupSQLs.push(buildTargetCreateTableSQL(schema, req, context, targetScope))
        description.push('create table')
      }
    }

    if (req.syncData) {
      if (existsInTarget && req.existingTableStrategy === 'truncate-and-import') {
        setupSQLs.push(targetDialect.renderTruncate(targetScope, table))
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

  private async *iterateStatements(
    prepared: PreparedTableSync,
    req: SyncRequest,
    context: SyncContext
  ): AsyncGenerator<string> {
    for (const sql of prepared.setupSQLs) {
      yield sql
    }
    if (!req.syncData || prepared.skip) return
    for await (const sql of this.generateInsertStatements(prepared, req, context)) {
      yield sql
    }
  }

  private async *generateInsertStatements(
    prepared: PreparedTableSync,
    req: SyncRequest,
    context: SyncContext
  ): AsyncGenerator<string> {
    const { schema } = prepared
    if (schema.columns.length === 0) return

    const targetDialect = context.targetDriver.dialect
    const targetScope = getTargetTableScope(context.targetDriver, req.targetDatabase)
    const columnNames = schema.columns.map((c) => c.name)

    for await (const batch of context.sourceDriver.streamRows({
      database: req.sourceDatabase,
      table: prepared.table,
      columns: columnNames,
      primaryKey: schema.primaryKey,
      batchSize: INSERT_BATCH_SIZE,
      limit: prepared.dataRowLimit
    })) {
      yield targetDialect.renderInsert(targetScope, prepared.table, schema.columns, batch)
    }
  }
}

function buildTargetCreateTableSQL(
  schema: TableSchema,
  req: SyncRequest,
  context: SyncContext,
  targetScope: string
): string {
  if (context.sourceDriver.engine !== context.targetDriver.engine) {
    return buildCreateTableSQL(schema, targetScope, context.sourceDriver, context.targetDriver.engine, {
      includeDatabasePrelude: false
    })
  }

  if (context.targetDriver.engine === 'postgres') {
    return buildCreateTableSQL(schema, targetScope, context.sourceDriver, 'postgres', {
      includeDatabasePrelude: false
    })
  }

  if (context.targetDriver.engine === 'mysql') {
    return buildCreateTableSQL(schema, req.targetDatabase, context.sourceDriver, 'mysql', {
      includeDatabasePrelude: false
    })
  }

  return ensureSemicolon(context.targetDriver.dialect.stripDefiner(schema.createSQL))
}

function getTargetTableScope(targetDriver: DbDriver, targetDatabase: string): string {
  // PostgresDriver connects to the selected database and uses the public schema for table ops.
  return targetDriver.engine === 'postgres' ? 'public' : targetDatabase
}

function emptySchema(table: string): TableSchema {
  return {
    name: table,
    columns: [],
    indexes: [],
    primaryKey: [],
    createSQL: ''
  }
}

function ensureSemicolon(sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) return ''
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

export const syncService = new SyncService()
