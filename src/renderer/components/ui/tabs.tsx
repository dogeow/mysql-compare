import * as React from 'react'
import { cn } from '@renderer/lib/utils'

interface TabsProps {
  value: string
  onValueChange: (v: string) => void
  items: { value: string; label: React.ReactNode }[]
  className?: string
}

export function Tabs({ value, onValueChange, items, className }: TabsProps) {
  return (
    <div className={cn('flex overflow-x-auto border-b border-border', className)}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            onClick={() => onValueChange(it.value)}
            className={cn(
              'h-9 shrink-0 whitespace-nowrap border-b-2 px-4 text-sm -mb-px transition-colors',
              active
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
