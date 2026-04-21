// 行的新增 / 编辑弹窗。根据列类型选择不同输入控件。
import { useState } from 'react'
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
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    if (mode === 'edit' && row) return { ...row }
    const init: Record<string, unknown> = {}
    for (const c of columns) {
      if (c.isAutoIncrement) continue
      init[c.name] = c.defaultValue ?? (c.nullable ? null : '')
    }
    return init
  })
  const [busy, setBusy] = useState(false)

  // 只提交真正改动过的字段（编辑场景下）
  const handleSubmit = async () => {
    setBusy(true)
    try {
      const changes: Record<string, unknown> = {}
      if (mode === 'insert') {
        for (const c of columns) {
          if (c.isAutoIncrement && (values[c.name] === '' || values[c.name] == null)) continue
          changes[c.name] = values[c.name]
        }
        await onSubmit(changes)
      } else {
        for (const c of columns) {
          if (row && row[c.name] !== values[c.name]) {
            changes[c.name] = values[c.name]
          }
        }
        const pkOld: Record<string, unknown> = {}
        for (const k of primaryKey) pkOld[k] = row?.[k]
        await onSubmit(changes, pkOld)
      }
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
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={busy}>{mode === 'insert' ? 'Insert' : 'Update'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
        {columns.map((c) => (
          <div key={c.name}>
            <Label className="block mb-1">
              {c.name}
              <span className="ml-1 text-[10px] opacity-60">{c.type}</span>
              {c.isPrimaryKey && <span className="ml-1 text-amber-400 text-[10px]">PK</span>}
              {!c.nullable && <span className="ml-1 text-red-400 text-[10px]">*</span>}
            </Label>
            {renderInput(c, values[c.name], (v) => setValues((s) => ({ ...s, [c.name]: v })))}
          </div>
        ))}
      </div>
    </Dialog>
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
  if (
    c.type.startsWith('int') ||
    c.type.startsWith('bigint') ||
    c.type.startsWith('tinyint') ||
    c.type.startsWith('smallint') ||
    c.type.startsWith('decimal') ||
    c.type.startsWith('float') ||
    c.type.startsWith('double')
  ) {
    return (
      <Input
        value={value == null ? '' : String(value)}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? null : v)
        }}
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
