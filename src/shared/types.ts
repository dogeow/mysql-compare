// 跨进程共享的所有类型定义。renderer / preload / main 都从这里导入，保证类型一致。

// ---------- 连接 ----------
export interface ConnectionConfig {
  id: string
  name: string
  group?: string
  host: string
  port: number
  username: string
  /** 仅在写入时携带；读取时不会回传明文，渲染端只能拿到 hasPassword 标记 */
  password?: string
  database?: string
  // SSH Tunnel
  useSSH: boolean
  sshHost?: string
  sshPort?: number
  sshUsername?: string
  sshPassword?: string
  sshPrivateKey?: string
  sshPassphrase?: string
  createdAt: number
  updatedAt: number
}

/** 渲染端能看到的安全版本：去除明文密码，附带 hasPassword 标记 */
export type SafeConnection = Omit<
  ConnectionConfig,
  'password' | 'sshPassword' | 'sshPrivateKey' | 'sshPassphrase'
> & {
  hasPassword: boolean
  hasSSHPassword: boolean
  hasSSHPrivateKey: boolean
}

// ---------- 表 / 字段 ----------
export interface ColumnInfo {
  name: string
  type: string                // 原始 column type, e.g. varchar(255)
  nullable: boolean
  defaultValue: string | null
  isPrimaryKey: boolean
  isAutoIncrement: boolean
  comment: string
  /** raw COLUMN_KEY: PRI/UNI/MUL/'' */
  columnKey: string
}

export interface IndexInfo {
  name: string
  columns: string[]
  unique: boolean
  type: string                // BTREE / HASH / FULLTEXT
}

export interface TableSchema {
  name: string
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  primaryKey: string[]
  createSQL: string
  rowEstimate?: number
  engine?: string
  charset?: string
  tableComment?: string
  dataLength?: number
  indexLength?: number
  dataFree?: number
  avgRowLength?: number
  autoIncrement?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

// ---------- 行查询 ----------
export interface QueryRowsRequest {
  connectionId: string
  database: string
  table: string
  page: number                // 1-based
  pageSize: number
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  where?: string              // 简单 where 片段（不含 'WHERE'）
}

export interface QueryRowsResult {
  rows: Record<string, unknown>[]
  total: number
  hasPrimaryKey: boolean
  primaryKey: string[]
  columns: ColumnInfo[]
}

// ---------- 行写入 ----------
export interface InsertRowRequest {
  connectionId: string
  database: string
  table: string
  values: Record<string, unknown>
}

export interface UpdateRowRequest {
  connectionId: string
  database: string
  table: string
  /** 主键字段 → 旧值 */
  pkValues: Record<string, unknown>
  /** 待更新字段 → 新值 */
  changes: Record<string, unknown>
}

export interface DeleteRowsRequest {
  connectionId: string
  database: string
  table: string
  /** 每一行的主键键值对 */
  pkRows: Record<string, unknown>[]
}

// ---------- 表操作 ----------
export interface RenameTableRequest {
  connectionId: string
  database: string
  table: string
  newTable: string
}

export interface CopyTableRequest {
  connectionId: string
  database: string
  table: string
  targetTable: string
}

export interface DropTableRequest {
  connectionId: string
  database: string
  table: string
}

export type ExportFormat = 'sql' | 'csv' | 'txt'

export type ExportScope = 'all' | 'filtered' | 'page'

export interface ExportTableRequest {
  connectionId: string
  database: string
  table: string
  format: ExportFormat
  scope: ExportScope
  where?: string
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  page?: number
  pageSize?: number
  includeCreateTable?: boolean
  includeData?: boolean
  includeHeaders?: boolean
}

export interface ExportTableResult {
  canceled: boolean
  filePath?: string
  rowsExported: number
}

// ---------- Diff ----------
export type DiffKind = 'only-in-source' | 'only-in-target' | 'modified'

export interface ColumnDiff {
  name: string
  kind: DiffKind
  source?: ColumnInfo
  target?: ColumnInfo
}

export interface IndexDiff {
  name: string
  kind: DiffKind
  source?: IndexInfo
  target?: IndexInfo
}

export interface TableDiff {
  table: string
  kind: DiffKind
  columnDiffs: ColumnDiff[]
  indexDiffs: IndexDiff[]
}

export interface DatabaseDiff {
  sourceDatabase: string
  targetDatabase: string
  tableDiffs: TableDiff[]
}

export interface DiffRequest {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
}

// ---------- Sync ----------
export type ExistingTableStrategy = 'skip' | 'overwrite-structure' | 'append-data' | 'truncate-and-import'

export interface SyncRequest {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  /** 选中的表 */
  tables: string[]
  /** 同步内容 */
  syncStructure: boolean
  syncData: boolean
  existingTableStrategy: ExistingTableStrategy
  /** dry-run: 只生成 SQL 不执行 */
  dryRun: boolean
}

export interface SyncPlan {
  /** 顺序执行的 SQL 列表，按表分组 */
  steps: SyncStep[]
}

export interface SyncStep {
  table: string
  description: string
  sqls: string[]
}

export interface SyncProgressEvent {
  table: string
  step: string
  done: number
  total: number
  message?: string
  level: 'info' | 'warn' | 'error'
}

// ---------- 通用结果 ----------
export interface IPCResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
