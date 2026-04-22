// 左侧侧边栏：连接列表、连接 → 数据库 → 表的树
import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Database,
  Table as TableIcon,
  Plus,
  Search,
  RefreshCw,
  Pencil,
  Trash2,
  Copy,
  FileCode2,
  Download
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Dialog } from '@renderer/components/ui/dialog'
import { useConnectionStore } from '@renderer/store/connection-store'
import { useUIStore } from '@renderer/store/ui-store'
import { api, unwrap } from '@renderer/lib/api'
import { ConnectionDialog } from '@renderer/components/connection/ConnectionDialog'
import { ExportTableDialog } from '@renderer/components/table-view/ExportTableDialog'
import type { SafeConnection, TableSchema } from '../../../shared/types'
import { cn } from '@renderer/lib/utils'

interface NodeState {
  expanded: boolean
  loading: boolean
  databases?: string[]
  tables: Record<string, string[]>
  expandedDbs: Set<string>
}

interface TableMenuState {
  x: number
  y: number
  connection: SafeConnection
  database: string
  table: string
}

interface RenameDialogState {
  connection: SafeConnection
  database: string
  table: string
}

interface CreateSQLDialogState {
  title: string
  sql: string
  loading: boolean
}

interface ExportDialogState {
  connectionId: string
  database: string
  table: string
}

interface StickyDatabaseContext {
  connectionName: string
  database: string
}

export function Sidebar() {
  const { connections, refresh, remove } = useConnectionStore()
  const { rightView, setRightView, renameTableTabs, closeTableTabs, showToast } = useUIStore()
  const [keyword, setKeyword] = useState('')
  const [editing, setEditing] = useState<SafeConnection | null>(null)
  const [creating, setCreating] = useState(false)
  const [tableFilters, setTableFilters] = useState<Record<string, string>>({})
  const [tableMenu, setTableMenu] = useState<TableMenuState | null>(null)
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [createSQLDialog, setCreateSQLDialog] = useState<CreateSQLDialogState | null>(null)
  const [exportDialog, setExportDialog] = useState<ExportDialogState | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [nodes, setNodes] = useState<Record<string, NodeState>>({})
  const [stickyDatabase, setStickyDatabase] = useState<StickyDatabaseContext | null>(null)
  const treeScrollRef = useRef<HTMLDivElement | null>(null)
  const dbRowRefs = useRef<Record<string, { element: HTMLDivElement | null; connectionName: string; database: string }>>({})

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!tableMenu) return
    const closeMenu = () => setTableMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [tableMenu])

  useEffect(() => {
    const container = treeScrollRef.current
    if (!container) return

    const syncStickyDatabase = () => {
      if (container.scrollTop < 12) {
        setStickyDatabase(null)
        return
      }

      const containerTop = container.getBoundingClientRect().top
      let nextContext: StickyDatabaseContext | null = null
      let closestTop = Number.NEGATIVE_INFINITY

      Object.values(dbRowRefs.current).forEach((entry) => {
        if (!entry.element || !entry.element.isConnected) return
        const top = entry.element.getBoundingClientRect().top - containerTop
        if (top <= 4 && top > closestTop) {
          closestTop = top
          nextContext = {
            connectionName: entry.connectionName,
            database: entry.database
          }
        }
      })

      setStickyDatabase(nextContext)
    }

    syncStickyDatabase()
    container.addEventListener('scroll', syncStickyDatabase)
    return () => container.removeEventListener('scroll', syncStickyDatabase)
  }, [connections, keyword, nodes])

  const getDatabaseKey = (connectionId: string, database: string) => `${connectionId}:${database}`

  const getTableFilter = (connectionId: string, database: string) =>
    tableFilters[getDatabaseKey(connectionId, database)] ?? ''

  const setTableFilter = (connectionId: string, database: string, value: string) => {
    const key = getDatabaseKey(connectionId, database)
    setTableFilters((current) => {
      if (!value) {
        const { [key]: _removed, ...rest } = current
        return rest
      }
      return { ...current, [key]: value }
    })
  }

  const filtered = connections.filter((c) =>
    !keyword || c.name.toLowerCase().includes(keyword.toLowerCase())
  )

  const isSelectedTable = (connectionId: string, database: string, table: string) =>
    rightView.kind === 'table' &&
    rightView.connectionId === connectionId &&
    rightView.database === database &&
    rightView.table === table

  const toggleConnection = async (conn: SafeConnection) => {
    const cur = nodes[conn.id]
    if (cur?.expanded) {
      setNodes((state) => ({ ...state, [conn.id]: { ...cur, expanded: false } }))
      return
    }
    if (cur) {
      setNodes((state) => ({
        ...state,
        [conn.id]: { ...cur, expanded: true, loading: !cur.databases }
      }))
      if (cur.databases) {
        return
      }
    } else {
      setNodes((state) => ({
        ...state,
        [conn.id]: {
          expanded: true,
          loading: true,
          tables: {},
          expandedDbs: new Set()
        }
      }))
    }
    try {
      const dbs = await unwrap(api.db.listDatabases(conn.id))
      setNodes((state) => ({
        ...state,
        [conn.id]: { ...state[conn.id]!, loading: false, databases: dbs }
      }))
    } catch (err) {
      showToast((err as Error).message, 'error')
      setNodes((state) => ({ ...state, [conn.id]: { ...state[conn.id]!, loading: false } }))
    }
  }

  const toggleDatabase = async (conn: SafeConnection, db: string) => {
    const node = nodes[conn.id]
    if (!node) return
    const nextExpanded = new Set(node.expandedDbs)
    if (nextExpanded.has(db)) {
      nextExpanded.delete(db)
      setNodes((state) => ({ ...state, [conn.id]: { ...node, expandedDbs: nextExpanded } }))
      return
    }
    nextExpanded.add(db)
    setNodes((state) => ({ ...state, [conn.id]: { ...node, expandedDbs: nextExpanded } }))
    if (!node.tables[db]) {
      try {
        const tables = await unwrap(api.db.listTables(conn.id, db))
        setNodes((state) => {
          const current = state[conn.id]!
          return { ...state, [conn.id]: { ...current, tables: { ...current.tables, [db]: tables } } }
        })
      } catch (err) {
        showToast((err as Error).message, 'error')
      }
    }
  }

  const refreshDatabase = async (conn: SafeConnection, db: string) => {
    try {
      const tables = await unwrap(api.db.listTables(conn.id, db))
      setNodes((state) => {
        const current = state[conn.id]!
        return { ...state, [conn.id]: { ...current, tables: { ...current.tables, [db]: tables } } }
      })
    } catch (err) {
      showToast((err as Error).message, 'error')
    }
  }

  const onSelectTable = (conn: SafeConnection, db: string, table: string) => {
    setRightView({ kind: 'table', connectionId: conn.id, database: db, table })
  }

  const openSQLConsole = (conn: SafeConnection, db: string) => {
    setRightView({ kind: 'sql', connectionId: conn.id, connectionName: conn.name, database: db })
  }

  const openTableMenu = (
    event: React.MouseEvent<HTMLDivElement>,
    conn: SafeConnection,
    database: string,
    table: string
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setTableMenu({
      x: Math.min(event.clientX, window.innerWidth - 232),
      y: Math.min(event.clientY, window.innerHeight - 220),
      connection: conn,
      database,
      table
    })
  }

  const openRenameDialog = (menu: TableMenuState) => {
    setTableMenu(null)
    setRenameDialog({ connection: menu.connection, database: menu.database, table: menu.table })
    setRenameDraft(menu.table)
  }

  const submitRename = async () => {
    if (!renameDialog) return
    const nextName = renameDraft.trim()
    if (!nextName) {
      showToast('New table name is required', 'error')
      return
    }
    setActionBusy(true)
    try {
      const result = await unwrap(
        api.db.renameTable({
          connectionId: renameDialog.connection.id,
          database: renameDialog.database,
          table: renameDialog.table,
          newTable: nextName
        })
      )
      await refreshDatabase(renameDialog.connection, renameDialog.database)
      renameTableTabs(
        renameDialog.connection.id,
        renameDialog.database,
        renameDialog.table,
        result.table
      )
      showToast(`Renamed to ${result.table}`, 'success')
      setRenameDialog(null)
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const copyTable = async (menu: TableMenuState) => {
    setTableMenu(null)
    const targetTable = `${menu.table}_copy`
    if (!confirm(`Copy "${menu.table}" and its data to "${targetTable}"?`)) return
    setActionBusy(true)
    try {
      const result = await unwrap(
        api.db.copyTable({
          connectionId: menu.connection.id,
          database: menu.database,
          table: menu.table,
          targetTable
        })
      )
      await refreshDatabase(menu.connection, menu.database)
      showToast(`Copied to ${result.table}`, 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const showCreateSQL = async (menu: TableMenuState) => {
    setTableMenu(null)
    setCreateSQLDialog({ title: `${menu.database}.${menu.table}`, sql: '', loading: true })
    try {
      const schema = await unwrap<TableSchema>(
        api.schema.getTable(menu.connection.id, menu.database, menu.table)
      )
      setCreateSQLDialog({
        title: `${menu.database}.${menu.table}`,
        sql: schema.createSQL,
        loading: false
      })
    } catch (err) {
      setCreateSQLDialog(null)
      showToast((err as Error).message, 'error')
    }
  }

  const openExportDialog = (menu: TableMenuState) => {
    setTableMenu(null)
    setExportDialog({
      connectionId: menu.connection.id,
      database: menu.database,
      table: menu.table
    })
  }

  const dropTable = async (menu: TableMenuState) => {
    setTableMenu(null)
    if (!confirm(`Drop table "${menu.table}"? This cannot be undone.`)) return
    setActionBusy(true)
    try {
      await unwrap(
        api.db.dropTable({
          connectionId: menu.connection.id,
          database: menu.database,
          table: menu.table
        })
      )
      await refreshDatabase(menu.connection, menu.database)
      closeTableTabs(menu.connection.id, menu.database, menu.table)
      showToast(`Dropped table ${menu.table}`, 'success')
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setActionBusy(false)
    }
  }

  const onDelete = async (conn: SafeConnection) => {
    if (!confirm(`Delete connection "${conn.name}"?`)) return
    await remove(conn.id)
    showToast('Connection deleted', 'success')
  }

  return (
    <>
      <div className="w-72 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="p-2 border-b border-border space-y-2">
          <div className="flex gap-1">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Search connection"
                className="pl-7 h-8"
              />
            </div>
            <Button size="icon" variant="outline" onClick={() => setCreating(true)} title="New connection">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div ref={treeScrollRef} className="relative flex-1 overflow-auto py-1 text-sm">
          {stickyDatabase && (
            <div className="pointer-events-none sticky top-0 z-20 mx-2 mb-1 rounded-md border border-border bg-card/95 px-3 py-1.5 shadow-sm backdrop-blur">
              <div className="truncate text-[10px] text-muted-foreground">{stickyDatabase.connectionName}</div>
              <div className="truncate text-xs font-medium">{stickyDatabase.database}</div>
            </div>
          )}
          {filtered.length === 0 && (
            <div className="text-xs text-muted-foreground px-3 py-4">No connection.</div>
          )}
          {filtered.map((conn) => {
            const node = nodes[conn.id]
            return (
              <div key={conn.id}>
                <div className="group flex items-center px-2 py-1 hover:bg-accent cursor-pointer">
                  <button onClick={() => toggleConnection(conn)} className="flex-1 flex items-center gap-1 text-left">
                    {node?.expanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                    <Database className="w-3.5 h-3.5 text-sky-400" />
                    <span className="truncate">{conn.name}</span>
                    {conn.useSSH && <span className="text-[9px] text-amber-400 ml-1">SSH</span>}
                  </button>
                  <div className="opacity-0 group-hover:opacity-100 flex">
                    <button onClick={() => setEditing(conn)} className="p-1 text-muted-foreground hover:text-foreground" title="Edit">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => onDelete(conn)} className="p-1 text-muted-foreground hover:text-destructive" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {node?.expanded && (
                  <div className="pl-4">
                    {node.loading && <div className="text-xs text-muted-foreground px-2 py-1">Loading...</div>}
                    {node.databases?.map((db) => {
                      const dbExpanded = node.expandedDbs.has(db)
                      return (
                        <div key={db}>
                          <div
                            ref={(element) => {
                              const key = `${conn.id}:${db}`
                              if (!element) {
                                delete dbRowRefs.current[key]
                                return
                              }
                              dbRowRefs.current[key] = {
                                element,
                                connectionName: conn.name,
                                database: db
                              }
                            }}
                            className={cn(
                              'flex items-center px-2 py-1 hover:bg-accent cursor-pointer'
                            )}
                            onClick={() => toggleDatabase(conn, db)}
                          >
                            {dbExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                            <Database className="w-3 h-3 text-emerald-400 mx-1" />
                            <span className="truncate flex-1">{db}</span>
                            {dbExpanded && (
                              <div className="flex items-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openSQLConsole(conn, db)
                                  }}
                                  className="p-1 text-muted-foreground hover:text-foreground"
                                  title={`Open SQL console for ${db}`}
                                >
                                  <FileCode2 className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    refreshDatabase(conn, db)
                                  }}
                                  className="p-1 text-muted-foreground hover:text-foreground"
                                  title="Refresh"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>
                          {dbExpanded && (
                            <div className="pl-5">
                              <Input
                                value={getTableFilter(conn.id, db)}
                                onChange={(e) => setTableFilter(conn.id, db, e.target.value)}
                                placeholder="Filter tables"
                                className="h-6 text-xs my-1"
                              />
                              {(node.tables[db] || [])
                                .filter((table) => {
                                  const filter = getTableFilter(conn.id, db)
                                  return !filter || table.toLowerCase().includes(filter.toLowerCase())
                                })
                                .map((table) => (
                                  <div
                                    key={table}
                                    className={cn(
                                      'flex items-center px-2 py-0.5 hover:bg-accent cursor-pointer rounded',
                                      isSelectedTable(conn.id, db, table) && 'bg-accent'
                                    )}
                                    onClick={() => onSelectTable(conn, db, table)}
                                    onContextMenu={(event) => openTableMenu(event, conn, db, table)}
                                    title="Right click for table actions"
                                  >
                                    <TableIcon className="w-3 h-3 text-muted-foreground mr-1" />
                                    <span className="truncate text-xs flex-1">{table}</span>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {(creating || editing) && (
          <ConnectionDialog
            open
            connection={editing}
            onOpenChange={(open) => {
              if (!open) {
                setCreating(false)
                setEditing(null)
              }
            }}
            onSaved={() => refresh()}
          />
        )}
      </div>

      {tableMenu && (
        <div className="fixed inset-0 z-[80]" onClick={() => setTableMenu(null)}>
          <div
            className="absolute w-56 rounded-md border border-border bg-card p-1 shadow-xl"
            style={{ left: tableMenu.x, top: tableMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <TableMenuItem
              icon={<Pencil className="w-3.5 h-3.5" />}
              label="Rename Table"
              onClick={() => openRenameDialog(tableMenu)}
            />
            <TableMenuItem
              icon={<Copy className="w-3.5 h-3.5" />}
              label={`Copy to ${tableMenu.table}_copy`}
              onClick={() => copyTable(tableMenu)}
            />
            <TableMenuItem
              icon={<FileCode2 className="w-3.5 h-3.5" />}
              label="Show CREATE TABLE"
              onClick={() => showCreateSQL(tableMenu)}
            />
            <TableMenuItem
              icon={<Download className="w-3.5 h-3.5" />}
              label="Export..."
              onClick={() => openExportDialog(tableMenu)}
            />
            <div className="my-1 h-px bg-border" />
            <TableMenuItem
              icon={<Trash2 className="w-3.5 h-3.5" />}
              label="Drop Table"
              onClick={() => dropTable(tableMenu)}
              danger
            />
          </div>
        </div>
      )}

      {renameDialog && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !actionBusy) setRenameDialog(null)
          }}
          title="Rename Table"
          description={`Rename ${renameDialog.database}.${renameDialog.table} to a new table name.`}
          className="max-w-md"
          footer={
            <>
              <Button variant="outline" onClick={() => setRenameDialog(null)} disabled={actionBusy}>
                Cancel
              </Button>
              <Button onClick={submitRename} disabled={actionBusy || !renameDraft.trim()}>
                Rename
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <Label className="block">New Table Name</Label>
            <Input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} />
          </div>
        </Dialog>
      )}

      {createSQLDialog && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCreateSQLDialog(null)
          }}
          title="CREATE TABLE"
          description={createSQLDialog.title}
          className="max-w-4xl"
          footer={
            <>
              <Button variant="outline" onClick={() => setCreateSQLDialog(null)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(createSQLDialog.sql)
                  showToast('SQL copied', 'success')
                }}
                disabled={createSQLDialog.loading || !createSQLDialog.sql}
              >
                Copy SQL
              </Button>
            </>
          }
        >
          {createSQLDialog.loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <pre className="max-h-[60vh] overflow-auto rounded border border-border bg-card p-3 text-xs whitespace-pre-wrap">
              {createSQLDialog.sql}
            </pre>
          )}
        </Dialog>
      )}

      {exportDialog && (
        <ExportTableDialog
          open
          onOpenChange={(open) => {
            if (!open) setExportDialog(null)
          }}
          connectionId={exportDialog.connectionId}
          database={exportDialog.database}
          table={exportDialog.table}
          availableScopes={['all']}
        />
      )}
    </>
  )
}

function TableMenuItem({
  icon,
  label,
  onClick,
  danger = false
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
        danger && 'text-red-300 hover:bg-red-500/10'
      )}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  )
}
