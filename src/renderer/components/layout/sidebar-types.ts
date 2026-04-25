import type { SafeConnection } from '../../../shared/types'

export interface NodeState {
  expanded: boolean
  loading: boolean
  databases?: string[]
  tables: Record<string, string[]>
  expandedDbs: Set<string>
}

export interface TableMenuState {
  x: number
  y: number
  connection: SafeConnection
  database: string
  table: string
}

export interface RenameDialogState {
  connection: SafeConnection
  database: string
  table: string
}

export interface CreateSQLDialogState {
  title: string
  sql: string
  loading: boolean
}

export interface ExportDialogState {
  connectionId: string
  database: string
  table: string
}

export interface StickyDatabaseContext {
  connectionName: string
  database: string
}

export interface DatabaseRowRefEntry {
  element: HTMLDivElement | null
  connectionName: string
  database: string
}