// 仅展示用的小型辅助组件，原本散落在 DiffPanel.tsx 内部，统一放这里方便复用。
import { CheckCircle2, CircleDashed, LoaderCircle } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { useI18n } from '@renderer/i18n'
import type { ComparePhase } from './diff-panel-formatters'

export function ComparePhaseIcon({ phase }: { phase: ComparePhase }) {
  if (phase === 'loading-tables' || phase === 'comparing') {
    return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
  }
  if (phase === 'done') {
    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  }
  return <CircleDashed className="h-3.5 w-3.5" />
}

export function KindBadge({ kind }: { kind: string }) {
  const { t } = useI18n()
  if (kind === 'only-in-source')
    return <Badge variant="info">{t('diff.presentation.onlyInSource')}</Badge>
  if (kind === 'only-in-target')
    return <Badge variant="warning">{t('diff.presentation.onlyInTarget')}</Badge>
  return <Badge variant="destructive">{t('diff.presentation.modified')}</Badge>
}

export function EmptyResultState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded border border-dashed border-border/60 bg-card/20 px-4 py-6 text-sm">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{description}</div>
    </div>
  )
}

export function TableOpenActions({
  compareAvailable,
  sourceAvailable,
  targetAvailable,
  onOpenCompare,
  onOpenSource,
  onOpenTarget,
  className
}: {
  compareAvailable?: boolean
  sourceAvailable: boolean
  targetAvailable: boolean
  onOpenCompare?: () => void
  onOpenSource: () => void
  onOpenTarget: () => void
  className?: string
}) {
  const { t } = useI18n()
  return (
    <div className={className ?? 'flex flex-wrap gap-2'}>
      {compareAvailable && onOpenCompare && (
        <Button size="sm" variant="outline" onClick={onOpenCompare}>
          {t('diff.presentation.openCompare')}
        </Button>
      )}
      {sourceAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenSource}>
          {t('diff.presentation.openSource')}
        </Button>
      )}
      {targetAvailable && (
        <Button size="sm" variant="ghost" onClick={onOpenTarget}>
          {t('diff.presentation.openTarget')}
        </Button>
      )}
    </div>
  )
}

export function DiffColumn({ title, items }: { title: string; items: (string | null)[] }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-muted-foreground mb-1">{title}</div>
      <ul className="space-y-1 font-mono min-w-0">
        {items.map((item, index) =>
          item ? (
            <li
              key={index}
              className="overflow-x-auto rounded bg-card/70 px-2 py-1 whitespace-pre-wrap break-all"
            >
              {item}
            </li>
          ) : (
            <li key={index} className="rounded bg-background/30 px-2 py-1 text-muted-foreground/60">
              —
            </li>
          )
        )}
      </ul>
    </div>
  )
}
