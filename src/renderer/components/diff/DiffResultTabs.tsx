// 对比结果卡片中三个 Tab 的内容子组件：Tables / Status / Schema。
// 拆出来主要是把 DiffPanel.tsx 的 JSX 体积压下去，逻辑全部由父组件传入。
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Select } from '@renderer/components/ui/select'
import type { TableDiff } from '../../../shared/types'
import {
  formatColumnLine,
  formatComparePhase,
  formatDataSummary,
  formatIndexLine,
  type ComparePhase
} from './diff-panel-formatters'
import {
  ComparePhaseIcon,
  DiffColumn,
  EmptyResultState,
  KindBadge,
  TableOpenActions
} from './diff-panel-presentation'
import { TableListPanel } from './TableListPanel'
import { ComparisonStatusPanel } from './ComparisonStatusPanel'
import type { TableCompareEntry, TableStatusFilter } from './diff-panel-utils'

interface TablesTabContentProps {
  sourceTables: string[]
  targetTables: string[]
  sharedTableCount: number
  phase: ComparePhase
}

export function TablesTabContent({
  sourceTables,
  targetTables,
  sharedTableCount,
  phase
}: TablesTabContentProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
          {sourceTables.length} source tables
        </Badge>
        <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
          {sharedTableCount} shared tables
        </Badge>
        <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
          {targetTables.length} target tables
        </Badge>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
        <TableListPanel title="Source tables" tables={sourceTables} phase={phase} />
        <TableListPanel title="Target tables" tables={targetTables} phase={phase} />
      </div>
    </div>
  )
}

interface StatusTabContentProps {
  comparisonEntries: TableCompareEntry[]
  prioritizedComparisonEntries: TableCompareEntry[]
  filteredComparisonEntries: TableCompareEntry[]
  sharedTableCount: number
  completedSharedTableCount: number
  pendingSharedTable?: string
  hasCompareErrors: boolean
  comparePhase: ComparePhase
  statusFilter: TableStatusFilter
  tableSearchQuery: string
  selectedComparisonTable: string | null
  onSelectTable: (table: string | null) => void
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onStatusFilterChange: (value: TableStatusFilter) => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
}

export function StatusTabContent({
  comparisonEntries,
  prioritizedComparisonEntries,
  filteredComparisonEntries,
  sharedTableCount,
  completedSharedTableCount,
  pendingSharedTable,
  hasCompareErrors,
  comparePhase,
  statusFilter,
  tableSearchQuery,
  selectedComparisonTable,
  onSelectTable,
  onSearchChange,
  onClearSearch,
  onStatusFilterChange,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: StatusTabContentProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ComparePhaseIcon phase={comparePhase} />
            <span>
              {formatComparePhase(
                comparePhase,
                completedSharedTableCount,
                sharedTableCount,
                pendingSharedTable
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
              {comparisonEntries.length} tracked
            </Badge>
            <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
              {sharedTableCount} shared
            </Badge>
            {hasCompareErrors && <Badge variant="destructive">errors present</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground lg:justify-end">
          <Input
            value={tableSearchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search table"
            className="h-8 w-40 text-xs"
          />
          {tableSearchQuery && (
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onClearSearch}>
              Clear
            </Button>
          )}
          <span>Status</span>
          <Select
            className="w-36"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as TableStatusFilter)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'comparing', label: 'Comparing' },
              { value: 'changed', label: 'Only changed' },
              { value: 'schema-changed', label: 'Structure changed' },
              { value: 'row-changed', label: 'Content changed' }
            ]}
          />
          <Badge>{filteredComparisonEntries.length}</Badge>
        </div>
      </div>
      {comparisonEntries.length > 0 ? (
        <ComparisonStatusPanel
          entries={prioritizedComparisonEntries}
          selectedTable={selectedComparisonTable}
          onSelectTable={onSelectTable}
          onOpenCompare={onOpenCompare}
          onOpenSource={onOpenSource}
          onOpenTarget={onOpenTarget}
        />
      ) : (
        <div className="text-xs text-muted-foreground">
          {comparePhase === 'loading-tables'
            ? 'Loading source and target table lists...'
            : 'No tables match the current filter.'}
        </div>
      )}
    </div>
  )
}

interface SchemaTabContentProps {
  schemaDiffs: TableDiff[]
  hasRowComparisonResults: boolean
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
}

export function SchemaTabContent({
  schemaDiffs,
  hasRowComparisonResults,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: SchemaTabContentProps) {
  if (schemaDiffs.length === 0) {
    return (
      <EmptyResultState
        title="No structure differences"
        description={
          hasRowComparisonResults
            ? 'Schema matches on both sides. Switch to the Content diff tab to inspect row-level changes.'
            : 'No schema or presence differences were found in the current result set.'
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {schemaDiffs.map((td) => (
        <div key={td.table} className="rounded-xl bg-card/20">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-card/40 px-3 py-2">
            <strong className="text-sm">{td.table}</strong>
            <KindBadge kind={td.kind} />
            <span className="mr-auto text-[10px] text-muted-foreground">
              {td.columnDiffs.length} column diff(s) · {td.indexDiffs.length} index diff(s)
              {td.dataDiff && ` · ${formatDataSummary(td.dataDiff)}`}
            </span>
            <TableOpenActions
              compareAvailable={td.kind === 'modified'}
              sourceAvailable={td.kind !== 'only-in-target'}
              targetAvailable={td.kind !== 'only-in-source'}
              onOpenCompare={() => onOpenCompare(td.table)}
              onOpenSource={() => onOpenSource(td.table)}
              onOpenTarget={() => onOpenTarget(td.table)}
            />
          </div>
          {td.columnDiffs.length > 0 && (
            <div className="grid grid-cols-1 gap-3 p-3 text-xs xl:grid-cols-2">
              <DiffColumn
                title="Source"
                items={td.columnDiffs.map((d) => formatColumnLine(d.source, d.kind, 'source'))}
              />
              <DiffColumn
                title="Target"
                items={td.columnDiffs.map((d) => formatColumnLine(d.target, d.kind, 'target'))}
              />
            </div>
          )}
          {td.indexDiffs.length > 0 && (
            <div className="grid grid-cols-1 gap-3 px-3 pb-3 text-xs xl:grid-cols-2">
              <DiffColumn
                title="Source indexes"
                items={td.indexDiffs.map((d) => formatIndexLine(d.source, d.kind, 'source'))}
              />
              <DiffColumn
                title="Target indexes"
                items={td.indexDiffs.map((d) => formatIndexLine(d.target, d.kind, 'target'))}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
