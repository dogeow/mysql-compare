import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { useI18n } from '@renderer/i18n'
import { EndpointCard } from './EndpointCard'

type SelectOption = { value: string; label: string }

interface EndpointSelectionProps {
  connectionName?: string
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

interface DiffPanelSetupSectionProps {
  expanded: boolean
  summary: string
  onToggle: () => void
  history: {
    options: SelectOption[]
    value: string
    disabled: boolean
    onChange: (value: string) => void
    onClear: () => void
  }
  source: EndpointSelectionProps
  target: EndpointSelectionProps
}

export function DiffPanelSetupSection({
  expanded,
  summary,
  onToggle,
  history,
  source,
  target
}: DiffPanelSetupSectionProps) {
  const { t } = useI18n()
  return (
    <div className="border-b border-border">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={onToggle}>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{t('diff.setup.title')}</span>
        </button>
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">{summary}</div>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={onToggle}>
          {expanded ? t('diff.setup.hide') : t('diff.setup.show')}
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border/40 bg-card/10 px-4 py-3">
          <div className="mb-3 flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">{t('diff.history.label')}</Label>
              <Select
                options={history.options}
                value={history.value}
                disabled={history.disabled}
                onChange={(event) => history.onChange(event.target.value)}
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              disabled={history.disabled}
              title={t('diff.history.clear')}
              aria-label={t('diff.history.clear')}
              onClick={history.onClear}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <EndpointCard
              role="source"
              connectionName={source.connectionName}
              database={source.database}
              connectionOptions={source.connectionOptions}
              connectionValue={source.connectionValue}
              onConnectionChange={source.onConnectionChange}
              databaseOptions={source.databaseOptions}
              databaseValue={source.databaseValue}
              databaseDisabled={source.databaseDisabled}
              databaseLoading={source.databaseLoading}
              onDatabaseChange={source.onDatabaseChange}
            />
            <EndpointCard
              role="target"
              connectionName={target.connectionName}
              database={target.database}
              connectionOptions={target.connectionOptions}
              connectionValue={target.connectionValue}
              onConnectionChange={target.onConnectionChange}
              databaseOptions={target.databaseOptions}
              databaseValue={target.databaseValue}
              databaseDisabled={target.databaseDisabled}
              databaseLoading={target.databaseLoading}
              onDatabaseChange={target.onDatabaseChange}
            />
          </div>
        </div>
      )}
    </div>
  )
}