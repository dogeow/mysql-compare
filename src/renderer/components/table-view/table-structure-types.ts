export interface PendingAction {
  title: string
  description: string
  sql: string
  successMessage: string
}

export interface ColumnDraft {
  originalName: string
  name: string
  type: string
  nullable: boolean
  defaultValue: string
  useDefault: boolean
  comment: string
  isAutoIncrement: boolean
}

export interface IndexDraft {
  mode: 'add' | 'edit'
  originalName?: string
  name: string
  columns: string[]
  unique: boolean
  primary: boolean
  type: string
}