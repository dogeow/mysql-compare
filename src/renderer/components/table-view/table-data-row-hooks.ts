import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import type { Translator } from '@renderer/i18n'
import { pickPK } from '@renderer/lib/utils'
import type { ExportScope, QueryRowsResult } from '../../../shared/types'
import { toggleRowSelection } from './table-selection-utils'

type ToastLevel = 'info' | 'error' | 'success'
type ShowToast = (message: string, level?: ToastLevel) => void

export interface TableDataEditingState {
  mode: 'insert' | 'edit'
  row?: Record<string, unknown>
}

interface UseTableDataRowActionsArgs {
  connectionId: string
  database: string
  table: string
  data: QueryRowsResult | null
  showToast: ShowToast
  t: Translator
  refresh: () => void
}

interface UseTableDataRowActionsResult {
  selected: Set<number>
  editing: TableDataEditingState | null
  selectedRows: Record<string, unknown>[]
  exportScopes: ExportScope[]
  allRowsOnPageSelected: boolean
  someRowsOnPageSelected: boolean
  selectionShiftPressedRef: MutableRefObject<boolean>
  setEditing: Dispatch<SetStateAction<TableDataEditingState | null>>
  onToggleSelect: (rowIndex: number, shiftKey: boolean) => void
  onToggleSelectPage: () => void
  onClearSelection: () => void
  onCopySelectedRows: () => Promise<void>
  onRowClick: (rowIndex: number, shiftKey: boolean) => void
  onDeleteSelected: () => Promise<void>
  submitEditing: (values: Record<string, unknown>, pkOld?: Record<string, unknown>) => Promise<void>
}

export function useTableDataRowActions({
  connectionId,
  database,
  table,
  data,
  showToast,
  t,
  refresh
}: UseTableDataRowActionsArgs): UseTableDataRowActionsResult {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<TableDataEditingState | null>(null)
  const selectionAnchorRef = useRef<number | null>(null)
  const selectionShiftPressedRef = useRef(false)

  useEffect(() => {
    setSelected(new Set())
    selectionAnchorRef.current = null
    setEditing(null)
  }, [connectionId, database, table])

  useEffect(() => {
    if (!data) return
    setSelected(new Set())
    selectionAnchorRef.current = null
  }, [data])

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

  const onToggleSelect = (rowIndex: number, shiftKey: boolean) => {
    setSelected((current) => {
      const nextSelection = toggleRowSelection({
        selected: current,
        rowIndex,
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
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }

  const onRowClick = (rowIndex: number, shiftKey: boolean) => {
    if (!data?.hasPrimaryKey) return
    onToggleSelect(rowIndex, shiftKey)
  }

  const onDeleteSelected = async () => {
    if (!data || selected.size === 0) return
    if (!data.hasPrimaryKey) {
      showToast(t('tableData.refuseNoPrimaryKey'), 'error')
      return
    }
    if (!confirm(t('tableData.confirmDeleteRows', { count: selected.size }))) return
    const pkRows = Array.from(selected).map((index) => pickPK(data.rows[index]!, data.primaryKey))
    try {
      const result = await unwrap(api.db.deleteRows({ connectionId, database, table, pkRows }))
      showToast(t('tableData.rowsDeleted', { count: (result as { affectedRows: number }).affectedRows }), 'success')
      refresh()
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }

  const submitEditing = async (values: Record<string, unknown>, pkOld?: Record<string, unknown>) => {
    if (!editing) return

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
    } catch (error) {
      showToast((error as Error).message, 'error')
    }
  }

  return {
    selected,
    editing,
    selectedRows,
    exportScopes,
    allRowsOnPageSelected,
    someRowsOnPageSelected,
    selectionShiftPressedRef,
    setEditing,
    onToggleSelect,
    onToggleSelectPage,
    onClearSelection,
    onCopySelectedRows,
    onRowClick,
    onDeleteSelected,
    submitEditing
  }
}