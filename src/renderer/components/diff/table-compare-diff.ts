import { buildRowKey } from './table-compare-utils'

export type RowDiffStatus = 'identical' | 'modified' | 'source-only' | 'target-only'

export interface RowDiffInfo {
  status: RowDiffStatus
  changedColumns: Set<string>
}

export interface RowDiffLookup {
  source: Map<string, RowDiffInfo>
  target: Map<string, RowDiffInfo>
}

export function buildRowDiffLookup(
  sourceRows: Record<string, unknown>[],
  targetRows: Record<string, unknown>[],
  keyColumns: string[],
  compareColumnNames: string[]
): RowDiffLookup | null {
  if (keyColumns.length === 0) return null

  const sourceByKey = indexRowsByKey(sourceRows, keyColumns)
  const targetByKey = indexRowsByKey(targetRows, keyColumns)
  const source = new Map<string, RowDiffInfo>()
  const target = new Map<string, RowDiffInfo>()

  for (const [key, sourceRow] of sourceByKey) {
    const targetRow = targetByKey.get(key)
    if (!targetRow) {
      source.set(key, { status: 'source-only', changedColumns: new Set() })
      continue
    }

    const changedColumns = getChangedColumns(sourceRow, targetRow, compareColumnNames)
    source.set(key, {
      status: changedColumns.size > 0 ? 'modified' : 'identical',
      changedColumns
    })
  }

  for (const [key, targetRow] of targetByKey) {
    const sourceRow = sourceByKey.get(key)
    if (!sourceRow) {
      target.set(key, { status: 'target-only', changedColumns: new Set() })
      continue
    }

    const changedColumns = getChangedColumns(sourceRow, targetRow, compareColumnNames)
    target.set(key, {
      status: changedColumns.size > 0 ? 'modified' : 'identical',
      changedColumns
    })
  }

  return { source, target }
}

function indexRowsByKey(
  rows: Record<string, unknown>[],
  keyColumns: string[]
): Map<string, Record<string, unknown>> {
  const indexed = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const key = buildRowKey(row, keyColumns)
    if (key) indexed.set(key, row)
  }
  return indexed
}

function getChangedColumns(
  sourceRow: Record<string, unknown>,
  targetRow: Record<string, unknown>,
  columnNames: string[]
): Set<string> {
  const changed = new Set<string>()

  for (const column of columnNames) {
    if (!areComparableValuesEqual(sourceRow[column], targetRow[column])) {
      changed.add(column)
    }
  }

  return changed
}

function areComparableValuesEqual(source: unknown, target: unknown): boolean {
  return (
    serializeComparableValue(normalizeComparableValue(source)) ===
    serializeComparableValue(normalizeComparableValue(target))
  )
}

function normalizeComparableValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return normalizeTemporalString(value)
  if (value instanceof Date) return formatDateTime(value)
  if (Array.isArray(value)) return value.map((item) => normalizeComparableValue(item))
  if (typeof value === 'object') return sortObjectKeys(value as Record<string, unknown>)
  return String(value)
}

function normalizeTemporalString(value: string): string {
  const trimmed = value.trim()
  const dateOnlyMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/)
  if (dateOnlyMatch) return dateOnlyMatch[1]!

  const dateTimeMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:?\d{2})?$/
  )
  if (!dateTimeMatch) return trimmed

  const milliseconds = dateTimeMatch[3] ? `.${dateTimeMatch[3]!.slice(0, 3)}` : ''
  return `${dateTimeMatch[1]!} ${dateTimeMatch[2]!}${milliseconds}`
}

function formatDateTime(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  const second = String(value.getSeconds()).padStart(2, '0')
  const millisecond = value.getMilliseconds()
  const fraction = millisecond > 0 ? `.${String(millisecond).padStart(3, '0')}` : ''
  return `${year}-${month}-${day} ${hour}:${minute}:${second}${fraction}`
}

function sortObjectKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeComparableValue(entryValue)])
  )
}

function serializeComparableValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
