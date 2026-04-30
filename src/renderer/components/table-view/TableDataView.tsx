// 表数据视图：分页、where 过滤、排序、行 CRUD
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  Download,
  Filter,
  ListRestart,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  WrapText,
  X
} from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { Table, TBody, THead, Th, Tr, Td } from '@renderer/components/ui/table'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Badge } from '@renderer/components/ui/badge'
import { useUIStore } from '@renderer/store/ui-store'
import { cn, formatCellValue, pickPK } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import { ExportTableDialog } from './ExportTableDialog'
import type { ColumnInfo, ExportScope, QueryRowsResult } from '../../../shared/types'
import { RowEditDialog } from './RowEditDialog'
import { toggleRowSelection } from './table-selection-utils'

interface Props {
  connectionId: string
  database: string
  table: string
}

export function TableDataView({ connectionId, database, table }: Props) {
  const { showToast } = useUIStore()
  const tableReloadToken = useUIStore(
    (state) => state.tableReloadTokens[`${connectionId}:${database}:${table}`] ?? 0
  )
  const { t } = useI18n()
  const [data, setData] = useState<QueryRowsResult | null>(null)
  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  const [pageSize, setPageSize] = useState(100)
  const [where, setWhere] = useState('')
  const [appliedWhere, setAppliedWhere] = useState('')
  const [orderBy, setOrderBy] = useState<{ column: string; dir: 'ASC' | 'DESC' } | undefined>()
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<{ mode: 'insert' | 'edit'; row?: Record<string, unknown> } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [columnPanelOpen, setColumnPanelOpen] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set())
  const [wrapCells, setWrapCells] = useState(false)
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact')
  const [reloadToken, setReloadToken] = useState(0)
  const requestIdRef = useRef(0)
  const selectionAnchorRef = useRef<number | null>(null)
  const selectionShiftPressedRef = useRef(false)

  const refresh = () => setReloadToken((current) => current + 1)

  useEffect(() => {
    setPage(1)
    setPageDraft('1')
    setOrderBy(undefined)
    setWhere('')
    setAppliedWhere('')
    setSelected(new Set())
    setVisibleColumns(new Set())
    selectionAnchorRef.current = null
    setEditing(null)
    setData(null)
  }, [connectionId, database, table])

  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)

    void (async () => {
      try {
        const result = await unwrap<QueryRowsResult>(
          api.db.queryRows({
            connectionId,
            database,
            table,
            page,
            pageSize,
            orderBy,
            where: appliedWhere || undefined
          })
        )
        if (requestId !== requestIdRef.current) return
        setData(result)
        setSelected(new Set())
        selectionAnchorRef.current = null
      } catch (err) {
        if (requestId !== requestIdRef.current) return
        setData(null)
        showToast((err as Error).message, 'error')
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false)
        }
      }
    })()
  }, [appliedWhere, connectionId, database, orderBy, page, pageSize, reloadToken, showToast, table, tableReloadToken])

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1),
    [data, pageSize]
  )

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  useEffect(() => {
    setPageDraft(String(page))
  }, [page])

  useEffect(() => {
    if (!data) return
    const allColumns = data.columns.map((column) => column.name)
    setVisibleColumns((current) => {
      if (current.size === 0) return new Set(allColumns)

      const next = new Set(allColumns.filter((column) => current.has(column)))
      return next.size > 0 ? next : new Set(allColumns)
    })
  }, [data])

  const visibleDataColumns = useMemo(
    () => (data ? data.columns.filter((column) => visibleColumns.has(column.name)) : []),
    [data, visibleColumns]
  )
  const hiddenColumnCount = data ? data.columns.length - visibleDataColumns.length : 0
  const selectedRows = useMemo(
    () =>
      data
        ? Array.from(selected).flatMap((index) => {
            const row = data.rows[index]
            return row ? [row] : []
          })
        : [],
    [data, selected]
  )
  const exportScopes = useMemo<ExportScope[]>(
    () => (selectedRows.length > 0 ? ['all', 'filtered', 'page', 'selected'] : ['all', 'filtered', 'page']),
    [selectedRows.length]
  )

  const allRowsOnPageSelected = Boolean(
    data?.hasPrimaryKey && data.rows.length > 0 && selected.size === data.rows.length
  )
  const someRowsOnPageSelected = Boolean(
    data?.hasPrimaryKey && selected.size > 0 && selected.size < data.rows.length
  )

  const applyWhere = () => {
    setPage(1)
    setAppliedWhere(where.trim())
  }

  const clearWhere = () => {
    setWhere('')
    if (!appliedWhere) return
    setPage(1)
    setAppliedWhere('')
  }

  const goToPage = (nextPage: number) => {
    const safePage = Math.max(1, Math.min(totalPages, nextPage))
    setPage(safePage)
  }

  const submitPageDraft = () => {
    const parsed = Number.parseInt(pageDraft, 10)
    if (Number.isFinite(parsed)) {
      goToPage(parsed)
      return
    }
    setPageDraft(String(page))
  }

  const onToggleSelect = (idx: number, shiftKey: boolean) => {
    setSelected((prev) => {
      const nextSelection = toggleRowSelection({
        selected: prev,
        rowIndex: idx,
        anchorIndex: selectionAnchorRef.current,
        shiftKey
      })

      selectionAnchorRef.current = nextSelection.anchorIndex
      return nextSelection.selected
    })
  }

  const onToggleSelectPage = () => {
    if (!data?.hasPrimaryKey) return

    setSelected((current) => {
      if (current.size === data.rows.length) {
        selectionAnchorRef.current = null
        return new Set()
      }

      selectionAnchorRef.current = 0
      return new Set(data.rows.map((_row, index) => index))
    })
  }

  const onClearSelection = () => {
    selectionAnchorRef.current = null
    setSelected(new Set())
  }

  const onCopySelectedRows = async () => {
    if (selectedRows.length === 0) return

    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedRows, null, 2))
      showToast(t('tableData.copiedRows', { count: selectedRows.length }), 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  const setColumnVisibility = (columnName: string, visible: boolean) => {
    setVisibleColumns((current) => {
      const next = new Set(current)
      if (visible) {
        next.add(columnName)
        return next
      }
      if (next.size <= 1) return current
      next.delete(columnName)
      return next
    })
  }

  const onRowClick = (idx: number, shiftKey: boolean) => {
    if (!data?.hasPrimaryKey) return
    onToggleSelect(idx, shiftKey)
  }

  const onDeleteSelected = async () => {
    if (!data || selected.size === 0) return
    if (!data.hasPrimaryKey) {
      showToast(t('tableData.refuseNoPrimaryKey'), 'error')
      return
    }
    if (!confirm(t('tableData.confirmDeleteRows', { count: selected.size }))) return
    const pkRows = Array.from(selected).map((i) => pickPK(data.rows[i]!, data.primaryKey))
    try {
      const r = await unwrap(api.db.deleteRows({ connectionId, database, table, pkRows }))
      showToast(t('tableData.rowsDeleted', { count: (r as { affectedRows: number }).affectedRows }), 'success')
      refresh()
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  const onSort = (column: string) => {
    setPage(1)
    setOrderBy((cur) => {
      if (!cur || cur.column !== column) return { column, dir: 'ASC' }
      if (cur.dir === 'ASC') return { column, dir: 'DESC' }
      return undefined
    })
  }

  const hasPendingWhere = where.trim() !== appliedWhere

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="border-b border-border bg-card/70 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[18rem] flex-[1_1_24rem]">
            <Filter className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              placeholder={t('tableData.whereClausePlaceholder')}
              className="h-8 pl-8 pr-8 font-mono text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyWhere()
                if (e.key === 'Escape') clearWhere()
              }}
            />
            {(where || appliedWhere) && (
              <button
                type="button"
                className="absolute right-2 top-1/2 rounded p-0.5 text-muted-foreground -translate-y-1/2 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={clearWhere}
                title={t('tableData.clearFilter')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={applyWhere} disabled={!hasPendingWhere}>
              {t('common.apply')}
            </Button>
            <Button size="sm" variant="ghost" onClick={refresh} disabled={loading} title={t('common.refresh')}>
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
              <Download className="w-4 h-4" /> {t('common.export')}
            </Button>
            {data && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setColumnPanelOpen(true)}
                  title={t('tableData.columnsPanel')}
                >
                  <Columns3 className="h-4 w-4" />
                  {t('tableData.columnsCount', {
                    visible: visibleDataColumns.length,
                    total: data.columns.length
                  })}
                </Button>
                <Button
                  size="sm"
                  variant={wrapCells ? 'secondary' : 'ghost'}
                  onClick={() => setWrapCells((current) => !current)}
                  title={t('tableData.toggleWrap')}
                >
                  <WrapText className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={density === 'comfortable' ? 'secondary' : 'ghost'}
                  onClick={() =>
                    setDensity((current) => (current === 'compact' ? 'comfortable' : 'compact'))
                  }
                  title={t('tableData.toggleDensity')}
                >
                  <ListRestart className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>

          <div className="mx-1 h-6 w-px bg-border" />

          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => setEditing({ mode: 'insert' })}>
              <Plus className="w-4 h-4" /> {t('common.insert')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onDeleteSelected}
              disabled={selected.size === 0}
            >
              <Trash2 className="w-4 h-4" /> {t('tableData.deleteCount', { count: selected.size })}
            </Button>
            {selected.size > 0 && (
              <>
                <Button size="sm" variant="ghost" onClick={onCopySelectedRows}>
                  <Copy className="h-4 w-4" /> {t('tableData.copySelected')}
                </Button>
                <Button size="sm" variant="ghost" onClick={onClearSelection}>
                  <X className="h-4 w-4" /> {t('tableData.clearSelection')}
                </Button>
                <Badge className="ml-1">{t('tableData.selectedRows', { count: selected.size })}</Badge>
              </>
            )}
          </div>
        </div>
      </div>

      {data && !data.hasPrimaryKey && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs">
          <AlertTriangle className="w-3.5 h-3.5" />
          {t('tableData.noPrimaryKeyHint')}
        </div>
      )}

      {/* 表格 */}
      <div className="relative flex-1 overflow-auto">
        {loading && data && (
          <div className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-md border border-border bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-sm">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t('common.loading')}
          </div>
        )}
        {loading && !data && (
          <div className="flex h-full items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            {t('common.loading')}
          </div>
        )}
        {!loading && data && data.rows.length === 0 && (
          <div className="flex h-full items-center justify-center p-6 text-xs text-muted-foreground">
            {t('tableData.noRowsMatched')}
          </div>
        )}
        {data && (
          <Table>
            <THead>
              <Tr>
                <Th className="sticky left-0 z-20 w-8 bg-card">
                  <Checkbox
                    ref={(element) => {
                      if (element) element.indeterminate = someRowsOnPageSelected
                    }}
                    checked={allRowsOnPageSelected}
                    disabled={!data.hasPrimaryKey || data.rows.length === 0}
                    aria-label={t('tableData.selectPageRows')}
                    onChange={onToggleSelectPage}
                  />
                </Th>
                <Th className="sticky left-8 z-20 w-8 bg-card" />
                {visibleDataColumns.map((c) => (
                  <Th
                    key={c.name}
                    className="cursor-pointer select-none"
                    onClick={() => onSort(c.name)}
                    aria-sort={
                      orderBy?.column === c.name
                        ? orderBy.dir === 'ASC'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                    title={t('tableData.sortColumn')}
                  >
                    <div className="flex flex-col items-start gap-1 whitespace-normal py-1 leading-tight">
                      <div className="flex flex-wrap items-center gap-1">
                        {c.isPrimaryKey && <Badge variant="warning">PK</Badge>}
                        <span>{c.name}</span>
                        <span className="text-[10px] text-muted-foreground">{c.type}</span>
                        {orderBy?.column === c.name && (
                          <span className="text-[10px]">{orderBy.dir === 'ASC' ? '▲' : '▼'}</span>
                        )}
                      </div>
                      {c.comment && (
                        <span
                          className="max-w-[14rem] truncate text-[10px] font-normal text-amber-300/90"
                          title={c.comment}
                        >
                          {c.comment}
                        </span>
                      )}
                    </div>
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {data.rows.map((row, i) => (
                <Tr
                  key={i}
                  className={cn(
                    'group',
                    data.hasPrimaryKey && 'cursor-pointer',
                    selected.has(i) && 'bg-accent/70 hover:bg-accent/80'
                  )}
                  onClick={(event) => onRowClick(i, event.shiftKey)}
                  onDoubleClick={() => {
                    if (data.hasPrimaryKey) setEditing({ mode: 'edit', row })
                  }}
                >
                  <Td
                    className={cn(
                      'sticky left-0 z-10 bg-background group-hover:bg-muted/40',
                      selected.has(i) && 'bg-accent/70 group-hover:bg-accent/80'
                    )}
                  >
                    <Checkbox
                      checked={selected.has(i)}
                      aria-label={t('tableData.selectRow', { index: i + 1 })}
                      onClick={(event) => {
                        event.stopPropagation()
                        selectionShiftPressedRef.current = event.shiftKey
                      }}
                      onChange={() => {
                        const shiftKey = selectionShiftPressedRef.current
                        selectionShiftPressedRef.current = false
                        onToggleSelect(i, shiftKey)
                      }}
                      disabled={!data.hasPrimaryKey}
                    />
                  </Td>
                  <Td
                    className={cn(
                      'sticky left-8 z-10 bg-background group-hover:bg-muted/40',
                      selected.has(i) && 'bg-accent/70 group-hover:bg-accent/80'
                    )}
                  >
                    <button
                      onClick={(event) => {
                        event.stopPropagation()
                        setEditing({ mode: 'edit', row })
                      }}
                      className="text-muted-foreground hover:text-foreground"
                      disabled={!data.hasPrimaryKey}
                      title={data.hasPrimaryKey ? t('tableData.editRow') : t('tableData.noPk')}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </Td>
                  {visibleDataColumns.map((c) => (
                    <Td
                      key={c.name}
                      title={formatCellValue(row[c.name])}
                      className={cn(
                        density === 'comfortable' && 'py-2.5',
                        wrapCells
                          ? 'max-w-md whitespace-pre-wrap break-words overflow-visible text-clip align-top'
                          : 'max-w-xs truncate whitespace-nowrap'
                      )}
                    >
                      {renderCell(row[c.name], c)}
                    </Td>
                  ))}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      {/* 分页 */}
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card/70 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {t('tableData.rowsPagination', {
              total: data.total.toLocaleString(),
              page,
              totalPages
            })}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-muted-foreground">
              <span>{t('tableData.pageSize')}</span>
              <Select
                value={String(pageSize)}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
                options={[
                  { value: '50', label: '50' },
                  { value: '100', label: '100' },
                  { value: '250', label: '250' },
                  { value: '500', label: '500' }
                ]}
                className="h-7 w-20 px-2 text-xs"
                aria-label={t('tableData.pageSize')}
              />
            </label>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
              {t('common.prev')}
            </Button>
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>{t('tableData.pageLabel')}</span>
              <Input
                type="number"
                min={1}
                max={totalPages}
                value={pageDraft}
                onChange={(event) => setPageDraft(event.target.value)}
                onBlur={submitPageDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    submitPageDraft()
                    event.currentTarget.blur()
                  }
                  if (event.key === 'Escape') {
                    setPageDraft(String(page))
                    event.currentTarget.blur()
                  }
                }}
                aria-label={t('tableData.pageInput')}
                className="h-7 w-16 px-2 text-center text-xs"
              />
              <span>/ {totalPages}</span>
            </div>
            {hiddenColumnCount > 0 && (
              <span className="text-muted-foreground">
                {t('tableData.hiddenColumns', { count: hiddenColumnCount })}
              </span>
            )}
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
              {t('common.next')}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {editing && data && (
        <RowEditDialog
          mode={editing.mode}
          columns={data.columns}
          primaryKey={data.primaryKey}
          row={editing.row}
          onClose={() => setEditing(null)}
          onSubmit={async (values, pkOld) => {
            try {
              if (editing.mode === 'insert') {
                await unwrap(api.db.insertRow({ connectionId, database, table, values }))
                showToast(t('tableData.rowInserted'), 'success')
              } else {
                await unwrap(
                  api.db.updateRow({ connectionId, database, table, pkValues: pkOld!, changes: values })
                )
                showToast(t('tableData.rowUpdated'), 'success')
              }
              setEditing(null)
              refresh()
            } catch (err) {
              showToast((err as Error).message, 'error')
            }
          }}
        />
      )}

      {exportOpen && (
        <ExportTableDialog
          open
          onOpenChange={setExportOpen}
          connectionId={connectionId}
          database={database}
          table={table}
          where={appliedWhere || undefined}
          orderBy={orderBy}
          page={page}
          pageSize={pageSize}
          availableScopes={exportScopes}
          selectedRows={selectedRows}
        />
      )}

      {columnPanelOpen && data && (
        <Dialog
          open
          onOpenChange={setColumnPanelOpen}
          title={t('tableData.columnsPanel')}
          description={t('tableData.columnsPanelDescription')}
          className="max-w-2xl"
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setVisibleColumns(new Set(data.columns.map((column) => column.name)))}
              >
                {t('tableData.showAllColumns')}
              </Button>
              <Button onClick={() => setColumnPanelOpen(false)}>{t('common.close')}</Button>
            </>
          }
        >
          <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <span>
              {t('tableData.columnsCount', {
                visible: visibleDataColumns.length,
                total: data.columns.length
              })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const primaryColumns = data.columns.filter((column) => column.isPrimaryKey)
                if (primaryColumns.length === 0) return
                setVisibleColumns(new Set(primaryColumns.map((column) => column.name)))
              }}
              disabled={!data.columns.some((column) => column.isPrimaryKey)}
            >
              {t('tableData.showPrimaryColumns')}
            </Button>
          </div>
          <div className="grid max-h-[52vh] gap-2 overflow-auto pr-1 sm:grid-cols-2">
            {data.columns.map((column) => {
              const checked = visibleColumns.has(column.name)
              return (
                <Label
                  key={column.name}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background p-2 text-foreground hover:bg-accent/60"
                >
                  <Checkbox
                    checked={checked}
                    disabled={checked && visibleColumns.size <= 1}
                    onChange={(event) => setColumnVisibility(column.name, event.currentTarget.checked)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-1">
                      <span className="truncate text-xs font-medium">{column.name}</span>
                      {column.isPrimaryKey && <Badge variant="warning">PK</Badge>}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">{column.type}</span>
                    {column.comment && (
                      <span className="block truncate text-[10px] text-amber-300/90">{column.comment}</span>
                    )}
                  </span>
                </Label>
              )
            })}
          </div>
        </Dialog>
      )}
    </div>
  )
}

function renderCell(v: unknown, c: ColumnInfo): string {
  if (v === null || v === undefined) return 'NULL'
  // tinyint(1) 视作布尔
  if (c.type === 'tinyint(1)') return v ? '✓' : '✗'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
