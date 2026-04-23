import type { DatabaseDiff, TableDiff, TableRowComparison } from '../../../shared/types'

export const TABLE_COMPARE_CONCURRENCY_OPTIONS = [1, 2, 3, 5, 8] as const
export const DEFAULT_TABLE_COMPARE_CONCURRENCY = 3
export const DEFAULT_TABLE_STATUS_FILTER = 'all'
export const DIFF_PANEL_PREFERENCES_KEY = 'mysql-compare:diff-panel-preferences'

export type TableCompareStatus = 'queued' | 'comparing' | 'done' | 'error'
export type TableStatusFilter = 'all' | 'comparing' | 'changed' | 'schema-changed' | 'row-changed'

export interface DiffPanelPreferences {
  statusFilter: TableStatusFilter
  tableCompareConcurrency: number
}

export interface TableCompareEntry {
  table: string
  sourceExists: boolean
  targetExists: boolean
  status: TableCompareStatus
  tableDiff: TableDiff | null
  rowComparison: TableRowComparison | null
  error?: string
}

export function buildInitialComparisonEntries(
  sourceTables: string[],
  targetTables: string[]
): TableCompareEntry[] {
  const sourceSet = new Set(sourceTables)
  const targetSet = new Set(targetTables)

  return Array.from(new Set([...sourceTables, ...targetTables]))
    .sort((left, right) => left.localeCompare(right))
    .map((table) => {
      const sourceExists = sourceSet.has(table)
      const targetExists = targetSet.has(table)

      if (sourceExists && !targetExists) {
        return {
          table,
          sourceExists,
          targetExists,
          status: 'done',
          tableDiff: { table, kind: 'only-in-source', columnDiffs: [], indexDiffs: [] },
          rowComparison: null
        } satisfies TableCompareEntry
      }

      if (!sourceExists && targetExists) {
        return {
          table,
          sourceExists,
          targetExists,
          status: 'done',
          tableDiff: { table, kind: 'only-in-target', columnDiffs: [], indexDiffs: [] },
          rowComparison: null
        } satisfies TableCompareEntry
      }

      return {
        table,
        sourceExists,
        targetExists,
        status: 'queued',
        tableDiff: null,
        rowComparison: null
      } satisfies TableCompareEntry
    })
}

export function buildDatabaseDiff(
  sourceDatabase: string,
  targetDatabase: string,
  entries: TableCompareEntry[]
): DatabaseDiff {
  return {
    sourceDatabase,
    targetDatabase,
    tableDiffs: entries.flatMap((entry) => (entry.tableDiff ? [entry.tableDiff] : [])),
    rowComparisons: entries.flatMap((entry) => (entry.rowComparison ? [entry.rowComparison] : []))
  }
}

export function updateTableEntry(
  entries: TableCompareEntry[],
  table: string,
  update: (entry: TableCompareEntry) => TableCompareEntry
): TableCompareEntry[] {
  return entries.map((entry) => (entry.table === table ? update(entry) : entry))
}

export async function runWithConcurrencyLimit<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return

  const workerCount = Math.min(Math.max(concurrency, 1), items.length)
  let nextIndex = 0

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex]
        nextIndex += 1
        if (item === undefined) return
        await worker(item)
      }
    })
  )
}

export function hasNoRowDifferences({ dataDiff }: TableRowComparison): boolean {
  return (
    dataDiff.comparable &&
    dataDiff.sourceOnly === 0 &&
    dataDiff.targetOnly === 0 &&
    dataDiff.modified === 0
  )
}

export function filterComparisonEntries(
  entries: TableCompareEntry[],
  filter: TableStatusFilter
): TableCompareEntry[] {
  if (filter === 'all') return entries
  if (filter === 'comparing') return entries.filter((entry) => entry.status === 'comparing')
  if (filter === 'schema-changed') return entries.filter(hasSchemaChangedEntry)
  if (filter === 'row-changed') return entries.filter(hasRowChangedEntry)
  return entries.filter(hasChangedEntry)
}

export function parseTableCompareConcurrency(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return TABLE_COMPARE_CONCURRENCY_OPTIONS.includes(
    parsed as (typeof TABLE_COMPARE_CONCURRENCY_OPTIONS)[number]
  )
    ? parsed
    : DEFAULT_TABLE_COMPARE_CONCURRENCY
}

export function parseDiffPanelPreferences(raw: string | null | undefined): DiffPanelPreferences {
  if (!raw) {
    return {
      statusFilter: DEFAULT_TABLE_STATUS_FILTER,
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY
    }
  }

  try {
    const parsed = JSON.parse(raw) as {
      statusFilter?: unknown
      tableCompareConcurrency?: unknown
    }

    return {
      statusFilter: parseTableStatusFilter(parsed.statusFilter),
      tableCompareConcurrency: parseTableCompareConcurrency(String(parsed.tableCompareConcurrency ?? ''))
    }
  } catch {
    return {
      statusFilter: DEFAULT_TABLE_STATUS_FILTER,
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY
    }
  }
}

export function hasSchemaOrPresenceDiff(tableDiff: TableDiff): boolean {
  return (
    tableDiff.kind !== 'modified' ||
    tableDiff.columnDiffs.length > 0 ||
    tableDiff.indexDiffs.length > 0
  )
}

function hasChangedEntry(entry: TableCompareEntry): boolean {
  if (entry.status === 'error') return true
  return hasSchemaChangedEntry(entry) || hasRowChangedEntry(entry)
}

function hasSchemaChangedEntry(entry: TableCompareEntry): boolean {
  if (!entry.sourceExists || !entry.targetExists) return true
  return entry.tableDiff ? hasSchemaOrPresenceDiff(entry.tableDiff) : false
}

function hasRowChangedEntry(entry: TableCompareEntry): boolean {
  if (!entry.rowComparison?.dataDiff.comparable) return false
  return !hasNoRowDifferences(entry.rowComparison)
}

function parseTableStatusFilter(value: unknown): TableStatusFilter {
  return value === 'comparing' ||
    value === 'changed' ||
    value === 'schema-changed' ||
    value === 'row-changed'
    ? value
    : DEFAULT_TABLE_STATUS_FILTER
}