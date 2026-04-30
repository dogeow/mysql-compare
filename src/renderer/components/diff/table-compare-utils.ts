import type { ColumnInfo, SyncRequest } from '../../../shared/types'

export interface BuildOverwriteTargetSyncRequestOptions {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  table: string
}

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

export function buildOverwriteTargetSyncRequest(
  options: BuildOverwriteTargetSyncRequestOptions
): SyncRequest & { dryRun: false } {
  return {
    sourceConnectionId: options.sourceConnectionId,
    sourceDatabase: options.sourceDatabase,
    targetConnectionId: options.targetConnectionId,
    targetDatabase: options.targetDatabase,
    tables: [options.table],
    syncStructure: true,
    syncData: true,
    existingTableStrategy: 'overwrite-structure',
    dryRun: false
  }
}