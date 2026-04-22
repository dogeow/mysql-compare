// 数据库对比面板：选择源/目标连接 + 数据库，发起 diff，显示差异表
import { useEffect, useState } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Select } from '@renderer/components/ui/select'
import { Label } from '@renderer/components/ui/label'
import { Badge } from '@renderer/components/ui/badge'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import type { DatabaseDiff } from '../../../shared/types'
import { SyncPanel } from './SyncPanel'

export function DiffPanel() {
  const { connections, refresh } = useConnectionStore()
  const { showToast } = useUIStore()

  const [srcId, setSrcId] = useState('')
  const [tgtId, setTgtId] = useState('')
  const [srcDb, setSrcDb] = useState('')
  const [tgtDb, setTgtDb] = useState('')
  const [srcDbs, setSrcDbs] = useState<string[]>([])
  const [tgtDbs, setTgtDbs] = useState<string[]>([])
  const [diff, setDiff] = useState<DatabaseDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [showSync, setShowSync] = useState(false)

  useEffect(() => {
    refresh()
  }, [refresh])

  const loadDbs = async (id: string, setter: (l: string[]) => void) => {
    if (!id) return
    try {
      setter(await unwrap(api.db.listDatabases(id)))
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  useEffect(() => {
    loadDbs(srcId, setSrcDbs)
  }, [srcId])
  useEffect(() => {
    loadDbs(tgtId, setTgtDbs)
  }, [tgtId])

  const onCompare = async () => {
    if (!srcId || !tgtId || !srcDb || !tgtDb) {
      showToast('Select source/target connection and database', 'error')
      return
    }
    setLoading(true)
    try {
      const r = await unwrap<DatabaseDiff>(
        api.diff.databases({
          sourceConnectionId: srcId,
          sourceDatabase: srcDb,
          targetConnectionId: tgtId,
          targetDatabase: tgtDb
        })
      )
      setDiff(r)
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const connOptions = [
    { value: '', label: '— select —' },
    ...connections.map((c) => ({ value: c.id, label: c.name }))
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="grid grid-cols-2 gap-4 p-4 border-b border-border">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Source</h3>
          <Label>Connection</Label>
          <Select options={connOptions} value={srcId} onChange={(e) => setSrcId(e.target.value)} />
          <Label>Database</Label>
          <Select
            options={[{ value: '', label: '— select —' }, ...srcDbs.map((d) => ({ value: d, label: d }))]}
            value={srcDb}
            onChange={(e) => setSrcDb(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Target</h3>
          <Label>Connection</Label>
          <Select options={connOptions} value={tgtId} onChange={(e) => setTgtId(e.target.value)} />
          <Label>Database</Label>
          <Select
            options={[{ value: '', label: '— select —' }, ...tgtDbs.map((d) => ({ value: d, label: d }))]}
            value={tgtDb}
            onChange={(e) => setTgtDb(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <Button onClick={onCompare} disabled={loading}>
          {loading ? 'Comparing...' : 'Compare'}
        </Button>
        <Button
          variant="outline"
          disabled={!diff || diff.tableDiffs.length === 0}
          onClick={() => setShowSync(true)}
        >
          Plan Sync →
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {diff && `${diff.tableDiffs.length} table(s) differ`}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {!diff && (
          <div className="text-xs text-muted-foreground">
            Choose source &amp; target then click Compare. Phase 1: schema-level diff (tables / columns / indexes). Row-level data diff is planned for phase 2.
          </div>
        )}
        {diff?.tableDiffs.map((td) => (
          <div key={td.table} className="border border-border rounded">
            <div className="flex items-center gap-2 px-3 py-2 bg-card border-b border-border">
              <strong className="text-sm">{td.table}</strong>
              <KindBadge kind={td.kind} />
              <span className="text-[10px] text-muted-foreground">
                {td.columnDiffs.length} column diff(s) · {td.indexDiffs.length} index diff(s)
              </span>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 p-3 text-xs">
              <DiffColumn
                title="Source"
                items={td.columnDiffs.map((d) => formatCol(d.source, d.kind, 'source'))}
              />
              <DiffColumn
                title="Target"
                items={td.columnDiffs.map((d) => formatCol(d.target, d.kind, 'target'))}
              />
            </div>
            {td.indexDiffs.length > 0 && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-3 pb-3 text-xs">
                <DiffColumn
                  title="Source indexes"
                  items={td.indexDiffs.map((d) => formatIdx(d.source, d.kind, 'source'))}
                />
                <DiffColumn
                  title="Target indexes"
                  items={td.indexDiffs.map((d) => formatIdx(d.target, d.kind, 'target'))}
                />
              </div>
            )}
          </div>
        ))}
        {diff && diff.tableDiffs.length === 0 && (
          <div className="text-xs text-emerald-400">Source and target are identical at schema level.</div>
        )}
      </div>

      {showSync && diff && (
        <SyncPanel
          open
          onClose={() => setShowSync(false)}
          source={{ connectionId: srcId, database: srcDb }}
          target={{ connectionId: tgtId, database: tgtDb }}
          diff={diff}
        />
      )}
    </div>
  )
}

function KindBadge({ kind }: { kind: string }) {
  if (kind === 'only-in-source') return <Badge variant="info">only in source</Badge>
  if (kind === 'only-in-target') return <Badge variant="warning">only in target</Badge>
  return <Badge variant="destructive">modified</Badge>
}

function DiffColumn({ title, items }: { title: string; items: (string | null)[] }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-muted-foreground mb-1">{title}</div>
      <ul className="space-y-1 font-mono min-w-0">
        {items.map((item, index) =>
          item ? (
            <li
              key={index}
              className="overflow-x-auto rounded border border-border/60 bg-card px-2 py-1 whitespace-pre-wrap break-all"
            >
              {item}
            </li>
          ) : (
            <li
              key={index}
              className="rounded border border-dashed border-border/40 px-2 py-1 opacity-30"
            >
              —
            </li>
          )
        )}
      </ul>
    </div>
  )
}

function formatCol(c: { name: string; type: string; nullable: boolean } | undefined, kind: string, side: string) {
  if (!c) return null
  if (kind === 'only-in-source' && side === 'target') return null
  if (kind === 'only-in-target' && side === 'source') return null
  return `${c.name}  ${c.type}  ${c.nullable ? 'NULL' : 'NOT NULL'}`
}

function formatIdx(i: { name: string; columns: string[]; unique: boolean } | undefined, kind: string, side: string) {
  if (!i) return null
  if (kind === 'only-in-source' && side === 'target') return null
  if (kind === 'only-in-target' && side === 'source') return null
  return `${i.unique ? 'UNIQUE ' : ''}${i.name} (${i.columns.join(', ')})`
}
