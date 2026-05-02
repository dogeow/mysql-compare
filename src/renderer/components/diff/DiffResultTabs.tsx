// 对比结果卡片中三个 Tab 的内容子组件：Tables / Status / Schema。
// 拆出来主要是把 DiffPanel.tsx 的 JSX 体积压下去，逻辑全部由父组件传入。
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Select } from '@renderer/components/ui/select'
import { useI18n } from '@renderer/i18n'
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
import { matchesTableSearchQuery, type TableCompareEntry, type TableStatusFilter } from './diff-panel-utils'

interface TablesTabContentProps {
  sourceTables: string[]
  targetTables: string[]
  sharedTableCount: number
  phase: ComparePhase
}

export function TablesTabContent({
  sourceTables,
  targetTables,
  phase
}: TablesTabContentProps) {
  const { t } = useI18n()
  const sourceTableSet = new Set(sourceTables)
  const targetTableSet = new Set(targetTables)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
        <TableListPanel
          title={t('diff.result.sourcePanelTitle')}
          tables={sourceTables}
          phase={phase}
          getPresence={(table) => (targetTableSet.has(table) ? 'shared' : 'source-only')}
        />
        <TableListPanel
          title={t('diff.result.targetPanelTitle')}
          tables={targetTables}
          phase={phase}
          getPresence={(table) => (sourceTableSet.has(table) ? 'shared' : 'target-only')}
        />
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
  const { t } = useI18n()
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
                pendingSharedTable,
                t
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
              {t('diff.result.tracked', { count: comparisonEntries.length })}
            </Badge>
            <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
              {t('diff.result.shared', { count: sharedTableCount })}
            </Badge>
            {hasCompareErrors && <Badge variant="destructive">{t('diff.result.errorsPresent')}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground lg:justify-end">
          <Input
            value={tableSearchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t('diff.result.searchTable')}
            className="h-8 w-40 text-xs"
          />
          {tableSearchQuery && (
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onClearSearch}>
              {t('common.clear')}
            </Button>
          )}
          <span>{t('common.status')}</span>
          <Select
            className="w-36"
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value as TableStatusFilter)}
            options={[
              { value: 'all', label: t('diff.result.statusAll') },
              { value: 'comparing', label: t('diff.result.statusComparing') },
              { value: 'changed', label: t('diff.result.statusOnlyChanged') },
              { value: 'schema-changed', label: t('diff.result.statusStructureChanged') },
              { value: 'row-changed', label: t('diff.result.statusContentChanged') }
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
            ? t('diff.result.loadingTables')
            : t('diff.result.noTablesMatch')}
        </div>
      )}
    </div>
  )
}

interface SchemaTabContentProps {
  schemaDiffs: TableDiff[]
  hasRowComparisonResults: boolean
  tableSearchQuery: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  onOpenCompare: (table: string) => void
  onOpenSource: (table: string) => void
  onOpenTarget: (table: string) => void
}

export function SchemaTabContent({
  schemaDiffs,
  hasRowComparisonResults,
  tableSearchQuery,
  onSearchChange,
  onClearSearch,
  onOpenCompare,
  onOpenSource,
  onOpenTarget
}: SchemaTabContentProps) {
  const { t } = useI18n()
  const filteredSchemaDiffs = schemaDiffs.filter((td) =>
    matchesTableSearchQuery(td.table, tableSearchQuery)
  )

  if (schemaDiffs.length === 0) {
    return (
      <EmptyResultState
        title={t('diff.result.noStructureDiffs')}
        description={
          hasRowComparisonResults
            ? t('diff.result.schemaMatchesContentTab')
            : t('diff.result.noSchemaOrPresence')
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Input
          value={tableSearchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('diff.result.searchTable')}
          className="h-8 w-40 text-xs"
        />
        {tableSearchQuery && (
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={onClearSearch}>
            {t('common.clear')}
          </Button>
        )}
        <Badge>{filteredSchemaDiffs.length}</Badge>
      </div>
      {filteredSchemaDiffs.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t('diff.result.noTablesMatch')}</div>
      ) : (
        filteredSchemaDiffs.map((td) => (
        <div key={td.table} className="rounded-xl bg-card/20">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-card/40 px-3 py-2">
            <strong className="text-sm">{td.table}</strong>
            <KindBadge kind={td.kind} />
            <span className="mr-auto text-[10px] text-muted-foreground">
              {td.columnDiffs.length} {t('diff.result.columnDiffs')} · {td.indexDiffs.length} {t('diff.result.indexDiffs')}
              {td.dataDiff && ` · ${formatDataSummary(td.dataDiff, t)}`}
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
                title={t('diff.result.sourceColumns')}
                items={td.columnDiffs.map((d) => formatColumnLine(d.source, d.kind, 'source'))}
              />
              <DiffColumn
                title={t('diff.result.targetColumns')}
                items={td.columnDiffs.map((d) => formatColumnLine(d.target, d.kind, 'target'))}
              />
            </div>
          )}
          {td.indexDiffs.length > 0 && (
            <div className="grid grid-cols-1 gap-3 px-3 pb-3 text-xs xl:grid-cols-2">
              <DiffColumn
                title={t('diff.result.sourceIndexes')}
                items={td.indexDiffs.map((d) => formatIndexLine(d.source, d.kind, 'source'))}
              />
              <DiffColumn
                title={t('diff.result.targetIndexes')}
                items={td.indexDiffs.map((d) => formatIndexLine(d.target, d.kind, 'target'))}
              />
            </div>
          )}
        </div>
        ))
      )}
    </div>
  )
}
