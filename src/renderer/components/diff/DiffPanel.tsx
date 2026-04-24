// 数据库对比面板：先加载两边表列表，再逐表对比并渐进展示结果。
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Select } from '@renderer/components/ui/select'
import { Badge } from '@renderer/components/ui/badge'
import { Tabs } from '@renderer/components/ui/tabs'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { DatabaseDiff } from '../../../shared/types'
import {
  buildDatabaseDiff,
  filterChangedRowComparisons,
  filterComparisonEntries,
  getPreferredComparisonTable,
  hasSchemaOrPresenceDiff,
  hasNoRowDifferences,
  parseTableCompareConcurrency,
  prioritizeComparisonEntries,
  TABLE_COMPARE_CONCURRENCY_OPTIONS,
  type DiffResultTab,
  type TableCompareEntry
} from './diff-panel-utils'
import {
  buildDatabaseOptions,
  formatCompareButtonLabel,
  formatCompareSetupSummary
} from './diff-panel-formatters'
import { EmptyResultState } from './diff-panel-presentation'
import { RowComparisonSection } from './RowComparisonSection'
import { SyncPanel } from './SyncPanel'
import { SchemaTabContent, StatusTabContent, TablesTabContent } from './DiffResultTabs'
import { DiffPanelSetupSection } from './DiffPanelSetupSection'
import {
  useDatabaseList,
  useDiffComparison,
  useStoredDiffPanelPreferences
} from './diff-panel-hooks'

export function DiffPanel() {
  const { connections, refresh } = useConnectionStore()
  const { setRightView, showToast } = useUIStore()

  const [srcId, setSrcId] = useState('')
  const [tgtId, setTgtId] = useState('')
  const [srcDb, setSrcDb] = useState('')
  const [tgtDb, setTgtDb] = useState('')
  const { databases: srcDbs, loading: srcDbsLoading } = useDatabaseList(srcId, showToast)
  const { databases: tgtDbs, loading: tgtDbsLoading } = useDatabaseList(tgtId, showToast)
  const [selectedComparisonTable, setSelectedComparisonTable] = useState<string | null>(null)
  const [compareData, setCompareData] = useState(true)
  const [preferences, setPreferences] = useStoredDiffPanelPreferences()
  const statusFilter = preferences.statusFilter
  const tableCompareConcurrency = preferences.tableCompareConcurrency
  const resultTab = preferences.resultTab
  const setupExpanded = preferences.setupExpanded
  const tableSearchQuery = preferences.tableSearchQuery
  const {
    comparePhase,
    compareContext,
    sourceTables,
    targetTables,
    comparisonEntries,
    showSync,
    setShowSync,
    showAllRowComparisons,
    setShowAllRowComparisons,
    runCompare
  } = useDiffComparison({
    sourceConnectionId: srcId,
    sourceDatabase: srcDb,
    targetConnectionId: tgtId,
    targetDatabase: tgtDb,
    compareData,
    tableCompareConcurrency,
    showToast,
    onBeforeCompare: () => {
      setSelectedComparisonTable(null)
      setPreferences((current) => ({
        ...current,
        resultTab: 'status',
        setupExpanded: false
      }))
    }
  })

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    setSrcDb('')
  }, [srcId])

  useEffect(() => {
    setTgtDb('')
  }, [tgtId])

  const diff = useMemo<DatabaseDiff | null>(() => {
    if (!compareContext) return null
    return buildDatabaseDiff(compareContext.sourceDatabase, compareContext.targetDatabase, comparisonEntries)
  }, [compareContext, comparisonEntries])

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
  const compareErrorCount = comparisonEntries.reduce(
    (count, entry) => (entry.status === 'error' ? count + 1 : count),
    0
  )
  const hasCompareErrors = compareErrorCount > 0
  const fullyIdentical = diff
    ? comparePhase === 'done' &&
      !hasCompareErrors &&
      diff.tableDiffs.length === 0 &&
      (!compareContext?.compareData || diff.rowComparisons.every(hasNoRowDifferences))
    : false
  const hasSkippedRowComparison =
    diff?.rowComparisons.some(({ dataDiff }) => !dataDiff.comparable) ?? false
  const sharedTableStats = useMemo(() => {
    let sharedTotal = 0
    let completed = 0
    let pending: string | undefined
    for (const entry of comparisonEntries) {
      if (!entry.sourceExists || !entry.targetExists) continue
      sharedTotal += 1
      if (entry.status === 'done' || entry.status === 'error') {
        completed += 1
      } else if (!pending) {
        pending = entry.table
      }
    }
    return { sharedTotal, completed, pending }
  }, [comparisonEntries])
  const sharedTableCount = sharedTableStats.sharedTotal
  const completedSharedTableCount = sharedTableStats.completed
  const pendingSharedTable = sharedTableStats.pending
  const hasRowComparisonResults = compareData && !!diff && diff.rowComparisons.length > 0
  const changedRowComparisons = useMemo(
    () => (diff ? filterChangedRowComparisons(diff.rowComparisons) : []),
    [diff]
  )
  const rowChangedTableCount = changedRowComparisons.length
  const rowSkippedTableCount = diff
    ? diff.rowComparisons.filter((rowComparison) => !rowComparison.dataDiff.comparable).length
    : 0
  const rowComparisonTables = diff?.rowComparisons.map((rowComparison) => rowComparison.table) ?? []
  const rowDiffTables = changedRowComparisons.map((rowComparison) => rowComparison.table)
  const compareSetupSummary = formatCompareSetupSummary({
    sourceConnectionName: selectedSourceConnection?.name,
    sourceDatabase: srcDb,
    targetConnectionName: selectedTargetConnection?.name,
    targetDatabase: tgtDb,
    compareData
  })
  const sourceDatabaseOptions = buildDatabaseOptions(srcId, srcDbs, srcDbsLoading)
  const targetDatabaseOptions = buildDatabaseOptions(tgtId, tgtDbs, tgtDbsLoading)

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
      setPreferences((current) => ({ ...current, resultTab: 'status' }))
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
      setPreferences((current) => ({ ...current, resultTab: 'data' }))
    }
  }, [compareData, comparePhase, hasRowComparisonResults, resultTab, visibleSchemaDiffs.length])

  const openComparedTable = (side: 'source' | 'target', table: string) => {
    if (!compareContext) return

    const connectionId =
      side === 'source' ? compareContext.sourceConnectionId : compareContext.targetConnectionId
    const database =
      side === 'source' ? compareContext.sourceDatabase : compareContext.targetDatabase

    setRightView({ kind: 'table', connectionId, database, table })
  }

  const openCompareView = (table: string) => {
    if (!compareContext) return

    setRightView({
      kind: 'table-compare',
      compareSessionId: `${compareContext.sourceConnectionId}:${compareContext.sourceDatabase}:${compareContext.targetConnectionId}:${compareContext.targetDatabase}:${table}`,
      sourceConnectionId: compareContext.sourceConnectionId,
      sourceDatabase: compareContext.sourceDatabase,
      targetConnectionId: compareContext.targetConnectionId,
      targetDatabase: compareContext.targetDatabase,
      table,
      comparedTables: rowComparisonTables,
      diffTables: rowDiffTables
    })
  }

  const tabItems = [
    {
      value: 'tables' as const,
      label: (
        <span className="flex items-center gap-2">
          <span>Tables</span>
          <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
            S {sourceTables.length}
          </Badge>
          <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
            T {targetTables.length}
          </Badge>
        </span>
      )
    },
    {
      value: 'status' as const,
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
      value: 'schema' as const,
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
            value: 'data' as const,
            label: (
              <span className="flex items-center gap-2">
                <span>Content diff</span>
                <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                  {rowChangedTableCount} changed
                </Badge>
                {rowSkippedTableCount > 0 && (
                  <Badge variant="warning">{rowSkippedTableCount} skipped</Badge>
                )}
                {compareErrorCount > 0 && (
                  <Badge variant="destructive">{compareErrorCount} errors</Badge>
                )}
              </span>
            )
          }
        ]
      : [])
  ]

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <DiffPanelSetupSection
        expanded={setupExpanded}
        summary={compareSetupSummary}
        onToggle={() =>
          setPreferences((current) => ({ ...current, setupExpanded: !current.setupExpanded }))
        }
        source={{
          connectionName: selectedSourceConnection?.name,
          database: srcDb,
          connectionOptions: connOptions,
          connectionValue: srcId,
          onConnectionChange: setSrcId,
          databaseOptions: sourceDatabaseOptions,
          databaseValue: srcDb,
          databaseDisabled: !srcId || srcDbsLoading,
          databaseLoading: srcDbsLoading,
          onDatabaseChange: setSrcDb
        }}
        target={{
          connectionName: selectedTargetConnection?.name,
          database: tgtDb,
          connectionOptions: connOptions,
          connectionValue: tgtId,
          onConnectionChange: setTgtId,
          databaseOptions: targetDatabaseOptions,
          databaseValue: tgtDb,
          databaseDisabled: !tgtId || tgtDbsLoading,
          databaseLoading: tgtDbsLoading,
          onDatabaseChange: setTgtDb
        }}
      />

      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card/15 p-1.5">
            <Button
              size="sm"
              className="h-8 min-w-[10rem] px-3"
              onClick={runCompare}
              disabled={loading}
            >
              {formatCompareButtonLabel(comparePhase, completedSharedTableCount, sharedTableCount)}
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
                  {comparePhase === 'done' &&
                  rowChangedTableCount === 0 &&
                  rowSkippedTableCount === 0 ? (
                    <Badge variant="success">rows identical</Badge>
                  ) : (
                    <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                      {rowChangedTableCount} changed
                    </Badge>
                  )}
                </>
              )}
              {compareData && rowSkippedTableCount > 0 && (
                <Badge variant="warning">{rowSkippedTableCount} skipped</Badge>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-h-full flex-col gap-3 p-4">
          {comparePhase === 'idle' && (
            <div className="text-xs text-muted-foreground">
              Choose source &amp; target then click Compare. Row comparison uses shared primary keys
              when possible and falls back to all shared columns when needed.
            </div>
          )}
          {compareContext && (
            <div className="flex min-h-[32rem] min-w-0 flex-1 flex-col rounded-xl border border-border/60 bg-card/10">
              <Tabs
                className="px-4 pt-3"
                value={resultTab}
                onValueChange={(value) =>
                  setPreferences((current) => ({
                    ...current,
                    resultTab: value as DiffResultTab
                  }))
                }
                items={tabItems}
              />

              <div className="flex min-h-0 flex-1 flex-col p-4 pt-3">
                {resultTab === 'tables' ? (
                  <TablesTabContent
                    sourceTables={sourceTables}
                    targetTables={targetTables}
                    sharedTableCount={sharedTableCount}
                    phase={comparePhase}
                  />
                ) : resultTab === 'status' ? (
                  <StatusTabContent
                    comparisonEntries={comparisonEntries}
                    prioritizedComparisonEntries={prioritizedComparisonEntries}
                    filteredComparisonEntries={filteredComparisonEntries}
                    sharedTableCount={sharedTableCount}
                    completedSharedTableCount={completedSharedTableCount}
                    pendingSharedTable={pendingSharedTable}
                    hasCompareErrors={hasCompareErrors}
                    comparePhase={comparePhase}
                    statusFilter={statusFilter}
                    tableSearchQuery={tableSearchQuery}
                    selectedComparisonTable={selectedComparisonTable}
                    onSelectTable={setSelectedComparisonTable}
                    onSearchChange={(value) =>
                      setPreferences((current) => ({ ...current, tableSearchQuery: value }))
                    }
                    onClearSearch={() =>
                      setPreferences((current) => ({ ...current, tableSearchQuery: '' }))
                    }
                    onStatusFilterChange={(value) =>
                      setPreferences((current) => ({ ...current, statusFilter: value }))
                    }
                    onOpenCompare={openCompareView}
                    onOpenSource={(table) => openComparedTable('source', table)}
                    onOpenTarget={(table) => openComparedTable('target', table)}
                  />
                ) : resultTab === 'schema' ? (
                  <SchemaTabContent
                    schemaDiffs={visibleSchemaDiffs}
                    hasRowComparisonResults={hasRowComparisonResults}
                    onOpenCompare={openCompareView}
                    onOpenSource={(table) => openComparedTable('source', table)}
                    onOpenTarget={(table) => openComparedTable('target', table)}
                  />
                ) : hasRowComparisonResults && diff ? (
                  <RowComparisonSection
                    rowComparisons={diff.rowComparisons}
                    showAll={showAllRowComparisons}
                    onToggleShowAll={() => setShowAllRowComparisons((current) => !current)}
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
              Source and target are identical
              {compareData ? ' at schema and row level.' : ' at schema level.'}
            </div>
          )}
          {diff &&
            compareData &&
            diff.tableDiffs.length === 0 &&
            hasSkippedRowComparison &&
            !fullyIdentical && (
              <div className="text-xs text-amber-400">
                Schema is identical, but some row comparisons were skipped. Open the Content diff
                tab for details.
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
