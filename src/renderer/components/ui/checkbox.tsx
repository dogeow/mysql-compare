import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn('h-4 w-4 rounded border border-input bg-background accent-primary', className)}
      {...p}
    />
  )
)
Checkbox.displayName = 'Checkbox'
