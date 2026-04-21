// 集中管理 IPC channel 名，避免拼写错误。
export const IPC = {
  // 连接 CRUD
  ConnectionList: 'connection:list',
  ConnectionUpsert: 'connection:upsert',
  ConnectionDelete: 'connection:delete',
  ConnectionTest: 'connection:test',

  // MySQL 浏览
  ListDatabases: 'mysql:listDatabases',
  ListTables: 'mysql:listTables',
  QueryRows: 'mysql:queryRows',
  InsertRow: 'mysql:insertRow',
  UpdateRow: 'mysql:updateRow',
  DeleteRows: 'mysql:deleteRows',
  ExecuteSQL: 'mysql:executeSQL',
  RenameTable: 'mysql:renameTable',
  CopyTable: 'mysql:copyTable',
  DropTable: 'mysql:dropTable',
  ExportTable: 'mysql:exportTable',

  // 表结构
  GetTableSchema: 'schema:getTable',

  // Diff & Sync
  DiffDatabases: 'diff:databases',
  BuildSyncPlan: 'sync:buildPlan',
  ExecuteSync: 'sync:execute',

  // 事件 (main → renderer)
  SyncProgress: 'sync:progress'
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
