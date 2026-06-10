import { useState } from 'react'
import { Braces } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import type { ColumnInfo } from '../../../shared/types'
import { JsonViewerDialog } from './JsonViewerDialog'

interface Props {
  column: ColumnInfo
  row: Record<string, unknown>
  content: string
  readOnly?: boolean
  onSave?: (row: Record<string, unknown>, column: string, value: string) => Promise<void>
}

export function JsonViewerTrigger({ column, row, content, readOnly = false, onSave }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="shrink-0 rounded border border-border bg-background p-1 text-muted-foreground hover:text-foreground"
        title={t('tableData.viewJson')}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <Braces className="h-3 w-3" />
      </button>
      {open && (
        <JsonViewerDialog
          state={{ column, row, content }}
          readOnly={readOnly}
          onClose={() => setOpen(false)}
          onSave={onSave}
        />
      )}
    </>
  )
}
