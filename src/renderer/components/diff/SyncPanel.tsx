// 同步面板：选择策略 + 表 → 生成 SQL 预览 → 执行（带进度日志）
import { useEffect, useMemo, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Select } from '@renderer/components/ui/select'
import { Label } from '@renderer/components/ui/label'
import { Badge } from '@renderer/components/ui/badge'
import { api, unwrap } from '@renderer/lib/api'
import { useUIStore } from '@renderer/store/ui-store'
import type {
  DatabaseDiff,
  ExistingTableStrategy,
  SyncPlan,
  SyncProgressEvent,
  SyncRequest
} from '../../../shared/types'
import { submitSyncRequest } from './sync-request'

interface Props {
  open: boolean
  onClose: () => void
  source: { connectionId: string; database: string }
  target: { connectionId: string; database: string }
  diff: DatabaseDiff
}

export function SyncPanel({ open, onClose, source, target, diff }: Props) {
  const { showToast } = useUIStore()
  const candidateTables = useMemo(() => diff.tableDiffs.map((t) => t.table), [diff])

  const [selected, setSelected] = useState<Set<string>>(new Set(candidateTables))
  const [syncStructure, setSyncStructure] = useState(true)
  const [syncData, setSyncData] = useState(false)
  const [strategy, setStrategy] = useState<ExistingTableStrategy>('skip')
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const off = api.sync.onProgress((e: SyncProgressEvent) => {
      setLogs((l) => [...l, `[${e.level}] ${e.table} · ${e.step} ${e.done}/${e.total} ${e.message || ''}`])
    })
    return off
  }, [])

  function buildReq(dryRun: true): SyncRequest & { dryRun: true }
  function buildReq(dryRun: false): SyncRequest & { dryRun: false }
  function buildReq(dryRun: boolean): SyncRequest {
    return {
      sourceConnectionId: source.connectionId,
      sourceDatabase: source.database,
      targetConnectionId: target.connectionId,
      targetDatabase: target.database,
      tables: Array.from(selected),
      syncStructure,
      syncData,
      existingTableStrategy: strategy,
      dryRun
    }
  }

  const onPreview = async () => {
    try {
      const p = await unwrap<SyncPlan>(submitSyncRequest(api.sync, buildReq(true)))
      setPlan(p)
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  const onExecute = async () => {
    if (!plan) {
      showToast('Build preview first', 'error')
      return
    }
    if (!confirm('Execute sync to TARGET database? This may modify or destroy data.')) return
    setRunning(true)
    setLogs([])
    try {
      const r = await unwrap<{ executed: number; errors: number }>(submitSyncRequest(api.sync, buildReq(false)))
      showToast(`Executed ${r.executed} statement(s), ${r.errors} error(s)`, r.errors === 0 ? 'success' : 'error')
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setRunning(false)
    }
  }

  const toggle = (t: string) => {
    setSelected((s) => {
      const n = new Set(s)
      n.has(t) ? n.delete(t) : n.add(t)
      return n
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Sync" className="max-w-5xl">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Tables to sync ({selected.size}/{candidateTables.length})</Label>
          <div className="border border-border rounded max-h-64 overflow-auto p-2 space-y-1 mt-1">
            {candidateTables.map((t) => (
              <label key={t} className="flex items-center gap-2 text-xs">
                <Checkbox checked={selected.has(t)} onChange={() => toggle(t)} />
                {t}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={syncStructure} onChange={(e) => setSyncStructure(e.target.checked)} />
              Structure
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={syncData} onChange={(e) => setSyncData(e.target.checked)} />
              Data
            </label>
          </div>
          <div>
            <Label>If table exists in target</Label>
            <Select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as ExistingTableStrategy)}
              options={[
                { value: 'skip', label: 'Skip' },
                { value: 'overwrite-structure', label: 'Drop & Recreate (DESTRUCTIVE)' },
                { value: 'append-data', label: 'Keep structure, append data' },
                { value: 'truncate-and-import', label: 'Truncate & Import (DESTRUCTIVE)' }
              ]}
            />
            {(strategy === 'overwrite-structure' || strategy === 'truncate-and-import') && (
              <div className="mt-1 text-[11px] text-amber-400">
                ⚠ This option will drop or truncate data on the target.
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onPreview}>Preview SQL</Button>
            <Button variant="destructive" onClick={onExecute} disabled={running || !plan}>
              {running ? 'Running...' : 'Execute'}
            </Button>
          </div>
        </div>
      </div>

      {plan && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
            Preview <Badge>{plan.steps.reduce((s, x) => s + x.sqls.length, 0)} statements</Badge>
          </div>
          <pre className="bg-card border border-border rounded p-3 text-xs max-h-64 overflow-auto whitespace-pre-wrap">
{plan.steps.map((s) => `-- [${s.table}] ${s.description}\n${s.sqls.join('\n')}`).join('\n\n')}
          </pre>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1">Execution log</div>
          <pre className="bg-card border border-border rounded p-3 text-[11px] max-h-48 overflow-auto">
{logs.join('\n')}
          </pre>
        </div>
      )}
    </Dialog>
  )
}
