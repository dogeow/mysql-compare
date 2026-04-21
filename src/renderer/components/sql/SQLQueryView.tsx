import { useMemo, useRef, useState } from 'react'
import { FileUp, FolderOpen, Play, RotateCcw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Table, TBody, Td, THead, Th, Tr } from '@renderer/components/ui/table'
import { api, unwrap } from '@renderer/lib/api'
import { cn } from '@renderer/lib/utils'
import { formatCellValue } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/store/ui-store'

interface Props {
  connectionId: string
  connectionName?: string
  database: string
}

type SQLExecutionResult =
  | { kind: 'rows'; columns: string[]; rows: Record<string, unknown>[] }
  | { kind: 'mutation'; affectedRows: number; insertId?: number | string; warningStatus?: number }
  | { kind: 'batch'; statements: number; affectedRows: number; details: string[] }
  | { kind: 'empty'; message: string }

const DEFAULT_SQL = '-- Multiple statements supported. Use Cmd/Ctrl + Enter to run.\nSELECT *\nFROM `your_table_name`\nLIMIT 100;'

export function SQLQueryView({ connectionId, connectionName, database }: Props) {
  const { showToast } = useUIStore()
  const [sql, setSQL] = useState(DEFAULT_SQL)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SQLExecutionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const subtitle = useMemo(() => {
    if (connectionName) return `${connectionName} / ${database}`
    return database
  }, [connectionName, database])

  const runSQL = async () => {
    const statement = sql.trim()
    if (!statement) {
      showToast('SQL is empty', 'error')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const raw = await unwrap(api.mysql.executeSQL(connectionId, statement, database))
      const normalized = normalizeResult(raw)
      setResult(normalized)
      showToast('SQL executed', 'success')
    } catch (err) {
      const message = (err as Error).message
      setError(message)
      showToast(message, 'error')
    } finally {
      setRunning(false)
    }
  }

  const importFile = async (file: File | null | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      setSQL(text)
      showToast(`Loaded ${file.name}`, 'success')
    } catch (err) {
      showToast((err as Error).message || 'Failed to read SQL file', 'error')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border bg-card px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">SQL Console</div>
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setSQL(DEFAULT_SQL)} disabled={running}>
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={running}
            >
              <FolderOpen className="h-4 w-4" /> Open File
            </Button>
            <Button size="sm" onClick={runSQL} disabled={running}>
              <Play className="h-4 w-4" /> {running ? 'Running...' : 'Run'}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(220px,40%)_minmax(0,1fr)]">
        <div
          className={cn(
            'border-b border-border p-3 transition-colors',
            dragging && 'bg-accent/40'
          )}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void importFile(event.dataTransfer.files?.[0])
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".sql,.txt,.csv,text/plain"
            className="hidden"
            onChange={(event) => {
              void importFile(event.target.files?.[0])
              event.currentTarget.value = ''
            }}
          />
          <textarea
            value={sql}
            onChange={(event) => setSQL(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void runSQL()
              }
            }}
            spellCheck={false}
            className="h-full min-h-[220px] w-full resize-none rounded-md border border-input bg-background p-3 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <FileUp className="h-3.5 w-3.5" />
            <span>Drag a SQL/text file here, or use Open File.</span>
          </div>
        </div>

        <div className="min-h-0 overflow-hidden p-3">
          {error ? (
            <div className="max-h-full overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-red-200 whitespace-pre-wrap break-all">
              {error}
            </div>
          ) : result ? (
            <ResultPanel result={result} />
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
              Run SQL against {subtitle} to see results here.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultPanel({ result }: { result: SQLExecutionResult }) {
  if (result.kind === 'empty') {
    return (
      <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
        {result.message}
      </div>
    )
  }

  if (result.kind === 'mutation') {
    return (
      <div className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
        <div>Affected rows: {result.affectedRows}</div>
        {result.insertId !== undefined && <div>Insert ID: {String(result.insertId)}</div>}
        {result.warningStatus !== undefined && <div>Warnings: {result.warningStatus}</div>}
      </div>
    )
  }

  if (result.kind === 'batch') {
    return (
      <div className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
        <div>Executed {result.statements} statements</div>
        <div>Total affected rows: {result.affectedRows}</div>
        {result.details.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {result.details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
        {result.rows.length.toLocaleString()} row(s)
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <Tr>
              {result.columns.map((column) => (
                <Th key={column}>{column}</Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((row, index) => (
              <Tr key={index}>
                {result.columns.map((column) => (
                  <Td key={column} title={formatCellValue(row[column])} className="max-w-none whitespace-pre-wrap break-all align-top">
                    {formatCellValue(row[column])}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  )
}

function normalizeResult(raw: unknown): SQLExecutionResult {
  if (Array.isArray(raw)) {
    if (raw.length === 0) {
      return { kind: 'empty', message: 'Statement executed successfully.' }
    }

    if (raw.every((item) => isMutationPayload(item))) {
      const results = raw as Array<Record<string, unknown>>
      return {
        kind: 'batch',
        statements: results.length,
        affectedRows: results.reduce((sum, item) => sum + Number(item.affectedRows ?? 0), 0),
        details: results.map((item, index) => {
          const affectedRows = Number(item.affectedRows ?? 0)
          const insertId = item.insertId
          return insertId !== undefined && insertId !== 0
            ? `Statement ${index + 1}: ${affectedRows} row(s), insert id ${String(insertId)}`
            : `Statement ${index + 1}: ${affectedRows} row(s)`
        })
      }
    }

    if (raw.every((item) => Array.isArray(item))) {
      const firstResultSet = raw[0] as Record<string, unknown>[]
      const columns = Array.from(new Set(firstResultSet.flatMap((row) => Object.keys(row))))
      return { kind: 'rows', columns, rows: firstResultSet }
    }

    const rows = raw as Record<string, unknown>[]
    const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    return { kind: 'rows', columns, rows }
  }

  if (raw && typeof raw === 'object') {
    const payload = raw as Record<string, unknown>
    if (typeof payload.affectedRows === 'number') {
      return {
        kind: 'mutation',
        affectedRows: payload.affectedRows,
        insertId: payload.insertId as number | string | undefined,
        warningStatus: payload.warningStatus as number | undefined
      }
    }
  }

  return { kind: 'empty', message: 'Statement executed successfully.' }
}

function isMutationPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && typeof (value as Record<string, unknown>).affectedRows === 'number'
}
