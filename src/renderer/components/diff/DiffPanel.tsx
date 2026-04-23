// 数据库对比面板：先加载两边表列表，再逐表对比并渐进展示结果。
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, LoaderCircle } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Input } from '@renderer/components/ui/input'
import { Select } from '@renderer/components/ui/select'
import { Label } from '@renderer/components/ui/label'
import { Badge } from '@renderer/components/ui/badge'
import { Tabs } from '@renderer/components/ui/tabs'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import type {
  DatabaseDiff,
  TableDataDiff,
  TableComparisonResult,
  TableDiff,
  TableRowComparison
} from '../../../shared/types'
import {
  buildDatabaseDiff,
  buildInitialComparisonEntries,
  DIFF_PANEL_PREFERENCES_KEY,
  filterComparisonEntries,
  getPreferredComparisonTable,
  hasSchemaOrPresenceDiff,
  hasNoRowDifferences,
  parseDiffPanelPreferences,
  parseTableCompareConcurrency,
  prioritizeComparisonEntries,
  runWithConcurrencyLimit,
  TABLE_COMPARE_CONCURRENCY_OPTIONS,
  type DiffPanelPreferences,
  type DiffResultTab,
  type TableCompareEntry,
  type TableStatusFilter,
  updateTableEntry
} from './diff-panel-utils'
import { ComparisonStatusPanel } from './ComparisonStatusPanel'
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
  const [selectedComparisonTable, setSelectedComparisonTable] = useState<string | null>(null)
  const [showSync, setShowSync] = useState(false)
  const [compareData, setCompareData] = useState(true)
  const [preferences, setPreferences] = useState<DiffPanelPreferences>(() =>
    loadStoredDiffPanelPreferences()
  )
  const compareRunIdRef = useRef(0)

  const statusFilter = preferences.statusFilter
  const tableCompareConcurrency = preferences.tableCompareConcurrency
  const resultTab = preferences.resultTab
  const setupExpanded = preferences.setupExpanded
  const sourceTablesExpanded = preferences.sourceTablesExpanded
  const tableSearchQuery = preferences.tableSearchQuery
  const targetTablesExpanded = preferences.targetTablesExpanded
  const tableListsExpanded = sourceTablesExpanded || targetTablesExpanded

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
    setSrcDb('')
    setSrcDbs([])
  }, [srcId])

  useEffect(() => {
    setTgtDb('')
    setTgtDbs([])
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
    setSelectedComparisonTable(null)
    setPreferences((current) => ({
      ...current,
      resultTab: 'status',
      setupExpanded: false
    }))
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
  const selectedSourceConnection = connections.find((connection) => connection.id === srcId)
  const selectedTargetConnection = connections.find((connection) => connection.id === tgtId)
  const sourceConnection = connections.find(
    (connection) => connection.id === (compareContext?.sourceConnectionId ?? srcId)
  )
  const targetConnection = connections.find(
    (connection) => connection.id === (compareContext?.targetConnectionId ?? tgtId)
  )
  const loading = comparePhase === 'loading-tables' || comparePhase === 'comparing'
  const visibleSchemaDiffs = diff?.tableDiffs.filter(hasSchemaOrPresenceDiff) ?? []
  const filteredComparisonEntries = useMemo(
    () => filterComparisonEntries(comparisonEntries, statusFilter, tableSearchQuery),
    [comparisonEntries, statusFilter, tableSearchQuery]
  )
  const prioritizedComparisonEntries = useMemo(
    () => prioritizeComparisonEntries(filteredComparisonEntries),
    [filteredComparisonEntries]
  )
  const hasCompareErrors = comparisonEntries.some((entry) => entry.status === 'error')
  const compareErrorCount = comparisonEntries.filter((entry) => entry.status === 'error').length
  const fullyIdentical = diff
    ? comparePhase === 'done' &&
      !hasCompareErrors &&
      diff.tableDiffs.length === 0 &&
      (!compareContext?.compareData || diff.rowComparisons.every(hasNoRowDifferences))
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
  const hasRowComparisonResults = compareData && !!diff && diff.rowComparisons.length > 0
  const rowChangedTableCount = diff
    ? diff.rowComparisons.filter(
        (rowComparison) =>
          rowComparison.dataDiff.comparable && !hasNoRowDifferences(rowComparison)
      ).length
    : 0
  const rowSkippedTableCount = diff
    ? diff.rowComparisons.filter((rowComparison) => !rowComparison.dataDiff.comparable).length
    : 0
  const compareSetupSummary = formatCompareSetupSummary({
    sourceConnectionName: selectedSourceConnection?.name,
    sourceDatabase: srcDb,
    targetConnectionName: selectedTargetConnection?.name,
    targetDatabase: tgtDb,
    compareData
  })

  useEffect(() => {
    const preferredTable = getPreferredComparisonTable(
      prioritizedComparisonEntries,
      selectedComparisonTable
    )
    if (preferredTable !== selectedComparisonTable) {
      setSelectedComparisonTable(preferredTable)
    }
  }, [prioritizedComparisonEntries, selectedComparisonTable])

  useEffect(() => {
    if (!compareData && resultTab === 'data') {
      setPreferences((current) => ({
        ...current,
        resultTab: 'status'
      }))
    }
  }, [compareData, resultTab])

  useEffect(() => {
    if (
      resultTab === 'schema' &&
      comparePhase === 'done' &&
      compareData &&
      visibleSchemaDiffs.length === 0 &&
      hasRowComparisonResults
    ) {
      setPreferences((current) => ({
        ...current,
        resultTab: 'data'
      }))
    }
  }, [compareData, comparePhase, hasRowComparisonResults, resultTab, visibleSchemaDiffs.length])

  const toggleTableLists = () => {
    setPreferences((current) => {
      const nextExpanded = !(current.sourceTablesExpanded || current.targetTablesExpanded)

      return {
        ...current,
        sourceTablesExpanded: nextExpanded,
        targetTablesExpanded: nextExpanded
      }
    })
  }

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
      <div className="border-b border-border">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <button
            type="button"
            className="flex min-w-0 items-center gap-2 text-left"
            onClick={() =>
              setPreferences((current) => ({
                ...current,
                setupExpanded: !current.setupExpanded
              }))
            }
          >
            {setupExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">Compare setup</span>
          </button>
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">{compareSetupSummary}</div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() =>
              setPreferences((current) => ({
                ...current,
                setupExpanded: !current.setupExpanded
              }))
            }
          >
            {setupExpanded ? 'Hide' : 'Show'}
          </Button>
        </div>

        {setupExpanded && (
          <div className="grid grid-cols-1 gap-3 border-t border-border/40 bg-card/10 px-4 py-3 xl:grid-cols-2">
            <div className="rounded-lg bg-background/30 p-3">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold">Source</h3>
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {formatEndpointSelectionSummary(selectedSourceConnection?.name, srcDb, 'Choose source')}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Connection</Label>
                  <Select options={connOptions} value={srcId} onChange={(e) => setSrcId(e.target.value)} />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Database</Label>
                  <Select
                    options={[{ value: '', label: '— select —' }, ...srcDbs.map((d) => ({ value: d, label: d }))]}
                    value={srcDb}
                    onChange={(e) => setSrcDb(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-background/30 p-3">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="text-sm font-semibold">Target</h3>
                <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                  {formatEndpointSelectionSummary(selectedTargetConnection?.name, tgtDb, 'Choose target')}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Connection</Label>
                  <Select options={connOptions} value={tgtId} onChange={(e) => setTgtId(e.target.value)} />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Database</Label>
                  <Select
                    options={[{ value: '', label: '— select —' }, ...tgtDbs.map((d) => ({ value: d, label: d }))]}
                    value={tgtDb}
                    onChange={(e) => setTgtDb(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card/15 p-1.5">
            <Button size="sm" className="h-8 px-3" onClick={onCompare} disabled={loading}>
              {loading ? 'Comparing...' : 'Compare'}
            </Button>
            <label className="flex h-8 items-center gap-2 rounded-lg bg-background/35 px-2.5 text-xs text-muted-foreground">
              <Checkbox
                className="h-3.5 w-3.5"
                checked={compareData}
                onChange={(event) => setCompareData(event.target.checked)}
              />
              <span>Compare rows</span>
            </label>
            <div className="flex h-8 items-center gap-2 rounded-lg bg-background/35 px-2.5 text-xs text-muted-foreground">
              <span>Parallel</span>
              <Select
                className="h-7 w-20 border-border/50 bg-transparent px-2 text-xs"
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
              size="sm"
              variant="outline"
              className="h-8 px-3"
              disabled={comparePhase !== 'done' || !diff || diff.tableDiffs.length === 0}
              onClick={() => setShowSync(true)}
            >
              Plan Sync
            </Button>
          </div>
          {diff && (
            <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                {diff.tableDiffs.length} structure
              </Badge>
              {compareData && diff.rowComparisons.length > 0 && (
                <>
                  <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                    {diff.rowComparisons.length} checked
                  </Badge>
                  {comparePhase === 'done' && rowChangedTableCount === 0 && rowSkippedTableCount === 0 ? (
                    <Badge variant="success">rows identical</Badge>
                  ) : (
                    <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                      {rowChangedTableCount} changed
                    </Badge>
                  )}
                </>
              )}
              {compareData && rowSkippedTableCount > 0 && <Badge variant="warning">{rowSkippedTableCount} skipped</Badge>}
            </div>
          )}
        </div>
      </div>

      {compareContext && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-4 py-3 border-b border-border">
          <TableListPanel
            title="Source tables"
            tables={sourceTables}
            phase={comparePhase}
            expanded={tableListsExpanded}
            onToggle={toggleTableLists}
            toggleLabel={tableListsExpanded ? 'Hide both' : 'Show both'}
          />
          <TableListPanel
            title="Target tables"
            tables={targetTables}
            phase={comparePhase}
            expanded={tableListsExpanded}
            onToggle={toggleTableLists}
            toggleLabel={tableListsExpanded ? 'Hide both' : 'Show both'}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-3 p-4">
          {comparePhase === 'idle' && (
            <div className="text-xs text-muted-foreground">
              Choose source &amp; target then click Compare. Row comparison uses shared primary keys when possible and falls back to all shared columns when needed.
            </div>
          )}
          {compareContext && (
            <div className="overflow-hidden rounded-xl border border-border/60 bg-card/10">
              <Tabs
                className="px-4 pt-3"
                value={resultTab}
                onValueChange={(value) =>
                  setPreferences((current) => ({
                    ...current,
                    resultTab: value as DiffResultTab
                  }))
                }
                items={[
                  {
                    value: 'status',
                    label: (
                      <span className="flex items-center gap-2">
                        <span>Status</span>
                        <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                          {comparisonEntries.length}
                        </Badge>
                        {compareErrorCount > 0 && <Badge variant="destructive">{compareErrorCount} errors</Badge>}
                      </span>
                    )
                  },
                  {
                    value: 'schema',
                    label: (
                      <span className="flex items-center gap-2">
                        <span>Structure diff</span>
                        <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                          {visibleSchemaDiffs.length} changed
                        </Badge>
                        {compareErrorCount > 0 && <Badge variant="destructive">{compareErrorCount} errors</Badge>}
                      </span>
                    )
                  },
                  ...(compareData
                    ? [
                        {
                          value: 'data',
                          label: (
                            <span className="flex items-center gap-2">
                              <span>Content diff</span>
                              <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                                {rowChangedTableCount} changed
                              </Badge>
                              {rowSkippedTableCount > 0 && <Badge variant="warning">{rowSkippedTableCount} skipped</Badge>}
                              {compareErrorCount > 0 && <Badge variant="destructive">{compareErrorCount} errors</Badge>}
                            </span>
                          )
                        }
                      ]
                    : [])
                ]}
              />

              <div className="p-4 pt-3">
                {resultTab === 'status' ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ComparePhaseIcon phase={comparePhase} />
                          <span>{formatComparePhase(comparePhase, completedSharedTableCount, sharedTableCount)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                            {comparisonEntries.length} tracked
                          </Badge>
                          <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                            {sharedTableCount} shared
                          </Badge>
                          {hasCompareErrors && <Badge variant="destructive">errors present</Badge>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground lg:justify-end">
                        <Input
                          value={tableSearchQuery}
                          onChange={(event) =>
                            setPreferences((current) => ({
                              ...current,
                              tableSearchQuery: event.target.value
                            }))
                          }
                          placeholder="Search table"
                          className="h-8 w-40 text-xs"
                        />
                        {tableSearchQuery && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={() =>
                              setPreferences((current) => ({
                                ...current,
                                tableSearchQuery: ''
                              }))
                            }
                          >
                            Clear
                          </Button>
                        )}
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
                            { value: 'schema-changed', label: 'Structure changed' },
                            { value: 'row-changed', label: 'Content changed' }
                          ]}
                        />
                        <Badge>{filteredComparisonEntries.length}</Badge>
                      </div>
                    </div>
                    {comparisonEntries.length > 0 ? (
                      <ComparisonStatusPanel
                        entries={prioritizedComparisonEntries}
                        selectedTable={selectedComparisonTable}
                        onSelectTable={setSelectedComparisonTable}
                        onOpenCompare={openCompareView}
                        onOpenSource={(table) => openComparedTable('source', table)}
                        onOpenTarget={(table) => openComparedTable('target', table)}
                      />
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {comparePhase === 'loading-tables'
                          ? 'Loading source and target table lists...'
                          : 'No tables match the current filter.'}
                      </div>
                    )}
                  </div>
                ) : resultTab === 'schema' ? (
                  visibleSchemaDiffs.length > 0 ? (
                    <div className="space-y-3">
                      {visibleSchemaDiffs.map((td) => (
                        <div key={td.table} className="rounded-xl bg-card/20">
                          <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-card/40 px-3 py-2">
                            <strong className="text-sm">{td.table}</strong>
                            <KindBadge kind={td.kind} />
                            <span className="mr-auto text-[10px] text-muted-foreground">
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
                            <div className="grid grid-cols-1 gap-3 p-3 text-xs xl:grid-cols-2">
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
                            <div className="grid grid-cols-1 gap-3 px-3 pb-3 text-xs xl:grid-cols-2">
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
                    </div>
                  ) : (
                    <EmptyResultState
                      title="No structure differences"
                      description={
                        hasRowComparisonResults
                          ? 'Schema matches on both sides. Switch to the Content diff tab to inspect row-level changes.'
                          : 'No schema or presence differences were found in the current result set.'
                      }
                    />
                  )
                ) : hasRowComparisonResults && diff ? (
                  <RowComparisonSection
                    rowComparisons={diff.rowComparisons}
                    onOpenCompare={openCompareView}
                    onOpenSource={(table) => openComparedTable('source', table)}
                    onOpenTarget={(table) => openComparedTable('target', table)}
                  />
                ) : (
                  <EmptyResultState
                    title="No content comparison results"
                    description={
                      compareData
                        ? 'Row comparison is enabled, but there are no row-level results yet for the current diff.'
                        : 'Enable Compare rows before running Compare to inspect row-level changes here.'
                    }
                  />
                )}
              </div>
            </div>
          )}
          {diff && fullyIdentical && (
            <div className="text-xs text-emerald-400">
              Source and target are identical{compareData ? ' at schema and row level.' : ' at schema level.'}
            </div>
          )}
          {diff && compareData && diff.tableDiffs.length === 0 && hasSkippedRowComparison && !fullyIdentical && (
            <div className="text-xs text-amber-400">
              Schema is identical, but some row comparisons were skipped. Open the Content diff tab for details.
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
  phase,
  expanded,
  onToggle,
  toggleLabel
}: {
  title: string
  tables: string[]
  phase: ComparePhase
  expanded: boolean
  onToggle: () => void
  toggleLabel?: string
}) {
  return (
    <div className="rounded-xl bg-card/15 px-3 py-3">
      <div className="flex items-center justify-between gap-2 border-b border-border/30 pb-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
        </button>
        <div className="flex items-center gap-2">
          <Badge>{tables.length}</Badge>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onToggle}>
            {toggleLabel ?? (expanded ? 'Hide' : 'Show')}
          </Button>
        </div>
      </div>
      {!expanded ? (
        <div className="mt-3 text-xs text-muted-foreground">
          {phase === 'loading-tables'
            ? 'Loading tables...'
            : tables.length === 0
              ? 'No tables found'
              : `${tables.length} table(s) hidden to keep the compare view compact.`}
        </div>
      ) : tables.length === 0 ? (
        <div className="mt-3 text-xs text-muted-foreground">
          {phase === 'loading-tables' ? 'Loading tables...' : 'No tables found'}
        </div>
      ) : (
        <div className="mt-3 max-h-40 overflow-auto pr-1">
          <div className="space-y-1.5">
          {tables.map((table) => (
              <div key={table} className="rounded-md bg-background/35 px-3 py-1.5 text-xs font-mono">
                {table}
              </div>
          ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatCompareSetupSummary({
  sourceConnectionName,
  sourceDatabase,
  targetConnectionName,
  targetDatabase,
  compareData
}: {
  sourceConnectionName?: string
  sourceDatabase: string
  targetConnectionName?: string
  targetDatabase: string
  compareData: boolean
}): string {
  if (!sourceConnectionName && !targetConnectionName && !sourceDatabase && !targetDatabase) {
    return 'Choose source and target connections before running Compare.'
  }

  const sourceLabel = [sourceConnectionName, sourceDatabase].filter(Boolean).join(' / ') || 'Source pending'
  const targetLabel = [targetConnectionName, targetDatabase].filter(Boolean).join(' / ') || 'Target pending'

  return `${sourceLabel} -> ${targetLabel} · row comparison ${compareData ? 'on' : 'off'}`
}

function formatEndpointSelectionSummary(
  connectionName: string | undefined,
  database: string,
  fallback: string
): string {
  const parts = [connectionName, database].filter(Boolean)

  return parts.length > 0 ? parts.join(' / ') : fallback
}

function EmptyResultState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded border border-dashed border-border/60 bg-card/20 px-4 py-6 text-sm">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{description}</div>
    </div>
  )
}

function loadStoredDiffPanelPreferences(): DiffPanelPreferences {
  if (typeof window === 'undefined') return parseDiffPanelPreferences(null)

  return parseDiffPanelPreferences(window.localStorage.getItem(DIFF_PANEL_PREFERENCES_KEY))
}

function persistDiffPanelPreferences(preferences: DiffPanelPreferences): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DIFF_PANEL_PREFERENCES_KEY, JSON.stringify(preferences))
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
    <div className="rounded-xl bg-card/15">
      <div className="flex items-center gap-2 px-3 py-2">
        <strong className="text-sm">Row comparison</strong>
        <Badge>{rowComparisons.length} table(s)</Badge>
      </div>
      <div className="divide-y divide-border/30 border-t border-border/30">
        {rowComparisons.map((rowComparison) => (
          <div key={rowComparison.table} className="px-3 py-3">
            <div className="flex items-center gap-2">
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
              className="overflow-x-auto rounded bg-card/70 px-2 py-1 whitespace-pre-wrap break-all"
            >
              {item}
            </li>
          ) : (
            <li key={index} className="rounded bg-background/30 px-2 py-1 text-muted-foreground/60">
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
    <div className="mt-3 border-l border-border/40 pl-4 text-xs">
      <div className="space-y-1 rounded-md bg-background/40 px-3 py-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Row diff</div>
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
    </div>
  )
}

function formatDataSummary(dataDiff: TableDataDiff): string {
  if (!dataDiff.comparable) return 'row compare skipped'
  const totalDiffs = dataDiff.sourceOnly + dataDiff.targetOnly + dataDiff.modified
  return totalDiffs === 0 ? 'rows identical' : `${totalDiffs} row diff(s)`
}
