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
    <div className={cn('flex border-b border-border', className)}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            onClick={() => onValueChange(it.value)}
            className={cn(
              'px-4 h-9 text-sm border-b-2 -mb-px transition-colors',
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
