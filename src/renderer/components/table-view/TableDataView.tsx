// 表数据视图：分页、where 过滤、排序、行 CRUD
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Pencil, RefreshCw, AlertTriangle, Download } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Table, TBody, THead, Th, Tr, Td } from '@renderer/components/ui/table'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Badge } from '@renderer/components/ui/badge'
import { useUIStore } from '@renderer/store/ui-store'
import { formatCellValue, pickPK } from '@renderer/lib/utils'
import { ExportTableDialog } from './ExportTableDialog'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'
import { RowEditDialog } from './RowEditDialog'

interface Props {
  connectionId: string
  database: string
  table: string
}

export function TableDataView({ connectionId, database, table }: Props) {
  const { showToast } = useUIStore()
  const [data, setData] = useState<QueryRowsResult | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(100)
  const [where, setWhere] = useState('')
  const [appliedWhere, setAppliedWhere] = useState('')
  const [orderBy, setOrderBy] = useState<{ column: string; dir: 'ASC' | 'DESC' } | undefined>()
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<{ mode: 'insert' | 'edit'; row?: Record<string, unknown> } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const requestIdRef = useRef(0)

  const refresh = () => setReloadToken((current) => current + 1)

  useEffect(() => {
    setPage(1)
    setOrderBy(undefined)
    setWhere('')
    setAppliedWhere('')
    setSelected(new Set())
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
  }, [appliedWhere, connectionId, database, orderBy, page, pageSize, reloadToken, showToast, table])

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1),
    [data, pageSize]
  )

  const applyWhere = () => {
    setPage(1)
    setAppliedWhere(where.trim())
  }

  const onToggleSelect = (idx: number) => {
    setSelected((prev) => {
      const n = new Set(prev)
      n.has(idx) ? n.delete(idx) : n.add(idx)
      return n
    })
  }

  const onDeleteSelected = async () => {
    if (!data || selected.size === 0) return
    if (!data.hasPrimaryKey) {
      showToast('Refusing: this table has no primary key', 'error')
      return
    }
    if (!confirm(`Delete ${selected.size} row(s)? This cannot be undone.`)) return
    const pkRows = Array.from(selected).map((i) => pickPK(data.rows[i]!, data.primaryKey))
    try {
      const r = await unwrap(api.db.deleteRows({ connectionId, database, table, pkRows }))
      showToast(`Deleted ${(r as { affectedRows: number }).affectedRows} row(s)`, 'success')
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

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <Input
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="WHERE clause, e.g.  status = 1 AND id > 100"
          className="flex-1 h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyWhere()
          }}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={applyWhere}
          disabled={where.trim() === appliedWhere}
        >
          Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={refresh} title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => setExportOpen(true)}>
          <Download className="w-4 h-4" /> Export
        </Button>
        <div className="w-px h-6 bg-border mx-1" />
        <Button size="sm" variant="outline" onClick={() => setEditing({ mode: 'insert' })}>
          <Plus className="w-4 h-4" /> Insert
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={onDeleteSelected}
          disabled={selected.size === 0}
        >
          <Trash2 className="w-4 h-4" /> Delete ({selected.size})
        </Button>
      </div>

      {data && !data.hasPrimaryKey && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs">
          <AlertTriangle className="w-3.5 h-3.5" />
          This table has no primary key — edit and delete are disabled to avoid mass updates.
        </div>
      )}

      {/* 表格 */}
      <div className="flex-1 overflow-auto">
        {loading && <div className="p-3 text-xs text-muted-foreground">Loading...</div>}
        {!loading && data && data.rows.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">
            No rows matched the current query.
          </div>
        )}
        {data && (
          <Table>
            <THead>
              <Tr>
                <Th className="w-8" />
                <Th className="w-8" />
                {data.columns.map((c) => (
                  <Th key={c.name} className="cursor-pointer" onClick={() => onSort(c.name)}>
                    <div className="flex items-center gap-1">
                      {c.isPrimaryKey && <Badge variant="warning">PK</Badge>}
                      <span>{c.name}</span>
                      <span className="text-[10px] text-muted-foreground">{c.type}</span>
                      {orderBy?.column === c.name && (
                        <span className="text-[10px]">{orderBy.dir === 'ASC' ? '▲' : '▼'}</span>
                      )}
                    </div>
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {data.rows.map((row, i) => (
                <Tr key={i}>
                  <Td>
                    <Checkbox
                      checked={selected.has(i)}
                      onChange={() => onToggleSelect(i)}
                      disabled={!data.hasPrimaryKey}
                    />
                  </Td>
                  <Td>
                    <button
                      onClick={() => setEditing({ mode: 'edit', row })}
                      className="text-muted-foreground hover:text-foreground"
                      disabled={!data.hasPrimaryKey}
                      title={data.hasPrimaryKey ? 'Edit row' : 'No primary key'}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </Td>
                  {data.columns.map((c) => (
                    <Td key={c.name} title={formatCellValue(row[c.name])}>
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
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-xs">
          <span className="text-muted-foreground">
            {data.total.toLocaleString()} rows · page {page} / {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Next
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
                showToast('Row inserted', 'success')
              } else {
                await unwrap(
                  api.db.updateRow({ connectionId, database, table, pkValues: pkOld!, changes: values })
                )
                showToast('Row updated', 'success')
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
        />
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
