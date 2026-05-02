// Content diff tab 中按表展示行级对比详情的区域，包含 “Show all/Only different” 切换。
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import type { TableDataDiff, TableRowComparison } from '../../../shared/types'
import { useI18n } from '@renderer/i18n'
import { filterChangedRowComparisons, matchesTableSearchQuery } from './diff-panel-utils'
import { formatDataSummary } from './diff-panel-formatters'
import { TableOpenActions } from './diff-panel-presentation'

interface RowComparisonSectionProps {
  rowComparisons: TableRowComparison[]
  showAll: boolean
  tableSearchQuery: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onToggleShowAll: () => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
}

export function RowComparisonSection({
  rowComparisons,
  showAll,
  tableSearchQuery,
  onSearchChange,
  onClearSearch,
  onToggleShowAll,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: RowComparisonSectionProps) {
  const { t } = useI18n()
  const changedRowComparisons = filterChangedRowComparisons(rowComparisons)
  const baseRowComparisons = showAll ? rowComparisons : changedRowComparisons
  const visibleRowComparisons = baseRowComparisons.filter((rowComparison) =>
    matchesTableSearchQuery(rowComparison.table, tableSearchQuery)
  )
  const hiddenTableCount = rowComparisons.length - changedRowComparisons.length
  const hasActiveSearch = tableSearchQuery.trim().length > 0

  return (
    <div className="rounded-xl bg-card/15">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <strong className="text-sm">{t('diff.rowCompare.title')}</strong>
        <Badge>{t('diff.rowCompare.tableCount', { count: rowComparisons.length })}</Badge>
        <Input
          value={tableSearchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('diff.result.searchTable')}
          className="h-8 w-40 text-xs"
        />
        {hasActiveSearch && (
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onClearSearch}>
            {t('common.clear')}
          </Button>
        )}
        {hiddenTableCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-[11px]"
            onClick={onToggleShowAll}
          >
            {showAll ? t('diff.rowCompare.onlyDifferent') : t('diff.rowCompare.showAll')}
          </Button>
        )}
      </div>
      <div className="divide-y divide-border/30 border-t border-border/30">
        {visibleRowComparisons.length === 0 ? (
          <div className="px-3 py-6 text-xs text-muted-foreground">
            {hasActiveSearch ? t('diff.result.noTablesMatch') : t('diff.rowCompare.noDiffsHint')}
          </div>
        ) : (
          visibleRowComparisons.map((rowComparison) => (
            <div key={rowComparison.table} className="px-3 py-3">
              <div className="flex items-center gap-2">
                <strong className="text-sm">{rowComparison.table}</strong>
                <RowCompareBadge dataDiff={rowComparison.dataDiff} />
                <span className="mr-auto text-[10px] text-muted-foreground">
                  {formatDataSummary(rowComparison.dataDiff, t)}
                </span>
                <TableOpenActions
                  compareAvailable
                  sourceAvailable
                  targetAvailable
                  onOpenCompare={() => onOpenCompare(rowComparison.table)}
                  onOpenSource={() => onOpenSource(rowComparison.table)}
                  onOpenTarget={() => onOpenTarget(rowComparison.table)}
                />
              </div>
              <DataDiffSection dataDiff={rowComparison.dataDiff} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function RowCompareBadge({ dataDiff }: { dataDiff: TableDataDiff }) {
  const { t } = useI18n()
  if (!dataDiff.comparable) return <Badge variant="warning">{t('diff.rowCompare.skipped')}</Badge>
  if (dataDiff.sourceOnly === 0 && dataDiff.targetOnly === 0 && dataDiff.modified === 0) {
    return <Badge variant="success">{t('diff.rowCompare.identical')}</Badge>
  }
  return <Badge variant="destructive">{t('diff.rowCompare.different')}</Badge>
}

function DataDiffSection({ dataDiff }: { dataDiff: TableDataDiff }) {
  const { t } = useI18n()
  return (
    <div className="mt-3 border-l border-border/40 pl-4 text-xs">
      <div className="space-y-1 rounded-md bg-background/40 px-3 py-2">
        {!dataDiff.comparable ? (
          <div className="text-amber-400">{dataDiff.reason || t('diff.rowCompare.rowComparisonSkipped')}</div>
        ) : (
          <div className="space-y-1">
            <div>
              {t('diff.rowCompare.comparedBy', { columns: dataDiff.keyColumns.join(', ') })}
            </div>
            {dataDiff.reason && <div className="text-amber-400">{dataDiff.reason}</div>}
            <div className="text-muted-foreground">
              {t('diff.rowCompare.countSummary', {
                sourceRows: dataDiff.sourceRowCount,
                targetRows: dataDiff.targetRowCount,
                sourceOnly: dataDiff.sourceOnly,
                targetOnly: dataDiff.targetOnly,
                modified: dataDiff.modified
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
