// Preload：唯一允许调用 ipcRenderer 的地方。通过 contextBridge 把强类型 API 暴露给 renderer。
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  ConnectionConfig,
  CopyTableRequest,
  DatabaseDiff,
  DiffRequest,
  DeleteRowsRequest,
  DropTableRequest,
  ExportTableRequest,
  ExportTableResult,
  InsertRowRequest,
  IPCResult,
  QueryRowsRequest,
  QueryRowsResult,
  RenameTableRequest,
  SafeConnection,
  SyncPlan,
  SyncProgressEvent,
  SyncRequest,
  TableSchema,
  UpdateRowRequest
} from '../shared/types'

const invoke = <T,>(channel: string, payload?: unknown): Promise<IPCResult<T>> =>
  ipcRenderer.invoke(channel, payload)

const api = {
  connection: {
    list: () => invoke<SafeConnection[]>(IPC.ConnectionList),
    upsert: (conn: ConnectionConfig) => invoke<SafeConnection>(IPC.ConnectionUpsert, conn),
    remove: (id: string) => invoke<void>(IPC.ConnectionDelete, id),
    test: (conn: ConnectionConfig) => invoke<{ message: string }>(IPC.ConnectionTest, conn)
  },
  db: {
    listDatabases: (connectionId: string) =>
      invoke<string[]>(IPC.ListDatabases, { connectionId }),
    listTables: (connectionId: string, database: string) =>
      invoke<string[]>(IPC.ListTables, { connectionId, database }),
    queryRows: (req: QueryRowsRequest) => invoke<QueryRowsResult>(IPC.QueryRows, req),
    insertRow: (req: InsertRowRequest) => invoke(IPC.InsertRow, req),
    updateRow: (req: UpdateRowRequest) => invoke(IPC.UpdateRow, req),
    deleteRows: (req: DeleteRowsRequest) => invoke(IPC.DeleteRows, req),
    executeSQL: (connectionId: string, sql: string, database?: string) =>
      invoke(IPC.ExecuteSQL, { connectionId, sql, database }),
    renameTable: (req: RenameTableRequest) => invoke<{ table: string }>(IPC.RenameTable, req),
    copyTable: (req: CopyTableRequest) => invoke<{ table: string }>(IPC.CopyTable, req),
    dropTable: (req: DropTableRequest) => invoke<void>(IPC.DropTable, req),
    exportTable: (req: ExportTableRequest) => invoke<ExportTableResult>(IPC.ExportTable, req)
  },
  schema: {
    getTable: (connectionId: string, database: string, table: string) =>
      invoke<TableSchema>(IPC.GetTableSchema, { connectionId, database, table })
  },
  diff: {
    databases: (req: DiffRequest) => invoke<DatabaseDiff>(IPC.DiffDatabases, req)
  },
  sync: {
    buildPlan: (req: SyncRequest) => invoke<SyncPlan>(IPC.BuildSyncPlan, req),
    execute: (req: SyncRequest) => invoke<{ executed: number; errors: number }>(IPC.ExecuteSync, req),
    onProgress: (cb: (e: SyncProgressEvent) => void) => {
      const listener = (_: IpcRendererEvent, e: SyncProgressEvent) => cb(e)
      ipcRenderer.on(IPC.SyncProgress, listener)
      return () => {
        ipcRenderer.off(IPC.SyncProgress, listener)
      }
    }
  }
}

export type AppAPI = typeof api

contextBridge.exposeInMainWorld('api', api)
