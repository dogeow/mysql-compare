import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Select } from '@renderer/components/ui/select'
import { useI18n } from '@renderer/i18n'

export interface DiffPanelToolbarSummary {
  structureDiffCount: number
  checkedRowCount: number
  rowChangedTableCount: number
  rowSkippedTableCount: number
  rowsIdentical: boolean
}

interface DiffPanelToolbarProps {
  compareButtonLabel: string
  compareData: boolean
  concurrency: number
  concurrencyOptions: readonly number[]
  diffSummary: DiffPanelToolbarSummary | null
  loading: boolean
  canPlanSync: boolean
  onCompare: () => void
  onCompareDataChange: (checked: boolean) => void
  onConcurrencyChange: (value: string) => void
  onPlanSync: () => void
}

export function DiffPanelToolbar({
  compareButtonLabel,
  compareData,
  concurrency,
  concurrencyOptions,
  diffSummary,
  loading,
  canPlanSync,
  onCompare,
  onCompareDataChange,
  onConcurrencyChange,
  onPlanSync
}: DiffPanelToolbarProps) {
  const { t } = useI18n()
  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card/15 p-1.5">
          <Button size="sm" className="h-8 min-w-[10rem] px-3" onClick={onCompare} disabled={loading}>
            {compareButtonLabel}
          </Button>
          <label className="flex h-8 items-center gap-2 rounded-lg bg-background/35 px-2.5 text-xs text-muted-foreground">
            <Checkbox
              className="h-3.5 w-3.5"
              checked={compareData}
              onChange={(event) => onCompareDataChange(event.target.checked)}
            />
            <span>{t('diff.toolbar.compareRows')}</span>
          </label>
          <div className="flex h-8 items-center gap-2 rounded-lg bg-background/35 px-2.5 text-xs text-muted-foreground">
            <span>{t('diff.toolbar.parallel')}</span>
            <Select
              className="h-7 w-20 border-border/50 bg-transparent px-2 text-xs"
              value={String(concurrency)}
              disabled={loading}
              onChange={(event) => onConcurrencyChange(event.target.value)}
              options={concurrencyOptions.map((value) => ({ value: String(value), label: `${value}` }))}
            />
          </div>
          <Button size="sm" variant="outline" className="h-8 px-3" disabled={!canPlanSync} onClick={onPlanSync}>
            {t('diff.toolbar.planSync')}
          </Button>
        </div>
        {diffSummary && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
              {t('diff.toolbar.structure', { count: diffSummary.structureDiffCount })}
            </Badge>
            {compareData && diffSummary.checkedRowCount > 0 && (
              <>
                <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                  {t('diff.toolbar.checked', { count: diffSummary.checkedRowCount })}
                </Badge>
                {diffSummary.rowsIdentical ? (
                  <Badge variant="success">{t('diff.toolbar.rowsIdentical')}</Badge>
                ) : (
                  <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                    {t('diff.toolbar.changed', { count: diffSummary.rowChangedTableCount })}
                  </Badge>
                )}
              </>
            )}
            {compareData && diffSummary.rowSkippedTableCount > 0 && (
              <Badge variant="warning">{t('diff.toolbar.skipped', { count: diffSummary.rowSkippedTableCount })}</Badge>
            )}
          </div>
        )}
      </div>
    </div>
  )
}