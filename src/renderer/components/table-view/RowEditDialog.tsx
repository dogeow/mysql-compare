// 行的新增 / 编辑弹窗。根据列类型选择不同输入控件。
import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import type { ColumnInfo } from '../../../shared/types'

interface Props {
  mode: 'insert' | 'edit'
  columns: ColumnInfo[]
  primaryKey: string[]
  row?: Record<string, unknown>
  onClose: () => void
  onSubmit: (values: Record<string, unknown>, pkOld?: Record<string, unknown>) => Promise<void>
}

export function RowEditDialog({ mode, columns, primaryKey, row, onClose, onSubmit }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValues(createInitialValues(mode, columns, row))
    setBusy(false)
    setError(null)
  }, [columns, mode, row])

  const hasChanges = useMemo(() => {
    if (mode === 'insert') {
      return columns.some((column) => {
        if (column.isAutoIncrement) return false
        return values[column.name] !== createInitialValue(column)
      })
    }
    if (!row) return false
    return columns.some((column) => row[column.name] !== values[column.name])
  }, [columns, mode, row, values])

  // 只提交真正改动过的字段（编辑场景下）
  const handleSubmit = async () => {
    setError(null)
    setBusy(true)
    try {
      const changes: Record<string, unknown> = {}
      if (mode === 'insert') {
        for (const column of columns) {
          const normalized = normalizeColumnValue(column, values[column.name], mode)
          if (column.isAutoIncrement && normalized == null) continue
          validateColumnValue(column, normalized, mode)
          changes[column.name] = normalized
        }
        await onSubmit(changes)
      } else {
        for (const column of columns) {
          const normalized = normalizeColumnValue(column, values[column.name], mode)
          validateColumnValue(column, normalized, mode)
          if (row && row[column.name] !== normalized) {
            changes[column.name] = normalized
          }
        }
        const pkOld: Record<string, unknown> = {}
        for (const key of primaryKey) pkOld[key] = row?.[key]
        await onSubmit(changes, pkOld)
      }
    } catch (submitError) {
      setError((submitError as Error).message)
      return
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mode === 'insert' ? 'Insert Row' : 'Edit Row'}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy || (mode === 'edit' && !hasChanges)}>
            {mode === 'insert' ? 'Insert' : 'Update'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
        {columns.map((column) => (
          <div key={column.name}>
            <Label className="block mb-1">
              {column.name}
              <span className="ml-1 text-[10px] opacity-60">{column.type}</span>
              {column.isPrimaryKey && <span className="ml-1 text-amber-400 text-[10px]">PK</span>}
              {!column.nullable && <span className="ml-1 text-red-400 text-[10px]">*</span>}
            </Label>
            {renderInput(column, values[column.name], (nextValue) => {
              setError(null)
              setValues((state) => ({ ...state, [column.name]: nextValue }))
            })}
          </div>
        ))}
      </div>
      {error && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
    </Dialog>
  )
}

function createInitialValues(
  mode: 'insert' | 'edit',
  columns: ColumnInfo[],
  row?: Record<string, unknown>
): Record<string, unknown> {
  if (mode === 'edit' && row) return { ...row }
  const init: Record<string, unknown> = {}
  for (const column of columns) {
    if (column.isAutoIncrement) continue
    init[column.name] = createInitialValue(column)
  }
  return init
}

function createInitialValue(column: ColumnInfo): unknown {
  return column.defaultValue ?? (column.nullable ? null : '')
}

function normalizeColumnValue(
  column: ColumnInfo,
  value: unknown,
  mode: 'insert' | 'edit'
): unknown {
  if (column.type === 'tinyint(1)') {
    return value === 1 || value === true || value === '1' ? 1 : 0
  }

  if (value === undefined) {
    return mode === 'insert' ? null : value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') {
      return column.nullable || column.isAutoIncrement ? null : ''
    }

    if (isNumericColumn(column)) {
      const numericValue = Number(trimmed)
      if (!Number.isFinite(numericValue)) {
        throw new Error(`"${column.name}" must be a valid number`)
      }
      return numericValue
    }

    if (column.type === 'json') {
      try {
        JSON.parse(trimmed)
      } catch {
        throw new Error(`"${column.name}" must contain valid JSON`)
      }
    }

    return trimmed
  }

  return value
}

function validateColumnValue(
  column: ColumnInfo,
  value: unknown,
  mode: 'insert' | 'edit'
): void {
  if (column.isAutoIncrement && mode === 'insert' && value == null) return
  if (!column.nullable && (value === null || value === undefined || value === '')) {
    throw new Error(`"${column.name}" is required`)
  }
}

function isNumericColumn(column: ColumnInfo): boolean {
  return (
    column.type.startsWith('int') ||
    column.type.startsWith('bigint') ||
    column.type.startsWith('tinyint') ||
    column.type.startsWith('smallint') ||
    column.type.startsWith('decimal') ||
    column.type.startsWith('float') ||
    column.type.startsWith('double')
  )
}

function renderInput(
  c: ColumnInfo,
  value: unknown,
  onChange: (v: unknown) => void
): React.ReactNode {
  // tinyint(1) → boolean
  if (c.type === 'tinyint(1)') {
    return (
      <Checkbox
        checked={value === 1 || value === true || value === '1'}
        onChange={(e) => onChange(e.target.checked ? 1 : 0)}
      />
    )
  }
  if (c.type.startsWith('text') || c.type === 'json' || c.type.includes('blob')) {
    return (
      <textarea
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
      />
    )
  }
  if (isNumericColumn(c)) {
    return (
      <Input
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  // 默认 string
  return (
    <Input
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
