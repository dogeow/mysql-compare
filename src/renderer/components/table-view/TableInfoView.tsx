import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Pencil } from 'lucide-react'
import { api, unwrap } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { useUIStore } from '@renderer/store/ui-store'
import type { TableSchema } from '../../../shared/types'

interface Props {
  connectionId: string
  database: string
  table: string
}

export function TableInfoView({ connectionId, database, table }: Props) {
  const { showToast } = useUIStore()
  const [schema, setSchema] = useState<TableSchema | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [confirmSQL, setConfirmSQL] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestIdRef = useRef(0)

  const loadSchema = async () => {
    const requestId = ++requestIdRef.current
    const next = await unwrap<TableSchema>(api.schema.getTable(connectionId, database, table))
    if (requestId !== requestIdRef.current) return
    setSchema(next)
    setCommentDraft(next.tableComment ?? '')
  }

  useEffect(() => {
    setSchema(null)
    setEditing(false)
    setConfirmSQL(null)
    loadSchema().catch((error) => showToast((error as Error).message, 'error'))
  }, [connectionId, database, table, showToast])

  const pendingSQL = useMemo(() => {
    if (!schema) return ''
    return `ALTER TABLE ${quoteTable(database, table)} COMMENT = ${quoteString(commentDraft)};`
  }, [commentDraft, database, schema, table])

  const saveComment = async () => {
    if (!confirmSQL) return
    setBusy(true)
    try {
      await unwrap(api.db.executeSQL(connectionId, confirmSQL, database))
      showToast('Table comment updated', 'success')
      setConfirmSQL(null)
      setEditing(false)
      await loadSchema()
    } catch (error) {
      showToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const commentChanged = schema ? commentDraft !== (schema.tableComment ?? '') : false

  if (!schema) {
    return <div className="p-3 text-xs text-muted-foreground">Loading...</div>
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <InfoCard label="Rows" value={formatNumber(schema.rowEstimate)} />
        <InfoCard label="Data Size" value={formatBytes(schema.dataLength)} />
        <InfoCard label="Index Size" value={formatBytes(schema.indexLength)} />
        <InfoCard label="Total Size" value={formatBytes((schema.dataLength ?? 0) + (schema.indexLength ?? 0))} />
        <InfoCard label="Free Space" value={formatBytes(schema.dataFree)} />
        <InfoCard label="Avg Row Length" value={formatBytes(schema.avgRowLength)} />
        <InfoCard label="Engine" value={schema.engine || '-'} />
        <InfoCard label="Collation" value={schema.charset || '-'} />
        <InfoCard label="Auto Increment" value={schema.autoIncrement == null ? '-' : formatNumber(schema.autoIncrement)} />
        <InfoCard label="Created" value={schema.createdAt || '-'} />
        <InfoCard label="Updated" value={schema.updatedAt || '-'} />
        <InfoCard label="Columns / Indexes" value={`${schema.columns.length} / ${schema.indexes.length}`} />
      </div>

      <section className="mt-4 rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium">Table Comment</h3>
            <div className="text-xs text-muted-foreground">Visible in MySQL metadata and schema tools.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit Comment
          </Button>
        </div>
        <div className="rounded border border-border/70 bg-background p-3 text-sm whitespace-pre-wrap break-words">
          {schema.tableComment || <span className="text-muted-foreground">No comment</span>}
        </div>
      </section>

      {editing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setEditing(false)
          }}
          title="Edit Table Comment"
          description={`${database}.${table}`}
          className="max-w-2xl"
          footer={
            <>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => setConfirmSQL(pendingSQL)} disabled={busy || !commentChanged}>
                Review SQL
              </Button>
            </>
          }
        >
          <div>
            <Label className="mb-1 block">Comment</Label>
            <Input value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
          </div>
        </Dialog>
      )}

      {confirmSQL && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setConfirmSQL(null)
          }}
          title="Confirm Table Comment Change"
          description="Review the SQL before executing."
          className="max-w-3xl"
          footer={
            <>
              <Button variant="outline" onClick={() => setConfirmSQL(null)} disabled={busy}>
                Back
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(confirmSQL)
                  showToast('SQL copied', 'success')
                }}
                disabled={busy}
              >
                <Copy className="h-3.5 w-3.5" /> Copy SQL
              </Button>
              <Button onClick={saveComment} disabled={busy}>
                {busy ? 'Executing...' : 'Confirm & Execute'}
              </Button>
            </>
          }
        >
          <pre className="max-h-[60vh] overflow-auto rounded border border-border bg-card p-3 text-xs whitespace-pre-wrap break-all">
            {confirmSQL}
          </pre>
        </Dialog>
      )}
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  )
}

function formatBytes(value?: number): string {
  const bytes = Math.max(0, value ?? 0)
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`
}

function formatNumber(value?: number | null): string {
  if (value == null) return '-'
  return value.toLocaleString()
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function quoteTable(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`
}

function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}
