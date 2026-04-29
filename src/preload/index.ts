// Preload：唯一允许调用 ipcRenderer 的地方。通过 contextBridge 把强类型 API 暴露给 renderer。
import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  ConnectionConfig,
  CopyTableRequest,
  DatabaseDiff,
  DiffRequest,
  DeleteRowsRequest,
  DropTableRequest,
  ExportDatabaseRequest,
  ExportDatabaseResult,
  ExportTableRequest,
  ExportTableResult,
  ImportTableRequest,
  ImportTableResult,
  InsertRowRequest,
  IPCResult,
  QueryRowsRequest,
  QueryRowsResult,
  RenameTableRequest,
  SafeConnection,
  SSHCreateDirectoryRequest,
  SSHDeleteFileRequest,
  SSHDownloadDirectoryRequest,
  SSHDownloadFileRequest,
  SSHFileOperationResult,
  SSHListFilesRequest,
  SSHListFilesResult,
  SSHMoveFileRequest,
  SSHReadFileRequest,
  SSHReadFileResult,
  SSHUploadDirectoryRequest,
  SSHUploadEntriesRequest,
  SSHUploadFileRequest,
  SSHWriteFileRequest,
  SyncPlan,
  SyncProgressEvent,
  SyncRequest,
  TableComparisonResult,
  TableDiffRequest,
  TableSchema,
  TruncateTableRequest,
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
    truncateTable: (req: TruncateTableRequest) => invoke<void>(IPC.TruncateTable, req),
    exportTable: (req: ExportTableRequest) => invoke<ExportTableResult>(IPC.ExportTable, req),
    exportDatabase: (req: ExportDatabaseRequest) => invoke<ExportDatabaseResult>(IPC.ExportDatabase, req),
    importTable: (req: ImportTableRequest) => invoke<ImportTableResult>(IPC.ImportTable, req)
  },
  schema: {
    getTable: (connectionId: string, database: string, table: string) =>
      invoke<TableSchema>(IPC.GetTableSchema, { connectionId, database, table })
  },
  ssh: {
    listFiles: (req: SSHListFilesRequest) => invoke<SSHListFilesResult>(IPC.SSHListFiles, req),
    uploadFile: (req: SSHUploadFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHUploadFile, req),
    uploadDirectory: (req: SSHUploadDirectoryRequest) => invoke<SSHFileOperationResult>(IPC.SSHUploadDirectory, req),
    uploadEntries: (req: SSHUploadEntriesRequest) => invoke<SSHFileOperationResult>(IPC.SSHUploadEntries, req),
    downloadFile: (req: SSHDownloadFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHDownloadFile, req),
    downloadDirectory: (req: SSHDownloadDirectoryRequest) => invoke<SSHFileOperationResult>(IPC.SSHDownloadDirectory, req),
    readFile: (req: SSHReadFileRequest) => invoke<SSHReadFileResult>(IPC.SSHReadFile, req),
    writeFile: (req: SSHWriteFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHWriteFile, req),
    createDirectory: (req: SSHCreateDirectoryRequest) => invoke<SSHFileOperationResult>(IPC.SSHCreateDirectory, req),
    deleteFile: (req: SSHDeleteFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHDeleteFile, req),
    moveFile: (req: SSHMoveFileRequest) => invoke<SSHFileOperationResult>(IPC.SSHMoveFile, req)
  },
  system: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  diff: {
    databases: (req: DiffRequest) => invoke<DatabaseDiff>(IPC.DiffDatabases, req),
    table: (req: TableDiffRequest) => invoke<TableComparisonResult>(IPC.DiffTable, req)
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
