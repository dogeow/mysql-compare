// Tables tab 中显示的源/目标表清单卡片，会撑满父容器高度。
import { Badge } from '@renderer/components/ui/badge'
import type { ComparePhase } from './diff-panel-formatters'

interface TableListPanelProps {
  title: string
  tables: string[]
  phase: ComparePhase
}

export function TableListPanel({ title, tables, phase }: TableListPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border/50 bg-card/15 px-3 py-3">
      <div className="flex items-center justify-between gap-2 border-b border-border/30 pb-2">
        <div className="flex min-w-0 items-center gap-2 text-left">
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{tables.length}</Badge>
        </div>
      </div>
      {tables.length === 0 ? (
        <div className="mt-3 text-xs text-muted-foreground">
          {phase === 'loading-tables' ? 'Loading tables...' : 'No tables found'}
        </div>
      ) : (
        <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
          <div className="space-y-1.5">
            {tables.map((table) => (
              <div key={table} className="rounded-md bg-background/35 px-3 py-1.5 text-xs font-mono">
                {table}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
