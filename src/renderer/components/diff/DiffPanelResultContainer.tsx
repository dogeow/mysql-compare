import type { ReactNode } from 'react'
import { Tabs } from '@renderer/components/ui/tabs'

interface DiffPanelResultContainerProps<T extends string> {
  resultTab: T
  tabItems: { value: T; label: ReactNode }[]
  onResultTabChange: (value: T) => void
  children: ReactNode
}

export function DiffPanelResultContainer<T extends string>({
  resultTab,
  tabItems,
  onResultTabChange,
  children
}: DiffPanelResultContainerProps<T>) {
  return (
    <div className="flex min-h-[32rem] min-w-0 flex-1 flex-col rounded-xl border border-border/60 bg-card/10">
      <Tabs
        className="px-4 pt-3"
        value={resultTab}
        onValueChange={(value) => onResultTabChange(value as T)}
        items={tabItems}
      />
      <div className="flex min-h-0 flex-1 flex-col p-4 pt-3">{children}</div>
    </div>
  )
}