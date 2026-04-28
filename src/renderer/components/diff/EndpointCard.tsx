// Source / Target 端点选择卡片，被 DiffPanel 的 Compare setup 折叠区使用。
import { LoaderCircle } from 'lucide-react'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { useI18n } from '@renderer/i18n'
import { formatEndpointSelectionSummary } from './diff-panel-formatters'

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
  const summary = formatEndpointSelectionSummary(
    connectionName,
    database,
    role === 'source' ? t('diff.endpoint.chooseSource') : t('diff.endpoint.chooseTarget')
  )
  const roleLabel = role === 'source' ? t('diff.endpoint.source') : t('diff.endpoint.target')

  return (
    <div className="rounded-xl border border-border/40 bg-background/25 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{roleLabel}</h3>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{summary}</span>
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">{t('diff.endpoint.connection')}</Label>
          <Select
            options={connectionOptions}
            value={connectionValue}
            onChange={(event) => onConnectionChange(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
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
