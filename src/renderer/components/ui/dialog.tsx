// 自实现的轻量 Modal，避免引 Radix。支持点击遮罩关闭、Esc 关闭。
import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
  footer?: React.ReactNode
}

export function Dialog({ open, onOpenChange, title, description, children, className, footer }: DialogProps) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div
        className={cn(
          'relative z-10 w-full max-w-lg rounded-lg border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto',
          className
        )}
      >
        <button
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        {title && <h2 className="text-lg font-semibold mb-1">{title}</h2>}
        {description && <p className="text-sm text-muted-foreground mb-4">{description}</p>}
        <div>{children}</div>
        {footer && <div className="flex justify-end gap-2 mt-6">{footer}</div>}
      </div>
    </div>
  )
}
