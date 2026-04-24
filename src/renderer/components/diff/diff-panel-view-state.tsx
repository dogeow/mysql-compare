import type { ReactNode } from 'react'
import { Badge } from '@renderer/components/ui/badge'
import type { DatabaseDiff } from '../../../shared/types'
import type { ComparePhase } from './diff-panel-formatters'
import type { DiffPanelToolbarSummary } from './DiffPanelToolbar'
import type { DiffResultTab } from './diff-panel-utils'

export const DIFF_PANEL_IDLE_NOTICE =
  'Choose source & target then click Compare. Row comparison uses shared primary keys when possible and falls back to all shared columns when needed.'

export const DIFF_PANEL_SKIPPED_ROW_NOTICE =
  'Schema is identical, but some row comparisons were skipped. Open the Content diff tab for details.'

interface BuildDiffPanelTabItemsArgs {
  sourceTableCount: number
  targetTableCount: number
  comparisonEntryCount: number
  compareErrorCount: number
  visibleSchemaDiffCount: number
  compareData: boolean
  rowChangedTableCount: number
  rowSkippedTableCount: number
}

interface BuildDiffPanelToolbarSummaryArgs {
  diff: DatabaseDiff | null
  comparePhase: ComparePhase
  rowChangedTableCount: number
  rowSkippedTableCount: number
}

export function buildDiffPanelTabItems({
  sourceTableCount,
  targetTableCount,
  comparisonEntryCount,
  compareErrorCount,
  visibleSchemaDiffCount,
  compareData,
  rowChangedTableCount,
  rowSkippedTableCount
}: BuildDiffPanelTabItemsArgs): { value: DiffResultTab; label: ReactNode }[] {
  return [
    {
      value: 'tables',
      label: (
        <span className="flex items-center gap-2">
          <span>Tables</span>
          <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
            S {sourceTableCount}
          </Badge>
          <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
            T {targetTableCount}
          </Badge>
        </span>
      )
    },
    {
      value: 'status',
      label: (
        <span className="flex items-center gap-2">
          <span>Status</span>
          <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
            {comparisonEntryCount}
          </Badge>
          {compareErrorCount > 0 && <Badge variant="destructive">{compareErrorCount} errors</Badge>}
        </span>
      )
    },
    {
      value: 'schema',
      label: (
        <span className="flex items-center gap-2">
          <span>Structure diff</span>
          <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
            {visibleSchemaDiffCount} changed
          </Badge>
          {compareErrorCount > 0 && <Badge variant="destructive">{compareErrorCount} errors</Badge>}
        </span>
      )
    },
    ...(compareData
      ? [
          {
            value: 'data' as const,
            label: (
              <span className="flex items-center gap-2">
                <span>Content diff</span>
                <Badge className="border border-border/60 bg-card/70 text-muted-foreground">
                  {rowChangedTableCount} changed
                </Badge>
                {rowSkippedTableCount > 0 && (
                  <Badge variant="warning">{rowSkippedTableCount} skipped</Badge>
                )}
                {compareErrorCount > 0 && (
                  <Badge variant="destructive">{compareErrorCount} errors</Badge>
                )}
              </span>
            )
          }
        ]
      : [])
  ]
}

export function buildDiffPanelToolbarSummary({
  diff,
  comparePhase,
  rowChangedTableCount,
  rowSkippedTableCount
}: BuildDiffPanelToolbarSummaryArgs): DiffPanelToolbarSummary | null {
  if (!diff) return null

  return {
    structureDiffCount: diff.tableDiffs.length,
    checkedRowCount: diff.rowComparisons.length,
    rowChangedTableCount,
    rowSkippedTableCount,
    rowsIdentical:
      comparePhase === 'done' && rowChangedTableCount === 0 && rowSkippedTableCount === 0
  }
}

export function getFullyIdenticalNotice(compareData: boolean): string {
  return `Source and target are identical${compareData ? ' at schema and row level.' : ' at schema level.'}`
}