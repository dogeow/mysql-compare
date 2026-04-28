// 集中管理 IPC channel 名，避免拼写错误。
export const IPC = {
  // 连接 CRUD
  ConnectionList: 'connection:list',
  ConnectionUpsert: 'connection:upsert',
  ConnectionDelete: 'connection:delete',
  ConnectionTest: 'connection:test',

  // 数据库浏览（引擎无关）
  ListDatabases: 'db:listDatabases',
  ListTables: 'db:listTables',
  QueryRows: 'db:queryRows',
  InsertRow: 'db:insertRow',
  UpdateRow: 'db:updateRow',
  DeleteRows: 'db:deleteRows',
  ExecuteSQL: 'db:executeSQL',
  RenameTable: 'db:renameTable',
  CopyTable: 'db:copyTable',
  DropTable: 'db:dropTable',
  TruncateTable: 'db:truncateTable',
  ExportTable: 'db:exportTable',
  ExportDatabase: 'db:exportDatabase',
  ImportTable: 'db:importTable',

  // 表结构
  GetTableSchema: 'schema:getTable',

  // Diff & Sync
  DiffDatabases: 'diff:databases',
  DiffTable: 'diff:table',
  BuildSyncPlan: 'sync:buildPlan',
  ExecuteSync: 'sync:execute',

  // 事件 (main → renderer)
  SyncProgress: 'sync:progress'
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
