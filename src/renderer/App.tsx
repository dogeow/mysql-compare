import { TitleBar } from '@renderer/components/layout/TitleBar'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { Workspace } from '@renderer/pages/Workspace'
import { useUIStore } from '@renderer/store/ui-store'
import { cn } from '@renderer/lib/utils'

export default function App() {
  const { toast } = useUIStore()
  return (
    <div className="h-screen flex flex-col">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <Workspace />
      </div>
      {toast && (
        <div
          className={cn(
            'pointer-events-none fixed right-4 top-14 z-[70] w-[min(28rem,calc(100vw-2rem))] rounded-md border px-3 py-2 text-sm shadow-lg',
            toast.level === 'success' && 'bg-emerald-600/20 border-emerald-600/40 text-emerald-300',
            toast.level === 'error' && 'bg-destructive/20 border-destructive/40 text-red-300',
            toast.level === 'info' && 'bg-secondary border-border text-foreground'
          )}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
