import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, RefreshCw } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Table, TBody, Td, THead, Th, Tr } from '@renderer/components/ui/table'
import { cn, formatCellValue } from '@renderer/lib/utils'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'
import { buildCopyValues, buildRowKey } from './table-compare-utils'

interface Props {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  table: string
}

interface ComparedTableDataState {
  data: QueryRowsResult | null
  error: string | null
  loading: boolean
}

const PAGE_SIZE = 100

export function TableCompareView({
  sourceConnectionId,
  sourceDatabase,
  targetConnectionId,
  targetDatabase,
  table
}: Props) {
  const { connections } = useConnectionStore()
  const { showToast } = useUIStore()
  const [page, setPage] = useState(1)
  const [sourceReloadToken, setSourceReloadToken] = useState(0)
  const [targetReloadToken, setTargetReloadToken] = useState(0)
  const [selectedSourceRows, setSelectedSourceRows] = useState<Record<string, Record<string, unknown>>>({})
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    setPage(1)
    setSelectedSourceRows({})
  }, [sourceConnectionId, sourceDatabase, targetConnectionId, targetDatabase, table])

  const sourceState = useComparedTableData({
    connectionId: sourceConnectionId,
    database: sourceDatabase,
    table,
    page,
    pageSize: PAGE_SIZE,
    reloadToken: sourceReloadToken
  })
  const targetState = useComparedTableData({
    connectionId: targetConnectionId,
    database: targetDatabase,
    table,
    page,
    pageSize: PAGE_SIZE,
    reloadToken: targetReloadToken
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
  const allVisibleSelected =
    visibleSourceKeys.length > 0 && visibleSourceKeys.every((key) => selectedKeySet.has(key))
  const totalPages = useMemo(() => {
    const sourcePages = sourceState.data ? Math.max(1, Math.ceil(sourceState.data.total / PAGE_SIZE)) : 1
    const targetPages = targetState.data ? Math.max(1, Math.ceil(targetState.data.total / PAGE_SIZE)) : 1
    return Math.max(sourcePages, targetPages)
  }, [sourceState.data, targetState.data])

  const refreshBoth = () => {
    setSourceReloadToken((current) => current + 1)
    setTargetReloadToken((current) => current + 1)
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
          Object.entries(current).filter(([rowKey]) => !visibleSourceKeys.includes(rowKey))
        )
      }

      return sourceData.rows.reduce<Record<string, Record<string, unknown>>>((next, row) => {
        const rowKey = buildRowKey(row, sourceKeyColumns)
        if (!rowKey) return next
        return {
          ...next,
          [rowKey]: row
        }
      }, current)
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-border bg-card px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
        <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground xl:flex-row xl:items-center xl:justify-between">
          <span>
            Source selection is tracked by primary key so you can keep selected rows while paging.
          </span>
          <div className="flex items-center gap-2">
            <span>
              Page {page} / {totalPages}
            </span>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
        {sourceState.data && !sourceState.data.hasPrimaryKey && (
          <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Source table has no primary key, so copy selection is disabled to avoid unstable row targeting.
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_minmax(3rem,auto)_minmax(0,1fr)]">
        <TableComparePane
          title="Source"
          connectionName={sourceConnectionName}
          database={sourceDatabase}
          table={table}
          state={sourceState}
          selectedKeys={selectedKeySet}
          showSelection
          selectionEnabled={sourceSelectionEnabled}
          onToggleAllVisible={toggleAllVisibleSourceRows}
          allVisibleSelected={allVisibleSelected}
          onToggleRow={toggleSourceRow}
        />

        <div className="hidden xl:flex min-h-0 items-center justify-center text-muted-foreground">
          <div className="rounded-full border border-border/60 bg-card/60 p-3">
            <ArrowRight className="h-5 w-5" />
          </div>
        </div>

        <TableComparePane
          title="Target"
          connectionName={targetConnectionName}
          database={targetDatabase}
          table={table}
          state={targetState}
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
  reloadToken
}: {
  connectionId: string
  database: string
  table: string
  page: number
  pageSize: number
  reloadToken: number
}): ComparedTableDataState {
  const requestIdRef = useRef(0)
  const [state, setState] = useState<ComparedTableDataState>({
    data: null,
    error: null,
    loading: false
  })

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    setState((current) => ({
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
            pageSize
          })
        )

        if (requestIdRef.current !== requestId) return

        setState({
          data,
          error: null,
          loading: false
        })
      } catch (err) {
        if (requestIdRef.current !== requestId) return

        setState({
          data: null,
          error: (err as Error).message,
          loading: false
        })
      }
    })()
  }, [connectionId, database, page, pageSize, reloadToken, table])

  return state
}

function TableComparePane({
  title,
  connectionName,
  database,
  table,
  state,
  selectedKeys,
  showSelection = false,
  selectionEnabled = false,
  allVisibleSelected = false,
  onToggleAllVisible,
  onToggleRow
}: {
  title: string
  connectionName: string
  database: string
  table: string
  state: ComparedTableDataState
  selectedKeys?: Set<string>
  showSelection?: boolean
  selectionEnabled?: boolean
  allVisibleSelected?: boolean
  onToggleAllVisible?: () => void
  onToggleRow?: (row: Record<string, unknown>) => void
}) {
  const tableData = state.data

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded border border-border bg-card/40">
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{title}</div>
            <div className="truncate text-sm font-medium">{connectionName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {database} / {table}
            </div>
          </div>
          {state.data && (
            <div className="shrink-0 text-right text-[11px] text-muted-foreground">
              <div>{state.data.total.toLocaleString()} rows</div>
              <div>
                {state.data.hasPrimaryKey
                  ? `PK: ${state.data.primaryKey.join(', ')}`
                  : 'No primary key'}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {state.loading && <div className="p-3 text-xs text-muted-foreground">Loading rows...</div>}
        {!state.loading && state.error && (
          <div className="p-3 text-xs text-red-300 break-all">{state.error}</div>
        )}
        {!state.loading && !state.error && tableData && tableData.rows.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">No rows found on this page.</div>
        )}
        {tableData && tableData.rows.length > 0 && (
          <Table>
            <THead>
              <Tr>
                {showSelection && (
                  <Th className="w-8">
                    <Checkbox
                      checked={allVisibleSelected}
                      onChange={() => onToggleAllVisible?.()}
                      disabled={!selectionEnabled}
                    />
                  </Th>
                )}
                {tableData.columns.map((column) => (
                  <Th key={column.name}>
                    <div className="flex items-center gap-1">
                      {column.isPrimaryKey && <Badge variant="warning">PK</Badge>}
                      <span>{column.name}</span>
                      <span className="text-[10px] text-muted-foreground">{column.type}</span>
                    </div>
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {tableData.rows.map((row, index) => {
                const rowKey = buildRowKey(row, tableData.primaryKey) ?? `${title}-${index}`
                const selected = selectedKeys?.has(rowKey) ?? false

                return (
                  <Tr key={rowKey} className={cn(selected && 'bg-accent/30')}>
                    {showSelection && (
                      <Td>
                        <Checkbox
                          checked={selected}
                          onChange={() => onToggleRow?.(row)}
                          disabled={!selectionEnabled}
                        />
                      </Td>
                    )}
                    {tableData.columns.map((column) => (
                      <Td key={column.name} title={renderCellValue(row[column.name], column)}>
                        {renderCellValue(row[column.name], column)}
                      </Td>
                    ))}
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}

function renderCellValue(value: unknown, column: ColumnInfo): string {
  if (value === null || value === undefined) return 'NULL'
  if (column.type === 'tinyint(1)') return value ? '✓' : '✗'
  return formatCellValue(value)
}