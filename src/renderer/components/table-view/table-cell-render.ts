import type { ColumnInfo } from '../../../shared/types'

export function renderTableCellValue(value: unknown, column: ColumnInfo): string {
  if (value === null || value === undefined) return 'NULL'
  if (column.type === 'tinyint(1)') return value ? '✓' : '✗'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}