import type { DatabaseDiff, TableDiff, TableRowComparison } from '../../../shared/types'

export const TABLE_COMPARE_CONCURRENCY_OPTIONS = [1, 2, 3, 5, 8] as const
export const DEFAULT_TABLE_COMPARE_CONCURRENCY = 3
export const DEFAULT_TABLE_STATUS_FILTER = 'all'
export const DEFAULT_DIFF_RESULT_TAB = 'status'
export const DEFAULT_COMPARE_SETUP_EXPANDED = true
export const DEFAULT_SOURCE_TABLES_EXPANDED = false
export const DEFAULT_TARGET_TABLES_EXPANDED = false
export const DEFAULT_TABLE_SEARCH_QUERY = ''
export const DIFF_PANEL_PREFERENCES_KEY = 'mysql-compare:diff-panel-preferences'

export type TableCompareStatus = 'queued' | 'comparing' | 'done' | 'error'
export type TableStatusFilter = 'all' | 'comparing' | 'changed' | 'schema-changed' | 'row-changed'
export type DiffResultTab = 'status' | 'schema' | 'data'

export interface DiffPanelPreferences {
  statusFilter: TableStatusFilter
  tableCompareConcurrency: number
  resultTab: DiffResultTab
  setupExpanded: boolean
  sourceTablesExpanded: boolean
  targetTablesExpanded: boolean
  tableSearchQuery: string
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
  filter: TableStatusFilter,
  searchQuery = ''
): TableCompareEntry[] {
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredByStatus =
    filter === 'all'
      ? entries
      : filter === 'comparing'
        ? entries.filter((entry) => entry.status === 'comparing')
        : filter === 'schema-changed'
          ? entries.filter(hasSchemaChangedEntry)
          : filter === 'row-changed'
            ? entries.filter(hasRowChangedEntry)
            : entries.filter(hasChangedEntry)

  if (!normalizedQuery) return filteredByStatus

  return filteredByStatus.filter((entry) => entry.table.toLowerCase().includes(normalizedQuery))
}

export function prioritizeComparisonEntries(entries: TableCompareEntry[]): TableCompareEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const leftPriority = left.entry.status === 'error' ? 0 : 1
      const rightPriority = right.entry.status === 'error' ? 0 : 1
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority
      }
      return left.index - right.index
    })
    .map(({ entry }) => entry)
}

export function getPreferredComparisonTable(
  entries: TableCompareEntry[],
  currentTable: string | null
): string | null {
  if (currentTable && entries.some((entry) => entry.table === currentTable)) {
    return currentTable
  }

  return entries.find((entry) => entry.status === 'error')?.table ?? entries[0]?.table ?? null
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
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY,
      resultTab: DEFAULT_DIFF_RESULT_TAB,
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      sourceTablesExpanded: DEFAULT_SOURCE_TABLES_EXPANDED,
      targetTablesExpanded: DEFAULT_TARGET_TABLES_EXPANDED,
      tableSearchQuery: DEFAULT_TABLE_SEARCH_QUERY
    }
  }

  try {
    const parsed = JSON.parse(raw) as {
      statusFilter?: unknown
      tableCompareConcurrency?: unknown
      resultTab?: unknown
      setupExpanded?: unknown
      sourceTablesExpanded?: unknown
      targetTablesExpanded?: unknown
      tableSearchQuery?: unknown
    }

    return {
      statusFilter: parseTableStatusFilter(parsed.statusFilter),
      tableCompareConcurrency: parseTableCompareConcurrency(String(parsed.tableCompareConcurrency ?? '')),
      resultTab: parseDiffResultTab(parsed.resultTab),
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      sourceTablesExpanded: parseBooleanPreference(
        parsed.sourceTablesExpanded,
        DEFAULT_SOURCE_TABLES_EXPANDED
      ),
      targetTablesExpanded: parseBooleanPreference(
        parsed.targetTablesExpanded,
        DEFAULT_TARGET_TABLES_EXPANDED
      ),
      tableSearchQuery: parseStringPreference(parsed.tableSearchQuery, DEFAULT_TABLE_SEARCH_QUERY)
    }
  } catch {
    return {
      statusFilter: DEFAULT_TABLE_STATUS_FILTER,
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY,
      resultTab: DEFAULT_DIFF_RESULT_TAB,
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      sourceTablesExpanded: DEFAULT_SOURCE_TABLES_EXPANDED,
      targetTablesExpanded: DEFAULT_TARGET_TABLES_EXPANDED,
      tableSearchQuery: DEFAULT_TABLE_SEARCH_QUERY
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

function parseDiffResultTab(value: unknown): DiffResultTab {
  return value === 'status' || value === 'schema' || value === 'data'
    ? value
    : DEFAULT_DIFF_RESULT_TAB
}

function parseBooleanPreference(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function parseStringPreference(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}