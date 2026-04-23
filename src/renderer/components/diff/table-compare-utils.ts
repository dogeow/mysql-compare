import type { ColumnInfo } from '../../../shared/types'

export function buildRowKey(
  row: Record<string, unknown>,
  keyColumns: string[]
): string | null {
  if (keyColumns.length === 0) return null

  return JSON.stringify(
    keyColumns.map((column) => ({
      column,
      value: row[column]
    }))
  )
}

export function buildCopyValues(
  row: Record<string, unknown>,
  targetColumns: ColumnInfo[]
): Record<string, unknown> {
  return targetColumns.reduce<Record<string, unknown>>((values, column) => {
    if (!(column.name in row)) return values
    return {
      ...values,
      [column.name]: row[column.name]
    }
  }, {})
}