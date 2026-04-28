import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { api, unwrap } from '@renderer/lib/api'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import { useI18n } from '@renderer/i18n'
import type {
  ExportDatabaseRequest,
  ExportDatabaseResult,
  ExportSqlDialect
} from '../../../shared/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  database: string
}

export function ExportDatabaseDialog({ open, onOpenChange, connectionId, database }: Props) {
  const { showToast } = useUIStore()
  const { t } = useI18n()
  const sourceEngine = useConnectionStore(
    (state) => state.connections.find((connection) => connection.id === connectionId)?.engine ?? 'mysql'
  )
  const [sqlDialect, setSqlDialect] = useState<ExportSqlDialect>(sourceEngine)
  const [includeCreateTable, setIncludeCreateTable] = useState(true)
  const [includeData, setIncludeData] = useState(true)
  const [busy, setBusy] = useState(false)

  const sqlDialectOptions = useMemo(
    () => [
      { value: 'mysql', label: t('exportDialog.mysqlSql') } as const,
      { value: 'postgres', label: t('exportDialog.postgresSql') } as const
    ],
    [t]
  )

  useEffect(() => {
    if (!open) return
    setSqlDialect(sourceEngine === 'postgres' ? 'postgres' : 'mysql')
    setIncludeCreateTable(true)
    setIncludeData(true)
  }, [connectionId, database, open, sourceEngine])

  const canExport = includeCreateTable || includeData

  const submit = async () => {
    if (!canExport) {
      showToast(t('exportDialog.selectSqlContent'), 'error')
      return
    }

    if (typeof api.db.exportDatabase !== 'function') {
      showToast(t('databaseExportDialog.unavailable'), 'error')
      return
    }

    const request: ExportDatabaseRequest = {
      connectionId,
      database,
      format: 'sql',
      sqlDialect,
      includeCreateTable,
      includeData
    }

    setBusy(true)
    try {
      const result = await unwrap<ExportDatabaseResult>(api.db.exportDatabase(request))
      if (!result.canceled) {
        showToast(
          t('databaseExportDialog.exported', {
            tables: result.tablesExported,
            rows: result.rowsExported
          }),
          'success'
        )
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
      title={t('databaseExportDialog.title')}
      description={database}
      className="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy || !canExport}>
            {busy ? t('databaseExportDialog.exporting') : t('common.export')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label className="mb-1 block">{t('exportDialog.sqlDialect')}</Label>
          <Select
            value={sqlDialect}
            onChange={(event) => setSqlDialect(event.target.value as ExportSqlDialect)}
            options={sqlDialectOptions}
          />
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={includeCreateTable}
              onChange={(event) => setIncludeCreateTable(event.target.checked)}
            />
            {t('common.structure')}
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={includeData} onChange={(event) => setIncludeData(event.target.checked)} />
            {t('common.data')}
          </label>
        </div>
      </div>
    </Dialog>
  )
}
