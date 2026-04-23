// 数据库对比面板：先加载两边表列表，再逐表对比并渐进展示结果。
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, CircleDashed, LoaderCircle } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Select } from '@renderer/components/ui/select'
import { Label } from '@renderer/components/ui/label'
import { Badge } from '@renderer/components/ui/badge'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import type {
  DatabaseDiff,
  TableDataDiff,
  TableDataDiffSample,
  TableComparisonResult,
  TableDiff,
  TableRowComparison
} from '../../../shared/types'
import {
  buildDatabaseDiff,
  buildInitialComparisonEntries,
  DEFAULT_TABLE_COMPARE_CONCURRENCY,
  DIFF_PANEL_PREFERENCES_KEY,
  filterComparisonEntries,
  hasSchemaOrPresenceDiff,
  hasNoRowDifferences,
  parseDiffPanelPreferences,
  parseTableCompareConcurrency,
  runWithConcurrencyLimit,
  TABLE_COMPARE_CONCURRENCY_OPTIONS,
  type DiffPanelPreferences,
  type TableCompareEntry,
  type TableStatusFilter,
  updateTableEntry
} from './diff-panel-utils'
import { SyncPanel } from './SyncPanel'
import {
  requestTableComparison,
  supportsIncrementalTableDiff
} from './table-diff-request'

type ComparePhase = 'idle' | 'loading-tables' | 'comparing' | 'done'

interface CompareContext {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  compareData: boolean
}

export function DiffPanel() {
  const { connections, refresh } = useConnectionStore()
  const { setRightView, showToast } = useUIStore()

  const [srcId, setSrcId] = useState('')
  const [tgtId, setTgtId] = useState('')
  const [srcDb, setSrcDb] = useState('')
  const [tgtDb, setTgtDb] = useState('')
  const [srcDbs, setSrcDbs] = useState<string[]>([])
  const [tgtDbs, setTgtDbs] = useState<string[]>([])
  const [comparePhase, setComparePhase] = useState<ComparePhase>('idle')
  const [compareContext, setCompareContext] = useState<CompareContext | null>(null)
  const [sourceTables, setSourceTables] = useState<string[]>([])
  const [targetTables, setTargetTables] = useState<string[]>([])
  const [comparisonEntries, setComparisonEntries] = useState<TableCompareEntry[]>([])
  const [showSync, setShowSync] = useState(false)
  const [compareData, setCompareData] = useState(true)
  const [preferences, setPreferences] = useState<DiffPanelPreferences>(() =>
    loadStoredDiffPanelPreferences()
  )
  const compareRunIdRef = useRef(0)

  const statusFilter = preferences.statusFilter
  const tableCompareConcurrency = preferences.tableCompareConcurrency

  useEffect(() => {
    refresh()
  }, [refresh])

  const loadDbs = async (id: string, setter: (l: string[]) => void) => {
    if (!id) return
    try {
      setter(await unwrap(api.db.listDatabases(id)))
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  useEffect(() => {
    loadDbs(srcId, setSrcDbs)
  }, [srcId])
  useEffect(() => {
    loadDbs(tgtId, setTgtDbs)
  }, [tgtId])

  useEffect(() => {
    persistDiffPanelPreferences(preferences)
  }, [preferences])

  const diff = useMemo<DatabaseDiff | null>(() => {
    if (!compareContext) return null
    return buildDatabaseDiff(compareContext.sourceDatabase, compareContext.targetDatabase, comparisonEntries)
  }, [compareContext, comparisonEntries])

  const onCompare = async () => {
    if (!srcId || !tgtId || !srcDb || !tgtDb) {
      showToast('Select source/target connection and database', 'error')
      return
    }

    const runId = compareRunIdRef.current + 1
    compareRunIdRef.current = runId
    const nextContext: CompareContext = {
      sourceConnectionId: srcId,
      sourceDatabase: srcDb,
      targetConnectionId: tgtId,
      targetDatabase: tgtDb,
      compareData
    }

    setShowSync(false)
    setCompareContext(nextContext)
    setComparePhase('loading-tables')
    setSourceTables([])
    setTargetTables([])
    setComparisonEntries([])

    try {
      const [nextSourceTables, nextTargetTables] = await Promise.all([
        unwrap(api.db.listTables(srcId, srcDb)),
        unwrap(api.db.listTables(tgtId, tgtDb))
      ])
      if (compareRunIdRef.current !== runId) return

      const initialEntries = buildInitialComparisonEntries(nextSourceTables, nextTargetTables)
      const sharedTables = initialEntries
        .filter((entry) => entry.sourceExists && entry.targetExists)
        .map((entry) => entry.table)

      setSourceTables(nextSourceTables)
      setTargetTables(nextTargetTables)
      setComparisonEntries(initialEntries)

      if (sharedTables.length === 0) {
        setComparePhase('done')
        return
      }

      setComparePhase('comparing')

      const diffRouter: {
        databases: typeof api.diff.databases
        table?: typeof api.diff.table
      } = api.diff
      const usingCompatibilityMode = !supportsIncrementalTableDiff(diffRouter)

      let failedTables = 0

      await runWithConcurrencyLimit(sharedTables, tableCompareConcurrency, async (table) => {
        if (compareRunIdRef.current !== runId) return

        setComparisonEntries((entries) =>
          updateTableEntry(entries, table, (entry) => ({
            ...entry,
            status: 'comparing',
            error: undefined
          }))
        )

        try {
          const result = await unwrap<TableComparisonResult>(
            requestTableComparison(diffRouter, {
              sourceConnectionId: nextContext.sourceConnectionId,
              sourceDatabase: nextContext.sourceDatabase,
              targetConnectionId: nextContext.targetConnectionId,
              targetDatabase: nextContext.targetDatabase,
              table,
              includeData: nextContext.compareData
            })
          )
          if (compareRunIdRef.current !== runId) return

          setComparisonEntries((entries) =>
            updateTableEntry(entries, table, (entry) => ({
              ...entry,
              status: 'done',
              tableDiff: result.tableDiff,
              rowComparison: result.rowComparison,
              error: undefined
            }))
          )
        } catch (err) {
          failedTables += 1
          if (compareRunIdRef.current !== runId) return

          setComparisonEntries((entries) =>
            updateTableEntry(entries, table, (entry) => ({
              ...entry,
              status: 'error',
              tableDiff: null,
              rowComparison: null,
              error: (err as Error).message
            }))
          )
        }
      })

      if (compareRunIdRef.current !== runId) return

      setComparePhase('done')
      if (usingCompatibilityMode) {
        showToast(
          'Using compatibility mode for this session. Restart the app to re-enable the dedicated incremental diff IPC.',
          'info'
        )
      }
      if (failedTables > 0) {
        showToast(`Failed to compare ${failedTables} table(s)`, 'error')
      }
    } catch (err) {
      if (compareRunIdRef.current !== runId) return
      setCompareContext(null)
      setComparePhase('idle')
      setSourceTables([])
      setTargetTables([])
      setComparisonEntries([])
      showToast((err as Error).message, 'error')
    }
  }

  const connOptions = [
    { value: '', label: '— select —' },
    ...connections.map((c) => ({ value: c.id, label: c.name }))
  ]
  const sourceConnection = connections.find(
    (connection) => connection.id === (compareContext?.sourceConnectionId ?? srcId)
  )
  const targetConnection = connections.find(
    (connection) => connection.id === (compareContext?.targetConnectionId ?? tgtId)
  )
  const loading = comparePhase === 'loading-tables' || comparePhase === 'comparing'
  const visibleSchemaDiffs = diff?.tableDiffs.filter(hasSchemaOrPresenceDiff) ?? []
  const rowCompareSummary = diff ? summarizeRowComparisons(diff.rowComparisons) : null
  const filteredComparisonEntries = useMemo(
    () => filterComparisonEntries(comparisonEntries, statusFilter),
    [comparisonEntries, statusFilter]
  )
  const fullyIdentical = diff
    ? comparePhase === 'done' && diff.tableDiffs.length === 0 && (!compareContext?.compareData || diff.rowComparisons.every(hasNoRowDifferences))
    : false
  const hasSkippedRowComparison = diff?.rowComparisons.some(
    ({ dataDiff }) => !dataDiff.comparable
  ) ?? false
  const sharedTableCount = comparisonEntries.filter(
    (entry) => entry.sourceExists && entry.targetExists
  ).length
  const completedSharedTableCount = comparisonEntries.filter(
    (entry) => entry.sourceExists && entry.targetExists && (entry.status === 'done' || entry.status === 'error')
  ).length

  const openComparedTable = (side: 'source' | 'target', table: string) => {
    if (!compareContext) return

    const connectionId =
      side === 'source' ? compareContext.sourceConnectionId : compareContext.targetConnectionId
    const database = side === 'source' ? compareContext.sourceDatabase : compareContext.targetDatabase

    setRightView({ kind: 'table', connectionId, database, table })
  }

  const openCompareView = (table: string) => {
    if (!compareContext) return

    setRightView({
      kind: 'table-compare',
      sourceConnectionId: compareContext.sourceConnectionId,
      sourceDatabase: compareContext.sourceDatabase,
      targetConnectionId: compareContext.targetConnectionId,
      targetDatabase: compareContext.targetDatabase,
      table
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="grid grid-cols-2 gap-4 p-4 border-b border-border">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Source</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 min-w-0">
              <Label>Connection</Label>
              <Select options={connOptions} value={srcId} onChange={(e) => setSrcId(e.target.value)} />
            </div>
            <div className="space-y-2 min-w-0">
              <Label>Database</Label>
              <Select
                options={[{ value: '', label: '— select —' }, ...srcDbs.map((d) => ({ value: d, label: d }))]}
                value={srcDb}
                onChange={(e) => setSrcDb(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Target</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 min-w-0">
              <Label>Connection</Label>
              <Select options={connOptions} value={tgtId} onChange={(e) => setTgtId(e.target.value)} />
            </div>
            <div className="space-y-2 min-w-0">
              <Label>Database</Label>
              <Select
                options={[{ value: '', label: '— select —' }, ...tgtDbs.map((d) => ({ value: d, label: d }))]}
                value={tgtDb}
                onChange={(e) => setTgtDb(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <Button onClick={onCompare} disabled={loading}>
          {loading ? 'Comparing...' : 'Compare'}
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={compareData}
            onChange={(event) => setCompareData(event.target.checked)}
          />
          Compare rows
        </label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Parallel</span>
          <Select
            className="w-24"
            value={String(tableCompareConcurrency)}
            disabled={loading}
            onChange={(event) =>
              setPreferences((current) => ({
                ...current,
                tableCompareConcurrency: parseTableCompareConcurrency(event.target.value)
              }))
            }
            options={TABLE_COMPARE_CONCURRENCY_OPTIONS.map((value) => ({
              value: String(value),
              label: `${value}`
            }))}
          />
        </div>
        <Button
          variant="outline"
          disabled={comparePhase !== 'done' || !diff || diff.tableDiffs.length === 0}
          onClick={() => setShowSync(true)}
        >
          Plan Sync →
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {diff && `${diff.tableDiffs.length} table(s) differ${rowCompareSummary ? ` · ${rowCompareSummary}` : ''}`}
        </span>
      </div>

      {compareContext && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-4 py-3 border-b border-border">
          <TableListPanel title="Source tables" tables={sourceTables} phase={comparePhase} />
          <TableListPanel title="Target tables" tables={targetTables} phase={comparePhase} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-3 p-4">
          {compareContext && (
            <div className="space-y-3 rounded border border-border bg-card/20 p-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ComparePhaseIcon phase={comparePhase} />
                  <span>{formatComparePhase(comparePhase, completedSharedTableCount, sharedTableCount)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Status</span>
                  <Select
                    className="w-36"
                    value={statusFilter}
                    onChange={(event) =>
                      setPreferences((current) => ({
                        ...current,
                        statusFilter: event.target.value as TableStatusFilter
                      }))
                    }
                    options={[
                      { value: 'all', label: 'All' },
                      { value: 'comparing', label: 'Comparing' },
                      { value: 'changed', label: 'Only changed' },
                      { value: 'schema-changed', label: 'Schema changed' },
                      { value: 'row-changed', label: 'Row changed' }
                    ]}
                  />
                  <Badge>{filteredComparisonEntries.length}</Badge>
                </div>
              </div>
              {comparisonEntries.length > 0 && (
                <ComparisonStatusGrid
                  entries={filteredComparisonEntries}
                  onOpenCompare={openCompareView}
                  onOpenSource={(table) => openComparedTable('source', table)}
                  onOpenTarget={(table) => openComparedTable('target', table)}
                />
              )}
            </div>
          )}

          {comparePhase === 'idle' && (
            <div className="text-xs text-muted-foreground">
              Choose source &amp; target then click Compare. Row comparison uses shared primary keys when possible and falls back to all shared columns when needed.
            </div>
          )}
          {visibleSchemaDiffs.map((td) => (
            <div key={td.table} className="border border-border rounded">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-card border-b border-border">
                <strong className="text-sm">{td.table}</strong>
                <KindBadge kind={td.kind} />
                <span className="text-[10px] text-muted-foreground mr-auto">
                  {td.columnDiffs.length} column diff(s) · {td.indexDiffs.length} index diff(s)
                  {td.dataDiff && ` · ${formatDataSummary(td.dataDiff)}`}
                </span>
                {compareContext && (
                  <TableOpenActions
                    compareAvailable={td.kind === 'modified'}
                    sourceAvailable={td.kind !== 'only-in-target'}
                    targetAvailable={td.kind !== 'only-in-source'}
                    onOpenCompare={() => openCompareView(td.table)}
                    onOpenSource={() => openComparedTable('source', td.table)}
                    onOpenTarget={() => openComparedTable('target', td.table)}
                  />
                )}
              </div>
              {td.columnDiffs.length > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 p-3 text-xs">
                  <DiffColumn
                    title="Source"
                    items={td.columnDiffs.map((d) => formatCol(d.source, d.kind, 'source'))}
                  />
                  <DiffColumn
                    title="Target"
                    items={td.columnDiffs.map((d) => formatCol(d.target, d.kind, 'target'))}
                  />
                </div>
              )}
              {td.indexDiffs.length > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-3 pb-3 text-xs">
                  <DiffColumn
                    title="Source indexes"
                    items={td.indexDiffs.map((d) => formatIdx(d.source, d.kind, 'source'))}
                  />
                  <DiffColumn
                    title="Target indexes"
                    items={td.indexDiffs.map((d) => formatIdx(d.target, d.kind, 'target'))}
                  />
                </div>
              )}
            </div>
          ))}
          {compareData && diff && diff.rowComparisons.length > 0 && (
            <RowComparisonSection
              rowComparisons={diff.rowComparisons}
              onOpenCompare={openCompareView}
              onOpenSource={(table) => openComparedTable('source', table)}
              onOpenTarget={(table) => openComparedTable('target', table)}
            />
          )}
          {diff && fullyIdentical && (
            <div className="text-xs text-emerald-400">
              Source and target are identical{compareData ? ' at schema and row level.' : ' at schema level.'}
            </div>
          )}
          {diff && compareData && diff.tableDiffs.length === 0 && hasSkippedRowComparison && !fullyIdentical && (
            <div className="text-xs text-amber-400">
              Schema is identical, but some row comparisons were skipped. See the Row comparison section below for details.
            </div>
          )}
        </div>
      </div>

      {showSync && diff && (
        <SyncPanel
          open
          onClose={() => setShowSync(false)}
          source={{
            connectionId: compareContext?.sourceConnectionId ?? srcId,
            database: compareContext?.sourceDatabase ?? srcDb
          }}
          target={{
            connectionId: compareContext?.targetConnectionId ?? tgtId,
            database: compareContext?.targetDatabase ?? tgtDb
          }}
          sourceEngine={sourceConnection?.engine ?? 'mysql'}
          targetEngine={targetConnection?.engine ?? 'mysql'}
          diff={diff}
        />
      )}
    </div>
  )
}

function formatComparePhase(
  phase: ComparePhase,
  completedSharedTableCount: number,
  sharedTableCount: number
): string {
  if (phase === 'loading-tables') return 'Loading source and target table lists...'
  if (phase === 'comparing') {
    return `Comparing ${completedSharedTableCount}/${sharedTableCount} shared table(s)...`
  }
  if (phase === 'done') {
    return sharedTableCount === 0
      ? 'Only source-only/target-only tables were found. Results are ready.'
      : `Compared ${completedSharedTableCount}/${sharedTableCount} shared table(s).`
  }
  return 'Ready to compare.'
}

function ComparePhaseIcon({ phase }: { phase: ComparePhase }) {
  if (phase === 'loading-tables' || phase === 'comparing') {
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
  }
  if (phase === 'done') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  }
  return <CircleDashed className="h-3.5 w-3.5" />
}

function TableListPanel({
  title,
  tables,
  phase
}: {
  title: string
  tables: string[]
  phase: ComparePhase
}) {
  return (
    <div className="rounded border border-border/60 bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <Badge>{tables.length}</Badge>
      </div>
      {tables.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          {phase === 'loading-tables' ? 'Loading tables...' : 'No tables found'}
        </div>
      ) : (
        <div className="max-h-40 overflow-auto space-y-1">
          {tables.map((table) => (
            <div key={table} className="rounded border border-border/50 px-2 py-1 text-xs font-mono">
              {table}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ComparisonStatusGrid({
  entries,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: {
  entries: TableCompareEntry[]
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
}) {
  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground">No tables match the current filter.</div>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
      {entries.map((entry) => (
        <div
          key={entry.table}
          className="rounded border border-border/60 bg-card/40 px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2 min-w-0">
            <TableStatusIcon status={entry.status} />
            <span className="truncate font-medium">{entry.table}</span>
            <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
              {formatEntryStatus(entry)}
            </span>
          </div>
          {entry.error && <div className="mt-1 text-[11px] text-red-300 break-all">{entry.error}</div>}
          <TableOpenActions
            className="mt-2 flex flex-wrap gap-2"
            compareAvailable={entry.sourceExists && entry.targetExists}
            sourceAvailable={entry.sourceExists}
            targetAvailable={entry.targetExists}
            onOpenCompare={() => onOpenCompare(entry.table)}
            onOpenSource={() => onOpenSource(entry.table)}
            onOpenTarget={() => onOpenTarget(entry.table)}
          />
        </div>
      ))}
    </div>
  )
}

function TableStatusIcon({ status }: { status: TableCompareEntry['status'] }) {
  if (status === 'comparing') {
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-sky-300" />
  }
  if (status === 'done') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  }
  if (status === 'error') {
    return <AlertCircle className="h-3.5 w-3.5 text-red-300" />
  }
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
}

function formatEntryStatus(entry: TableCompareEntry): string {
  if (entry.status === 'error') return 'failed'
  if (!entry.sourceExists) return 'target only'
  if (!entry.targetExists) return 'source only'
  if (entry.status === 'queued') return 'queued'
  if (entry.status === 'comparing') return 'comparing'
  if (entry.rowComparison && !entry.rowComparison.dataDiff.comparable) return 'row skipped'
  if (entry.rowComparison && hasNoRowDifferences(entry.rowComparison) && !entry.tableDiff) return 'identical'
  if (!entry.rowComparison && !entry.tableDiff) return 'no differences'
  return 'ready'
}

function loadStoredDiffPanelPreferences(): DiffPanelPreferences {
  if (typeof window === 'undefined') {
    return {
      statusFilter: 'all',
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY
    }
  }

  return parseDiffPanelPreferences(window.localStorage.getItem(DIFF_PANEL_PREFERENCES_KEY))
}

function persistDiffPanelPreferences(preferences: DiffPanelPreferences): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DIFF_PANEL_PREFERENCES_KEY, JSON.stringify(preferences))
}

function summarizeRowComparisons(rowComparisons: TableRowComparison[]): string | null {
  if (rowComparisons.length === 0) return null

  let identical = 0
  let changed = 0
  let skipped = 0

  for (const { dataDiff } of rowComparisons) {
    if (!dataDiff.comparable) {
      skipped += 1
      continue
    }

    if (dataDiff.sourceOnly === 0 && dataDiff.targetOnly === 0 && dataDiff.modified === 0) {
      identical += 1
      continue
    }

    changed += 1
  }

  return `${rowComparisons.length} row-checked · ${changed} changed · ${identical} identical${skipped > 0 ? ` · ${skipped} skipped` : ''}`
}

function KindBadge({ kind }: { kind: string }) {
  if (kind === 'only-in-source') return <Badge variant="info">only in source</Badge>
  if (kind === 'only-in-target') return <Badge variant="warning">only in target</Badge>
  return <Badge variant="destructive">modified</Badge>
}

function TableOpenActions({
  compareAvailable,
  sourceAvailable,
  targetAvailable,
  onOpenCompare,
  onOpenSource,
  onOpenTarget,
  className
}: {
  compareAvailable?: boolean
  sourceAvailable: boolean
  targetAvailable: boolean
  onOpenCompare?: () => void
  onOpenSource: () => void
  onOpenTarget: () => void
  className?: string
}) {
  return (
    <div className={className ?? 'flex flex-wrap gap-2'}>
      {compareAvailable && onOpenCompare && (
        <Button size="sm" variant="outline" onClick={onOpenCompare}>
          Open Compare
        </Button>
      )}
      {sourceAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenSource}>
          Open Source
        </Button>
      )}
      {targetAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenTarget}>
          Open Target
        </Button>
      )}
    </div>
  )
}

function RowComparisonSection({
  rowComparisons,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: {
  rowComparisons: TableRowComparison[]
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
}) {
  return (
    <div className="border border-border rounded">
      <div className="flex items-center gap-2 px-3 py-2 bg-card border-b border-border">
        <strong className="text-sm">Row comparison</strong>
        <Badge>{rowComparisons.length} table(s)</Badge>
      </div>
      <div className="space-y-3 p-3">
        {rowComparisons.map((rowComparison) => (
          <div key={rowComparison.table} className="rounded border border-border/60">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-card/60">
              <strong className="text-sm">{rowComparison.table}</strong>
              <RowCompareBadge dataDiff={rowComparison.dataDiff} />
              <span className="mr-auto text-[10px] text-muted-foreground">
                {formatDataSummary(rowComparison.dataDiff)}
              </span>
              <TableOpenActions
                compareAvailable
                sourceAvailable={true}
                targetAvailable={true}
                onOpenCompare={() => onOpenCompare(rowComparison.table)}
                onOpenSource={() => onOpenSource(rowComparison.table)}
                onOpenTarget={() => onOpenTarget(rowComparison.table)}
              />
            </div>
            <DataDiffSection dataDiff={rowComparison.dataDiff} />
          </div>
        ))}
      </div>
    </div>
  )
}

function RowCompareBadge({ dataDiff }: { dataDiff: TableDataDiff }) {
  if (!dataDiff.comparable) return <Badge variant="warning">skipped</Badge>
  if (dataDiff.sourceOnly === 0 && dataDiff.targetOnly === 0 && dataDiff.modified === 0) {
    return <Badge variant="success">identical</Badge>
  }
  return <Badge variant="destructive">different</Badge>
}

function DiffColumn({ title, items }: { title: string; items: (string | null)[] }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-muted-foreground mb-1">{title}</div>
      <ul className="space-y-1 font-mono min-w-0">
        {items.map((item, index) =>
          item ? (
            <li
              key={index}
              className="overflow-x-auto rounded border border-border/60 bg-card px-2 py-1 whitespace-pre-wrap break-all"
            >
              {item}
            </li>
          ) : (
            <li
              key={index}
              className="rounded border border-dashed border-border/40 px-2 py-1 opacity-30"
            >
              —
            </li>
          )
        )}
      </ul>
    </div>
  )
}

function formatCol(c: { name: string; type: string; nullable: boolean } | undefined, kind: string, side: string) {
  if (!c) return null
  if (kind === 'only-in-source' && side === 'target') return null
  if (kind === 'only-in-target' && side === 'source') return null
  return `${c.name}  ${c.type}  ${c.nullable ? 'NULL' : 'NOT NULL'}`
}

function formatIdx(i: { name: string; columns: string[]; unique: boolean } | undefined, kind: string, side: string) {
  if (!i) return null
  if (kind === 'only-in-source' && side === 'target') return null
  if (kind === 'only-in-target' && side === 'source') return null
  return `${i.unique ? 'UNIQUE ' : ''}${i.name} (${i.columns.join(', ')})`
}

function DataDiffSection({ dataDiff }: { dataDiff: TableDataDiff }) {
  return (
    <div className="px-3 pb-3 text-xs space-y-3">
      <div className="rounded border border-border/60 bg-card px-3 py-2">
        <div className="font-medium text-muted-foreground mb-1">Row diff</div>
        {!dataDiff.comparable ? (
          <div className="text-amber-400">{dataDiff.reason || 'Row comparison skipped'}</div>
        ) : (
          <div className="space-y-1">
            <div>
              Compared by <code>{dataDiff.keyColumns.join(', ')}</code>
            </div>
            {dataDiff.reason && <div className="text-amber-400">{dataDiff.reason}</div>}
            <div className="text-muted-foreground">
              source rows {dataDiff.sourceRowCount} · target rows {dataDiff.targetRowCount} ·
              source only {dataDiff.sourceOnly} · target only {dataDiff.targetOnly} · modified {dataDiff.modified}
            </div>
          </div>
        )}
      </div>
      {dataDiff.samples.length > 0 && (
        <div>
          <div className="font-medium text-muted-foreground mb-1">Sample rows</div>
          <div className="space-y-2">
            {dataDiff.samples.map((sample, index) => (
              <SampleRow key={`${sample.kind}-${sample.key}-${index}`} sample={sample} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SampleRow({ sample }: { sample: TableDataDiffSample }) {
  return (
    <div className="rounded border border-border/60 bg-card px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <KindBadge kind={sample.kind} />
        <code className="break-all">{sample.key}</code>
      </div>
      {sample.source && (
        <pre className="overflow-auto whitespace-pre-wrap break-all rounded border border-border/50 px-2 py-1">
{`source ${JSON.stringify(sample.source, null, 2)}`}
        </pre>
      )}
      {sample.target && (
        <pre className="overflow-auto whitespace-pre-wrap break-all rounded border border-border/50 px-2 py-1">
{`target ${JSON.stringify(sample.target, null, 2)}`}
        </pre>
      )}
    </div>
  )
}

function formatDataSummary(dataDiff: TableDataDiff): string {
  if (!dataDiff.comparable) return 'row compare skipped'
  const totalDiffs = dataDiff.sourceOnly + dataDiff.targetOnly + dataDiff.modified
  return totalDiffs === 0 ? 'rows identical' : `${totalDiffs} row diff(s)`
}
