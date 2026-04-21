import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export const Table = ({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) => (
  <table className={cn('w-full caption-bottom text-sm border-collapse', className)} {...p} />
)
export const THead = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn('sticky top-0 bg-card z-10', className)} {...p} />
)
export const TBody = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn(className)} {...p} />
)
export const Tr = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('border-b border-border hover:bg-muted/40', className)} {...p} />
)
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    className={cn(
      'h-9 px-3 text-left align-middle font-medium text-muted-foreground border-b border-border whitespace-nowrap',
      className
    )}
    {...p}
  />
)
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('px-3 py-1.5 align-middle whitespace-nowrap max-w-xs truncate', className)} {...p} />
)
