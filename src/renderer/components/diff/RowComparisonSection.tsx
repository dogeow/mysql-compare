// Content diff tab 中按表展示行级对比详情的区域，包含 “Show all/Only different” 切换。
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import type { TableDataDiff, TableRowComparison } from '../../../shared/types'
import { filterChangedRowComparisons } from './diff-panel-utils'
import { formatDataSummary } from './diff-panel-formatters'
import { TableOpenActions } from './diff-panel-presentation'

interface RowComparisonSectionProps {
  rowComparisons: TableRowComparison[]
  showAll: boolean
  onToggleShowAll: () => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
}

export function RowComparisonSection({
  rowComparisons,
  showAll,
  onToggleShowAll,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: RowComparisonSectionProps) {
  const changedRowComparisons = filterChangedRowComparisons(rowComparisons)
  const visibleRowComparisons = showAll ? rowComparisons : changedRowComparisons
  const hiddenTableCount = rowComparisons.length - changedRowComparisons.length

  return (
    <div className="rounded-xl bg-card/15">
      <div className="flex items-center gap-2 px-3 py-2">
        <strong className="text-sm">Row comparison</strong>
        <Badge>{rowComparisons.length} table(s)</Badge>
        {hiddenTableCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-[11px]"
            onClick={onToggleShowAll}
          >
            {showAll ? 'Only different' : 'Show all'}
          </Button>
        )}
      </div>
      <div className="divide-y divide-border/30 border-t border-border/30">
        {visibleRowComparisons.length === 0 ? (
          <div className="px-3 py-6 text-xs text-muted-foreground">
            No row differences found. Click Show all to inspect identical or skipped comparisons.
          </div>
        ) : (
          visibleRowComparisons.map((rowComparison) => (
            <div key={rowComparison.table} className="px-3 py-3">
              <div className="flex items-center gap-2">
                <strong className="text-sm">{rowComparison.table}</strong>
                <RowCompareBadge dataDiff={rowComparison.dataDiff} />
                <span className="mr-auto text-[10px] text-muted-foreground">
                  {formatDataSummary(rowComparison.dataDiff)}
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
  if (!dataDiff.comparable) return <Badge variant="warning">skipped</Badge>
  if (dataDiff.sourceOnly === 0 && dataDiff.targetOnly === 0 && dataDiff.modified === 0) {
    return <Badge variant="success">identical</Badge>
  }
  return <Badge variant="destructive">different</Badge>
}

function DataDiffSection({ dataDiff }: { dataDiff: TableDataDiff }) {
  return (
    <div className="mt-3 border-l border-border/40 pl-4 text-xs">
      <div className="space-y-1 rounded-md bg-background/40 px-3 py-2">
        {!dataDiff.comparable ? (
          <div className="text-amber-400">{dataDiff.reason || 'Row comparison skipped'}</div>
        ) : (
          <div className="space-y-1">
            <div>
              Compared by <code>{dataDiff.keyColumns.join(', ')}</code>
            </div>
            {dataDiff.reason && <div className="text-amber-400">{dataDiff.reason}</div>}
            <div className="text-muted-foreground">
              source rows {dataDiff.sourceRowCount} · target rows {dataDiff.targetRowCount} ·
              source only {dataDiff.sourceOnly} · target only {dataDiff.targetOnly} · modified {dataDiff.modified}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
