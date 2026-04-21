import { Database, GitCompareArrows } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useUIStore } from '@renderer/store/ui-store'

export function TitleBar() {
  const { setRightView } = useUIStore()
  return (
    <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-card">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">MySQL Compare</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setRightView({ kind: 'diff' })}>
          <GitCompareArrows className="w-4 h-4" />
          Diff &amp; Sync
        </Button>
      </div>
    </div>
  )
}
