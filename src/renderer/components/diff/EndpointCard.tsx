// Source / Target 端点选择卡片，被 DiffPanel 的 Compare setup 折叠区使用。
import { LoaderCircle } from 'lucide-react'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { useI18n } from '@renderer/i18n'

type SelectOption = { value: string; label: string }

interface EndpointCardProps {
  role: 'source' | 'target'
  connectionName: string | undefined
  database: string
  connectionOptions: SelectOption[]
  connectionValue: string
  onConnectionChange: (value: string) => void
  databaseOptions: SelectOption[]
  databaseValue: string
  databaseDisabled: boolean
  databaseLoading: boolean
  onDatabaseChange: (value: string) => void
}

export function EndpointCard({
  role,
  connectionName,
  database,
  connectionOptions,
  connectionValue,
  onConnectionChange,
  databaseOptions,
  databaseValue,
  databaseDisabled,
  databaseLoading,
  onDatabaseChange
}: EndpointCardProps) {
  const { t } = useI18n()
  const roleLabel = role === 'source' ? t('diff.endpoint.source') : t('diff.endpoint.target')
  const summary = [connectionName, database].filter(Boolean).join(' / ')

  return (
    <div className="rounded-xl border border-border/40 bg-background/25 p-3.5">
      <div className="mb-2.5 flex min-h-6 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{roleLabel}</h3>
        {summary ? <span className="min-w-0 truncate text-[11px] text-muted-foreground">{summary}</span> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-start">
        <div className="space-y-1.5">
          <div className="flex h-5 items-center">
            <Label className="text-[11px] text-muted-foreground">{t('diff.endpoint.connection')}</Label>
          </div>
          <Select
            options={connectionOptions}
            value={connectionValue}
            onChange={(event) => onConnectionChange(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex h-5 items-center justify-between gap-2">
            <Label className="text-[11px] text-muted-foreground">{t('diff.endpoint.database')}</Label>
            {databaseLoading && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <LoaderCircle className="h-3 w-3 animate-spin" />
                {t('common.loading')}
              </span>
            )}
          </div>
          <Select
            options={databaseOptions}
            value={databaseValue}
            disabled={databaseDisabled}
            onChange={(event) => onDatabaseChange(event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
