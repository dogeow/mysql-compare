import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { api, unwrap } from '@renderer/lib/api'
import { useUIStore } from '@renderer/store/ui-store'
import type { ExportScope, ExportTableRequest, ExportTableResult } from '../../../shared/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
  table: string
  where?: string
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
  page?: number
  pageSize?: number
  availableScopes?: ExportScope[]
}

const scopeLabels: Record<ExportScope, string> = {
  all: 'Entire table',
  filtered: 'Current filter result',
  page: 'Current page'
}

export function ExportTableDialog({
  open,
  onOpenChange,
  connectionId,
  database,
  table,
  where,
  orderBy,
  page,
  pageSize,
  availableScopes = ['all', 'filtered', 'page']
}: Props) {
  const { showToast } = useUIStore()
  const [format, setFormat] = useState<'sql' | 'csv' | 'txt'>('sql')
  const [scope, setScope] = useState<ExportScope>(availableScopes[0] ?? 'all')
  const [includeCreateTable, setIncludeCreateTable] = useState(true)
  const [includeData, setIncludeData] = useState(true)
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const [busy, setBusy] = useState(false)

  const scopeOptions = useMemo(
    () => availableScopes.map((value) => ({ value, label: scopeLabels[value] })),
    [availableScopes]
  )

  useEffect(() => {
    if (!open) return
    setFormat('sql')
    setScope(availableScopes[0] ?? 'all')
    setIncludeCreateTable(true)
    setIncludeData(true)
    setIncludeHeaders(true)
  }, [availableScopes, connectionId, database, open, table])

  const canExport = format === 'sql' ? includeCreateTable || includeData : true

  const submit = async () => {
    if (!canExport) {
      showToast('Select structure or data for SQL export', 'error')
      return
    }

    const request: ExportTableRequest = {
      connectionId,
      database,
      table,
      format,
      scope,
      where: scope === 'all' ? undefined : where,
      orderBy,
      page,
      pageSize,
      includeCreateTable,
      includeData,
      includeHeaders
    }

    setBusy(true)
    try {
      const result = await unwrap<ExportTableResult>(api.db.exportTable(request))
      if (!result.canceled) {
        const message =
          format === 'sql' && includeCreateTable && !includeData
            ? 'Exported table structure'
            : `Exported ${result.rowsExported} row(s)`
        showToast(message, 'success')
        onOpenChange(false)
      }
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Export Table"
      description={`${database}.${table}`}
      className="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !canExport}>
            {busy ? 'Exporting...' : 'Export'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label className="block mb-1">Format</Label>
          <Select
            value={format}
            onChange={(event) => setFormat(event.target.value as 'sql' | 'csv' | 'txt')}
            options={[
              { value: 'sql', label: 'SQL' },
              { value: 'csv', label: 'CSV' },
              { value: 'txt', label: 'Text (tab-separated)' }
            ]}
          />
        </div>

        <div>
          <Label className="block mb-1">Scope</Label>
          <Select
            value={scope}
            onChange={(event) => setScope(event.target.value as ExportScope)}
            options={scopeOptions}
            disabled={scopeOptions.length === 1}
          />
          {scope === 'filtered' && !where?.trim() && (
            <div className="mt-1 text-xs text-muted-foreground">
              No WHERE filter is active. This will export all rows with the current sort order.
            </div>
          )}
        </div>

        {format === 'sql' ? (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={includeCreateTable} onChange={(event) => setIncludeCreateTable(event.target.checked)} />
              Include CREATE TABLE
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={includeData} onChange={(event) => setIncludeData(event.target.checked)} />
              Include INSERT data
            </label>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={includeHeaders} onChange={(event) => setIncludeHeaders(event.target.checked)} />
              Include header row
            </label>
            <div className="text-xs text-muted-foreground">
              Text export uses UTF-8 tab-separated values for easier pasting into editors and spreadsheets.
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
