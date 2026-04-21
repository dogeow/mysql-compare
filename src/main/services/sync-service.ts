// 同步：根据 SyncRequest 生成 SQL 计划，可 dry-run（仅返回 SQL）或真实执行。
// 为了安全，所有破坏性操作（DROP / TRUNCATE）必须由用户在 UI 显式选择策略后才会出现在 plan 中。
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type {
  SyncPlan,
  SyncProgressEvent,
  SyncRequest,
  SyncStep,
  ColumnInfo
} from '../../shared/types'
import { mysqlService } from './mysql-service'
import { schemaService } from './schema-service'
import type { RowDataPacket } from 'mysql2'

export class SyncService {
  /** 生成同步计划（不执行） */
  async buildPlan(req: SyncRequest): Promise<SyncPlan> {
    const steps: SyncStep[] = []
    const [sourceTableList, targetTableList] = await Promise.all([
      mysqlService.listTables(req.sourceConnectionId, req.sourceDatabase),
      mysqlService.listTables(req.targetConnectionId, req.targetDatabase)
    ])
    const sourceTables = new Set(sourceTableList)
    const targetTables = new Set(targetTableList)
    const sourceTableName = (table: string) => quoteTable(req.sourceDatabase, table)
    const targetTableName = (table: string) => quoteTable(req.targetDatabase, table)

    for (const table of req.tables) {
      const sqls: string[] = []
      const description: string[] = []
      const existsInTarget = targetTables.has(table)
      const existsInSource = sourceTables.has(table)

      if (!existsInSource) {
        steps.push({
          table,
          description: existsInTarget
            ? 'only in target, skipped (drop manually if intended)'
            : 'missing in both source and target, skipped',
          sqls: []
        })
        continue
      }

      const sSchema = await schemaService.getTableSchema(
        req.sourceConnectionId,
        req.sourceDatabase,
        table
      )

      // ---- 结构 ----
      if (req.syncStructure) {
        if (existsInTarget) {
          switch (req.existingTableStrategy) {
            case 'skip':
              description.push('skip existing table')
              break
            case 'overwrite-structure':
              sqls.push(`DROP TABLE IF EXISTS ${targetTableName(table)};`)
              sqls.push(stripDefiner(sSchema.createSQL) + ';')
              description.push('drop & recreate target table')
              break
            case 'append-data':
            case 'truncate-and-import':
              description.push('keep target structure')
              break
          }
        } else {
          sqls.push(stripDefiner(sSchema.createSQL) + ';')
          description.push('create table')
        }
      }

      // ---- 数据 ----
      if (req.syncData) {
        if (existsInTarget && req.existingTableStrategy === 'truncate-and-import') {
          sqls.push(`TRUNCATE TABLE ${targetTableName(table)};`)
        }
        // 数据 dump 走流式插入，构建批量 INSERT；如果是 dryRun 只取前 N 行示意
        const sample = await this.dumpInserts(
          req.sourceConnectionId,
          sourceTableName(table),
          targetTableName(table),
          sSchema.columns,
          req.dryRun ? 50 : Number.MAX_SAFE_INTEGER
        )
        sqls.push(...sample)
        description.push(req.dryRun ? 'data preview (50 rows)' : 'data sync')
      }

      steps.push({ table, description: description.join(', ') || 'noop', sqls })
    }

    return { steps }
  }

  /** 真实执行：在目标库依次跑 SQL，并通过 SyncProgress 事件汇报进度 */
  async execute(req: SyncRequest): Promise<{ executed: number; errors: number }> {
    const plan = await this.buildPlan({ ...req, dryRun: false })
    const win = BrowserWindow.getAllWindows()[0]
    const emit = (e: SyncProgressEvent) => win?.webContents.send(IPC.SyncProgress, e)

    let executed = 0
    let errors = 0
    const total = plan.steps.reduce((s, x) => s + x.sqls.length, 0)
    let done = 0

    for (const step of plan.steps) {
      emit({ table: step.table, step: 'start', done, total, level: 'info', message: step.description })
      for (const sql of step.sqls) {
        try {
          await mysqlService.executeSQL(req.targetConnectionId, sql, req.targetDatabase)
          executed++
        } catch (err) {
          errors++
          emit({
            table: step.table,
            step: 'error',
            done,
            total,
            level: 'error',
            message: `${(err as Error).message} :: ${sql.slice(0, 200)}`
          })
        }
        done++
        if (done % 20 === 0 || done === total) {
          emit({ table: step.table, step: 'progress', done, total, level: 'info' })
        }
      }
      emit({ table: step.table, step: 'done', done, total, level: 'info' })
    }

    return { executed, errors }
  }

  private async dumpInserts(
    connectionId: string,
    sourceTableName: string,
    targetTableName: string,
    columns: ColumnInfo[],
    limit: number
  ): Promise<string[]> {
    const pool = await mysqlService.getPool(connectionId)
    const colNames = columns.map((c) => `\`${c.name}\``).join(', ')
    const limitClause = limit !== Number.MAX_SAFE_INTEGER ? `LIMIT ${limit}` : ''
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT ${colNames} FROM ${sourceTableName} ${limitClause}`
    )
    if (rows.length === 0) return []
    const sqls: string[] = []
    const batchSize = 200
    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize)
      const valuesSQL = chunk
        .map((row) => {
          const vals = columns.map((c) => formatValue(row[c.name]))
          return `(${vals.join(', ')})`
        })
        .join(',\n  ')
      sqls.push(`INSERT INTO ${targetTableName} (${colNames}) VALUES\n  ${valuesSQL};`)
    }
    return sqls
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
