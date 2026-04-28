import type { ReactNode } from 'react'
import { DiffPanelResultContainer } from './DiffPanelResultContainer'
import { getDiffPanelIdleNotice } from './diff-panel-view-state'
import { useI18n } from '@renderer/i18n'
import type { DiffResultTab } from './diff-panel-utils'

interface DiffPanelContentAreaProps {
  showIdleNotice: boolean
  showResult: boolean
  resultTab: DiffResultTab
  tabItems: { value: DiffResultTab; label: ReactNode }[]
  onResultTabChange: (value: DiffResultTab) => void
  resultBody: ReactNode
  identicalNotice: string | null
  skippedNotice: string | null
}

export function DiffPanelContentArea({
  showIdleNotice,
  showResult,
  resultTab,
  tabItems,
  onResultTabChange,
  resultBody,
  identicalNotice,
  skippedNotice
}: DiffPanelContentAreaProps) {
  const { t } = useI18n()
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex min-h-full flex-col gap-3 p-4">
        {showIdleNotice && <div className="text-xs text-muted-foreground">{getDiffPanelIdleNotice(t)}</div>}
        {showResult && (
          <DiffPanelResultContainer
            resultTab={resultTab}
            tabItems={tabItems}
            onResultTabChange={onResultTabChange}
          >
            {resultBody}
          </DiffPanelResultContainer>
        )}
        {identicalNotice && <div className="text-xs text-emerald-400">{identicalNotice}</div>}
        {skippedNotice && <div className="text-xs text-amber-400">{skippedNotice}</div>}
      </div>
    </div>
  )
}