// 渲染端 IPC 入口：从 preload 暴露的 window.api 读取强类型方法。
import type { AppAPI } from '../../preload'
import type {
  CopyTableRequest,
  DropTableRequest,
  ExportTableRequest,
  ExportTableResult,
  IPCResult,
  RenameTableRequest
} from '../../shared/types'

declare global {
  interface Window {
    api: AppAPI
  }
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function quoteTable(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`
}

function okResult<T>(data: T): IPCResult<T> {
  return { ok: true, data }
}

async function mapExecuteResult<T>(
  action: () => Promise<IPCResult<unknown>>,
  data: T
): Promise<IPCResult<T>> {
  const result = await action()
  if (!result.ok) {
    return { ok: false, error: result.error }
  }
  return okResult(data)
}

const rawApi = window.api

const mysql = {
  ...rawApi.mysql,
  renameTable:
    rawApi.mysql.renameTable ??
    ((req: RenameTableRequest) =>
      mapExecuteResult(
        () =>
          rawApi.mysql.executeSQL(
            req.connectionId,
            `RENAME TABLE ${quoteTable(req.database, req.table)} TO ${quoteTable(req.database, req.newTable)}`,
            req.database
          ),
        { table: req.newTable.trim() }
      )),
  copyTable:
    rawApi.mysql.copyTable ??
    (async (req: CopyTableRequest) => {
      const sourceTable = quoteTable(req.database, req.table)
      const targetTable = quoteTable(req.database, req.targetTable)
      const createResult = await rawApi.mysql.executeSQL(
        req.connectionId,
        `CREATE TABLE ${targetTable} LIKE ${sourceTable}`,
        req.database
      )
      if (!createResult.ok) {
        return { ok: false, error: createResult.error }
      }

      const copyResult = await rawApi.mysql.executeSQL(
        req.connectionId,
        `INSERT INTO ${targetTable} SELECT * FROM ${sourceTable}`,
        req.database
      )
      if (!copyResult.ok) {
        await rawApi.mysql.executeSQL(
          req.connectionId,
          `DROP TABLE ${targetTable}`,
          req.database
        )
        return { ok: false, error: copyResult.error }
      }

      return okResult({ table: req.targetTable.trim() })
    }),
  dropTable:
    rawApi.mysql.dropTable ??
    ((req: DropTableRequest) =>
      mapExecuteResult(
        () =>
          rawApi.mysql.executeSQL(
            req.connectionId,
            `DROP TABLE ${quoteTable(req.database, req.table)}`,
            req.database
          ),
        undefined
      )),
  exportTable:
    rawApi.mysql.exportTable ??
    ((_req: ExportTableRequest) =>
      Promise.resolve({
        ok: false,
        error: 'Export requires restarting the app to load the latest preload API'
      } as IPCResult<ExportTableResult>))
}

export const api: AppAPI = {
  ...rawApi,
  mysql
}

/** 解包 IPCResult，错误时抛出 */
export async function unwrap<T>(p: Promise<IPCResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error || 'IPC error')
  return r.data as T
}
