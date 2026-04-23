import { AlertCircle, CheckCircle2, CircleDashed, LoaderCircle } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import type { TableRowComparison } from '../../../shared/types'
import {
  hasNoRowDifferences,
  hasSchemaOrPresenceDiff,
  type TableCompareEntry
} from './diff-panel-utils'

interface ComparisonStatusPanelProps {
  entries: TableCompareEntry[]
  selectedTable: string | null
  onSelectTable: (table: string) => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
}

export function ComparisonStatusPanel({
  entries,
  selectedTable,
  onSelectTable,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: ComparisonStatusPanelProps) {
  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground">No tables match the current filter.</div>
  }

  const selectedEntry = entries.find((entry) => entry.table === selectedTable) ?? entries[0] ?? null

  return (
    <div className="grid grid-cols-1 gap-3 xl:items-start xl:grid-cols-[minmax(0,1.3fr)_minmax(20rem,0.9fr)]">
      <div className="grid auto-rows-max content-start grid-cols-1 gap-2 lg:grid-cols-2">
        {entries.map((entry) => (
          <CompactComparisonCard
            key={entry.table}
            entry={entry}
            selected={selectedEntry?.table === entry.table}
            onSelect={() => onSelectTable(entry.table)}
          />
        ))}
      </div>
      <ComparisonDetailDrawer
        entry={selectedEntry}
        onOpenCompare={selectedEntry ? () => onOpenCompare(selectedEntry.table) : undefined}
        onOpenSource={selectedEntry ? () => onOpenSource(selectedEntry.table) : undefined}
        onOpenTarget={selectedEntry ? () => onOpenTarget(selectedEntry.table) : undefined}
      />
    </div>
  )
}

function CompactComparisonCard({
  entry,
  selected,
  onSelect
}: {
  entry: TableCompareEntry
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'rounded border px-3 py-2 text-left text-xs transition-colors',
        selected
          ? 'border-primary/40 bg-accent/30'
          : 'border-border/60 bg-card/40 hover:border-border hover:bg-card/60'
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        <TableStatusIcon status={entry.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate font-medium">{entry.table}</span>
            <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
              {formatEntryStatus(entry)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <EntrySummaryBadges entry={entry} />
          </div>
        </div>
        <span className="text-[11px] text-muted-foreground">{selected ? 'Viewing' : 'Details'}</span>
      </div>
    </button>
  )
}

function ComparisonDetailDrawer({
  entry,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: {
  entry: TableCompareEntry | null
  onOpenCompare?: () => void
  onOpenSource?: () => void
  onOpenTarget?: () => void
}) {
  if (!entry) {
    return (
      <div className="rounded border border-dashed border-border/60 bg-card/20 px-4 py-6 text-sm xl:sticky xl:top-0">
        <div className="font-medium text-foreground">No table selected</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Select a table from the status list to inspect schema and row comparison details here.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 xl:sticky xl:top-0">
      <div className="flex items-start gap-2 border-b border-border/60 px-4 py-3">
        <TableStatusIcon status={entry.status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{entry.table}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <EntrySummaryBadges entry={entry} />
          </div>
        </div>
      </div>
      <div className="space-y-3 px-4 py-3 text-xs">
        {entry.error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-red-300 break-all">
            {entry.error}
          </div>
        )}
        <div className="rounded-md bg-card/70 px-3 py-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">Summary</div>
          <div className="text-[11px] text-muted-foreground">{formatEntryDetailSummary(entry)}</div>
        </div>
        {entry.tableDiff && (
          <div className="rounded-md bg-card/70 px-3 py-2">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">Structure</div>
            <div className="text-[11px] text-muted-foreground">
              {entry.tableDiff.columnDiffs.length} column diff(s) · {entry.tableDiff.indexDiffs.length} index diff(s)
            </div>
          </div>
        )}
        {entry.rowComparison && (
          <div className="rounded-md bg-card/70 px-3 py-2">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">Content</div>
            <div className="text-[11px] text-muted-foreground">{formatRowComparisonSummary(entry.rowComparison)}</div>
          </div>
        )}
        <ComparisonActionButtons
          compareAvailable={entry.sourceExists && entry.targetExists}
          sourceAvailable={entry.sourceExists}
          targetAvailable={entry.targetExists}
          onOpenCompare={onOpenCompare}
          onOpenSource={onOpenSource ?? (() => undefined)}
          onOpenTarget={onOpenTarget ?? (() => undefined)}
        />
      </div>
    </div>
  )
}

function EntrySummaryBadges({ entry }: { entry: TableCompareEntry }) {
  const items = getEntrySummaryBadges(entry)

  if (items.length === 0) {
    return <Badge className="border border-border/60 bg-card/70 text-muted-foreground">ready</Badge>
  }

  return items.map((item) => (
    <Badge
      key={`${entry.table}-${item.label}`}
      variant={item.variant}
      className={item.variant === 'default' ? 'border border-border/60 bg-card/70 text-muted-foreground' : undefined}
    >
      {item.label}
    </Badge>
  ))
}

function getEntrySummaryBadges(
  entry: TableCompareEntry
): Array<{ label: string; variant: 'default' | 'info' | 'warning' | 'destructive' | 'success' }> {
  const items: Array<{ label: string; variant: 'default' | 'info' | 'warning' | 'destructive' | 'success' }> = []

  if (entry.status === 'error') {
    items.push({ label: 'error', variant: 'destructive' })
    return items
  }

  if (!entry.sourceExists) {
    items.push({ label: 'target only', variant: 'warning' })
    return items
  }

  if (!entry.targetExists) {
    items.push({ label: 'source only', variant: 'info' })
    return items
  }

  if (entry.status === 'comparing') {
    items.push({ label: 'running', variant: 'info' })
  }

  if (entry.tableDiff && hasSchemaOrPresenceDiff(entry.tableDiff)) {
    items.push({ label: 'schema', variant: 'destructive' })
  }

  if (entry.rowComparison) {
    if (!entry.rowComparison.dataDiff.comparable) {
      items.push({ label: 'rows skipped', variant: 'warning' })
    } else if (!hasNoRowDifferences(entry.rowComparison)) {
      items.push({ label: 'rows changed', variant: 'destructive' })
    } else if (!entry.tableDiff) {
      items.push({ label: 'identical', variant: 'success' })
    }
  }

  if (items.length === 0 && entry.status === 'queued') {
    items.push({ label: 'queued', variant: 'default' })
  }

  return items
}

function formatEntryDetailSummary(entry: TableCompareEntry): string {
  if (entry.status === 'error') {
    return 'This table failed during compare. Expand the error and retry the compare run after the underlying issue is resolved.'
  }

  if (!entry.sourceExists) {
    return 'Table exists only on the target side.'
  }

  if (!entry.targetExists) {
    return 'Table exists only on the source side.'
  }

  const detailParts: string[] = []

  if (entry.tableDiff) {
    detailParts.push(
      `${entry.tableDiff.columnDiffs.length} column diff(s)`,
      `${entry.tableDiff.indexDiffs.length} index diff(s)`
    )
  }

  if (entry.rowComparison) {
    const { dataDiff } = entry.rowComparison
    if (!dataDiff.comparable) {
      detailParts.push('row compare skipped')
    } else {
      detailParts.push(
        `${dataDiff.modified} modified`,
        `${dataDiff.sourceOnly} source only`,
        `${dataDiff.targetOnly} target only`,
        `${dataDiff.identical} identical`
      )
    }
  }

  return detailParts.length > 0 ? detailParts.join(' · ') : 'No schema or row differences detected for this table.'
}

function formatRowComparisonSummary(rowComparison: TableRowComparison): string {
  const { dataDiff } = rowComparison
  if (!dataDiff.comparable) {
    return dataDiff.reason || 'Row comparison skipped.'
  }

  return `${dataDiff.modified} modified · ${dataDiff.sourceOnly} source only · ${dataDiff.targetOnly} target only · ${dataDiff.identical} identical`
}

function TableStatusIcon({ status }: { status: TableCompareEntry['status'] }) {
  if (status === 'comparing') {
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-sky-300" />
  }
  if (status === 'done') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  }
  if (status === 'error') {
    return <AlertCircle className="h-3.5 w-3.5 text-red-300" />
  }
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
}

function formatEntryStatus(entry: TableCompareEntry): string {
  if (entry.status === 'error') return 'failed'
  if (!entry.sourceExists) return 'target only'
  if (!entry.targetExists) return 'source only'
  if (entry.status === 'queued') return 'queued'
  if (entry.status === 'comparing') return 'comparing'
  if (entry.rowComparison && !entry.rowComparison.dataDiff.comparable) return 'row skipped'
  if (entry.rowComparison && hasNoRowDifferences(entry.rowComparison) && !entry.tableDiff) return 'identical'
  if (!entry.rowComparison && !entry.tableDiff) return 'no differences'
  return 'ready'
}

function ComparisonActionButtons({
  compareAvailable,
  sourceAvailable,
  targetAvailable,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: {
  compareAvailable?: boolean
  sourceAvailable: boolean
  targetAvailable: boolean
  onOpenCompare?: () => void
  onOpenSource: () => void
  onOpenTarget: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {compareAvailable && onOpenCompare && (
        <Button size="sm" variant="outline" onClick={onOpenCompare}>
          Open Compare
        </Button>
      )}
      {sourceAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenSource}>
          Open Source
        </Button>
      )}
      {targetAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenTarget}>
          Open Target
        </Button>
      )}
    </div>
  )
}