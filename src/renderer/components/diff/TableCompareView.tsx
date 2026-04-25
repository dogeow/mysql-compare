import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type UIEvent } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { QueryRowsResult } from '../../../shared/types'
import { getRowDiffNavigation } from './diff-panel-utils'
import { buildCopyValues, buildRowKey } from './table-compare-utils'
import { TableComparePane } from './TableComparePane'

interface Props {
  compareSessionId: string
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  table: string
  comparedTables: string[]
  diffTables: string[]
}

interface ComparedTableDataState {
  data: QueryRowsResult | null
  error: string | null
  loading: boolean
}

const PAGE_SIZE = 100

export function TableCompareView({
  compareSessionId,
  sourceConnectionId,
  sourceDatabase,
  targetConnectionId,
  targetDatabase,
  table,
  comparedTables,
  diffTables
}: Props) {
  const { connections } = useConnectionStore()
  const { setRightView, showToast } = useUIStore()
  const [page, setPage] = useState(1)
  const [sourceReloadToken, setSourceReloadToken] = useState(0)
  const [targetReloadToken, setTargetReloadToken] = useState(0)
  const [selectedSourceRows, setSelectedSourceRows] = useState<Record<string, Record<string, unknown>>>({})
  const [copying, setCopying] = useState(false)
  const sourceScrollRef = useRef<HTMLDivElement | null>(null)
  const targetScrollRef = useRef<HTMLDivElement | null>(null)
  const syncScrollFrameRef = useRef<number | null>(null)
  const syncingScrollRef = useRef(false)

  const [sourceState, setSourceState] = useState<ComparedTableDataState>({
    data: null,
    error: null,
    loading: false
  })
  const [targetState, setTargetState] = useState<ComparedTableDataState>({
    data: null,
    error: null,
    loading: false
  })

  const stableOrderColumn = useMemo(() => {
    const sourcePrimaryKey = sourceState.data?.primaryKey ?? []
    const targetPrimaryKey = new Set(targetState.data?.primaryKey ?? [])
    return sourcePrimaryKey.find((column) => targetPrimaryKey.has(column)) ?? null
  }, [sourceState.data, targetState.data])
  const stableOrderBy = useMemo(
    () => (stableOrderColumn ? { column: stableOrderColumn, dir: 'ASC' as const } : undefined),
    [stableOrderColumn]
  )

  useEffect(() => {
    setPage(1)
    setSelectedSourceRows({})
    setSourceState({
      data: null,
      error: null,
      loading: true
    })
    setTargetState({
      data: null,
      error: null,
      loading: true
    })
  }, [sourceConnectionId, sourceDatabase, targetConnectionId, targetDatabase, table])

  useEffect(() => {
    sourceScrollRef.current?.scrollTo({ top: 0, left: 0 })
    targetScrollRef.current?.scrollTo({ top: 0, left: 0 })
  }, [page, sourceConnectionId, sourceDatabase, targetConnectionId, targetDatabase, table])

  useEffect(() => {
    return () => {
      if (syncScrollFrameRef.current !== null) {
        cancelAnimationFrame(syncScrollFrameRef.current)
      }
    }
  }, [])

  useComparedTableData({
    connectionId: sourceConnectionId,
    database: sourceDatabase,
    table,
    page,
    pageSize: PAGE_SIZE,
    reloadToken: sourceReloadToken,
    orderBy: stableOrderBy,
    onStateChange: setSourceState
  })
  useComparedTableData({
    connectionId: targetConnectionId,
    database: targetDatabase,
    table,
    page,
    pageSize: PAGE_SIZE,
    reloadToken: targetReloadToken,
    orderBy: stableOrderBy,
    onStateChange: setTargetState
  })

  const sourceConnectionName =
    connections.find((connection) => connection.id === sourceConnectionId)?.name ?? sourceConnectionId
  const targetConnectionName =
    connections.find((connection) => connection.id === targetConnectionId)?.name ?? targetConnectionId
  const sourceKeyColumns = sourceState.data?.primaryKey ?? []
  const sourceSelectionEnabled = sourceState.data?.hasPrimaryKey ?? false
  const selectedCount = Object.keys(selectedSourceRows).length
  const selectedKeySet = useMemo(() => new Set(Object.keys(selectedSourceRows)), [selectedSourceRows])
  const visibleSourceKeys = useMemo(() => {
    if (!sourceState.data || !sourceSelectionEnabled) return []

    return sourceState.data.rows
      .map((row) => buildRowKey(row, sourceKeyColumns))
      .filter((key): key is string => key !== null)
  }, [sourceKeyColumns, sourceSelectionEnabled, sourceState.data])
  const visibleSourceKeySet = useMemo(() => new Set(visibleSourceKeys), [visibleSourceKeys])
  const allVisibleSelected =
    visibleSourceKeys.length > 0 && visibleSourceKeys.every((key) => selectedKeySet.has(key))
  const totalPages = useMemo(() => {
    const sourcePages = sourceState.data ? Math.max(1, Math.ceil(sourceState.data.total / PAGE_SIZE)) : 1
    const targetPages = targetState.data ? Math.max(1, Math.ceil(targetState.data.total / PAGE_SIZE)) : 1
    return Math.max(sourcePages, targetPages)
  }, [sourceState.data, targetState.data])
  const rowDiffNavigation = useMemo(
    () => getRowDiffNavigation(comparedTables, diffTables, table),
    [comparedTables, diffTables, table]
  )

  const refreshBoth = () => {
    setSourceReloadToken((current) => current + 1)
    setTargetReloadToken((current) => current + 1)
  }

  const navigateToTable = (nextTable: string) => {
    setRightView({
      kind: 'table-compare',
      compareSessionId,
      sourceConnectionId,
      sourceDatabase,
      targetConnectionId,
      targetDatabase,
      table: nextTable,
      comparedTables,
      diffTables
    })
  }

  const toggleSourceRow = (row: Record<string, unknown>) => {
    const rowKey = buildRowKey(row, sourceKeyColumns)
    if (!rowKey) return

    setSelectedSourceRows((current) => {
      if (current[rowKey]) {
        const { [rowKey]: _removed, ...rest } = current
        return rest
      }

      return {
        ...current,
        [rowKey]: row
      }
    })
  }

  const toggleAllVisibleSourceRows = () => {
    if (!sourceState.data || !sourceSelectionEnabled) return

    const sourceData = sourceState.data

    setSelectedSourceRows((current) => {
      if (allVisibleSelected) {
        return Object.fromEntries(
          Object.entries(current).filter(([rowKey]) => !visibleSourceKeySet.has(rowKey))
        )
      }

      const next = { ...current }
      for (const row of sourceData.rows) {
        const rowKey = buildRowKey(row, sourceKeyColumns)
        if (rowKey) next[rowKey] = row
      }
      return next
    })
  }

  const copySelectedRows = async () => {
    if (!targetState.data || selectedCount === 0) return

    setCopying(true)

    const failedRowKeys = new Set<string>()
    let inserted = 0
    let failed = 0
    let firstError: string | null = null

    try {
      for (const [rowKey, row] of Object.entries(selectedSourceRows)) {
        const values = buildCopyValues(row, targetState.data.columns)
        if (Object.keys(values).length === 0) {
          failed += 1
          failedRowKeys.add(rowKey)
          if (!firstError) {
            firstError = 'No shared target columns are available for the selected row.'
          }
          continue
        }

        try {
          await unwrap(
            api.db.insertRow({
              connectionId: targetConnectionId,
              database: targetDatabase,
              table,
              values
            })
          )
          inserted += 1
        } catch (err) {
          failed += 1
          failedRowKeys.add(rowKey)
          if (!firstError) {
            firstError = (err as Error).message
          }
        }
      }

      if (inserted > 0) {
        setTargetReloadToken((current) => current + 1)
      }

      setSelectedSourceRows((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([rowKey]) => failedRowKeys.has(rowKey))
        )
      )

      showToast(
        failed > 0
          ? `Copied ${inserted} row(s); ${failed} failed${firstError ? `: ${firstError}` : ''}`
          : `Copied ${inserted} row(s) to target`,
        failed > 0 ? 'error' : 'success'
      )
    } finally {
      setCopying(false)
    }
  }

  const syncPaneScroll = (side: 'source' | 'target', event: UIEvent<HTMLDivElement>) => {
    if (syncingScrollRef.current) return

    const activeElement = event.currentTarget
    const peerElement = side === 'source' ? targetScrollRef.current : sourceScrollRef.current

    if (!peerElement) return

    syncingScrollRef.current = true
    peerElement.scrollTop = activeElement.scrollTop
    peerElement.scrollLeft = activeElement.scrollLeft

    if (syncScrollFrameRef.current !== null) {
      cancelAnimationFrame(syncScrollFrameRef.current)
    }

    syncScrollFrameRef.current = requestAnimationFrame(() => {
      syncingScrollRef.current = false
      syncScrollFrameRef.current = null
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="text-xs text-muted-foreground">Side-by-side table compare</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <strong className="truncate">{sourceConnectionName}</strong>
              <span className="text-muted-foreground">/</span>
              <span className="truncate">{sourceDatabase}</span>
              <span className="text-muted-foreground">→</span>
              <strong className="truncate">{targetConnectionName}</strong>
              <span className="text-muted-foreground">/</span>
              <span className="truncate">{targetDatabase}</span>
              <Badge>{table}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {stableOrderColumn
                ? `Ordered by ${stableOrderColumn}; selection tracked by primary key.`
                : 'No shared primary key — rows may not line up across sides.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <Badge>{selectedCount} selected</Badge>
            <Button size="sm" variant="outline" onClick={refreshBoth}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={copySelectedRows}
              disabled={
                copying ||
                selectedCount === 0 ||
                !sourceSelectionEnabled ||
                !targetState.data ||
                targetState.loading
              }
            >
              <ArrowRight className="mr-1 h-4 w-4" />
              {copying ? 'Copying...' : 'Copy selected to Target'}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {rowDiffNavigation.totalDiffTables > 0 && (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={!rowDiffNavigation.previousTable}
                onClick={() =>
                  rowDiffNavigation.previousTable && navigateToTable(rowDiffNavigation.previousTable)
                }
              >
                ← Prev diff
              </Button>
              <span className="tabular-nums">
                {rowDiffNavigation.currentDiffPosition === null
                  ? `${rowDiffNavigation.totalDiffTables} changed`
                  : `Diff ${rowDiffNavigation.currentDiffPosition} / ${rowDiffNavigation.totalDiffTables}`}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={!rowDiffNavigation.nextTable}
                onClick={() => rowDiffNavigation.nextTable && navigateToTable(rowDiffNavigation.nextTable)}
              >
                Next diff →
              </Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              ← Prev
            </Button>
            <span className="tabular-nums">
              Page {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
        {sourceState.data && !sourceState.data.hasPrimaryKey && (
          <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Source table has no primary key, so copy selection is disabled to avoid unstable row targeting.
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-2">
        <TableComparePane
          title="Source"
          connectionName={sourceConnectionName}
          database={sourceDatabase}
          table={table}
          data={sourceState.data}
          error={sourceState.error}
          loading={sourceState.loading}
          scrollContainerRef={sourceScrollRef}
          onScroll={(event) => syncPaneScroll('source', event)}
          selectedKeys={selectedKeySet}
          showSelection={sourceSelectionEnabled}
          selectionEnabled={sourceSelectionEnabled}
          onToggleAllVisible={toggleAllVisibleSourceRows}
          allVisibleSelected={allVisibleSelected}
          onToggleRow={toggleSourceRow}
        />

        <TableComparePane
          title="Target"
          connectionName={targetConnectionName}
          database={targetDatabase}
          table={table}
          data={targetState.data}
          error={targetState.error}
          loading={targetState.loading}
          scrollContainerRef={targetScrollRef}
          onScroll={(event) => syncPaneScroll('target', event)}
          leadingSpacer={sourceSelectionEnabled}
        />
      </div>
    </div>
  )
}

function useComparedTableData({
  connectionId,
  database,
  table,
  page,
  pageSize,
  reloadToken,
  orderBy,
  onStateChange
}: {
  connectionId: string
  database: string
  table: string
  page: number
  pageSize: number
  reloadToken: number
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  onStateChange: Dispatch<SetStateAction<ComparedTableDataState>>
}): void {
  const requestIdRef = useRef(0)

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    onStateChange((current) => ({
      ...current,
      loading: true,
      error: null
    }))

    void (async () => {
      try {
        const data = await unwrap<QueryRowsResult>(
          api.db.queryRows({
            connectionId,
            database,
            table,
            page,
            pageSize,
            orderBy
          })
        )

        if (requestIdRef.current !== requestId) return

        onStateChange({
          data,
          error: null,
          loading: false
        })
      } catch (err) {
        if (requestIdRef.current !== requestId) return

        onStateChange({
          data: null,
          error: (err as Error).message,
          loading: false
        })
      }
    })()
  }, [connectionId, database, onStateChange, orderBy, page, pageSize, reloadToken, table])
}