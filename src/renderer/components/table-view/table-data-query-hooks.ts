import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'

type ToastLevel = 'info' | 'error' | 'success'
type ShowToast = (message: string, level?: ToastLevel) => void

export type TableDataSortOrder = { column: string; dir: 'ASC' | 'DESC' } | undefined

interface UseTableDataQueryArgs {
  connectionId: string
  database: string
  table: string
  tableReloadToken: number
  showToast: ShowToast
}

interface UseTableDataQueryResult {
  data: QueryRowsResult | null
  loading: boolean
  page: number
  pageDraft: string
  pageSize: number
  where: string
  appliedWhere: string
  orderBy: TableDataSortOrder
  visibleColumns: Set<string>
  wrapCells: boolean
  density: 'compact' | 'comfortable'
  totalPages: number
  visibleDataColumns: ColumnInfo[]
  hiddenColumnCount: number
  hasPendingWhere: boolean
  setWhere: Dispatch<SetStateAction<string>>
  setPageDraft: Dispatch<SetStateAction<string>>
  setWrapCells: Dispatch<SetStateAction<boolean>>
  setDensity: Dispatch<SetStateAction<'compact' | 'comfortable'>>
  setVisibleColumns: Dispatch<SetStateAction<Set<string>>>
  refresh: () => void
  applyWhere: () => void
  clearWhere: () => void
  goToPage: (nextPage: number) => void
  submitPageDraft: () => void
  onPageSizeChange: (pageSize: number) => void
  onSort: (column: string) => void
  setColumnVisibility: (columnName: string, visible: boolean) => void
}

export function useTableDataQuery({
  connectionId,
  database,
  table,
  tableReloadToken,
  showToast
}: UseTableDataQueryArgs): UseTableDataQueryResult {
  const [data, setData] = useState<QueryRowsResult | null>(null)
  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  const [pageSize, setPageSize] = useState(100)
  const [where, setWhere] = useState('')
  const [appliedWhere, setAppliedWhere] = useState('')
  const [orderBy, setOrderBy] = useState<TableDataSortOrder>()
  const [loading, setLoading] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set())
  const [wrapCells, setWrapCells] = useState(false)
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact')
  const [reloadToken, setReloadToken] = useState(0)
  const requestIdRef = useRef(0)

  const refresh = () => setReloadToken((current) => current + 1)

  useEffect(() => {
    setPage(1)
    setPageDraft('1')
    setOrderBy(undefined)
    setWhere('')
    setAppliedWhere('')
    setVisibleColumns(new Set())
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
      } catch (error) {
        if (requestId !== requestIdRef.current) return
        setData(null)
        showToast((error as Error).message, 'error')
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
  const hasPendingWhere = where.trim() !== appliedWhere

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

  const onPageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize)
    setPage(1)
  }

  const onSort = (column: string) => {
    setPage(1)
    setOrderBy((current) => {
      if (!current || current.column !== column) return { column, dir: 'ASC' }
      if (current.dir === 'ASC') return { column, dir: 'DESC' }
      return undefined
    })
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

  return {
    data,
    loading,
    page,
    pageDraft,
    pageSize,
    where,
    appliedWhere,
    orderBy,
    visibleColumns,
    wrapCells,
    density,
    totalPages,
    visibleDataColumns,
    hiddenColumnCount,
    hasPendingWhere,
    setWhere,
    setPageDraft,
    setWrapCells,
    setDensity,
    setVisibleColumns,
    refresh,
    applyWhere,
    clearWhere,
    goToPage,
    submitPageDraft,
    onPageSizeChange,
    onSort,
    setColumnVisibility
  }
}