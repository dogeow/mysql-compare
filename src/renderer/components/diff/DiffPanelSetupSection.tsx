import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useI18n } from '@renderer/i18n'
import { cn } from '@renderer/lib/utils'
import { EndpointCard } from './EndpointCard'

type SelectOption = { value: string; label: string }

const MAX_VISIBLE_HISTORY_ITEMS = 5

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
    items: SelectOption[]
    activeValue: string
    onSelect: (value: string) => void
    onDelete: (value: string) => void
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
  const visibleHistoryItems = history.items.slice(0, MAX_VISIBLE_HISTORY_ITEMS)
  const selectedHistoryItem = history.activeValue
    ? history.items.find((option) => option.value === history.activeValue)
    : undefined

  if (
    selectedHistoryItem &&
    !visibleHistoryItems.some((option) => option.value === selectedHistoryItem.value)
  ) {
    visibleHistoryItems.push(selectedHistoryItem)
  }

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
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(260px,320px)]">
            <div className="order-1">
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
            </div>

            <div className="order-2">
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

            <div className="order-3 rounded-xl border border-border/40 bg-background/25 p-3.5">
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t('diff.history.label')}</h3>
                {history.items.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">{visibleHistoryItems.length}</span>
                )}
              </div>

              {visibleHistoryItems.length > 0 ? (
                <div className="space-y-2">
                  {visibleHistoryItems.map((item) => {
                    const isActive = item.value === history.activeValue

                    return (
                      <div
                        key={item.value}
                        className={cn(
                          'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors',
                          isActive
                            ? 'border-primary/40 bg-primary/10'
                            : 'border-border/40 bg-background/35 hover:bg-background/55'
                        )}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => history.onSelect(item.value)}
                        >
                          <span className="block truncate text-xs leading-5">{item.label}</span>
                        </button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                          title={t('diff.history.remove')}
                          aria-label={t('diff.history.remove')}
                          onClick={() => history.onDelete(item.value)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/40 bg-background/20 px-3 py-2.5 text-sm text-muted-foreground">
                  {t('diff.history.empty')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}