import type { MouseEvent, MutableRefObject } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Database,
  FileCode2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table as TableIcon,
  Trash2
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import type { SafeConnection } from '../../../shared/types'
import type {
  DatabaseRowRefEntry,
  NodeState,
  StickyDatabaseContext
} from './sidebar-types'

interface SidebarTreeProps {
  keyword: string
  onKeywordChange: (value: string) => void
  onCreateConnection: () => void
  filteredConnections: SafeConnection[]
  nodes: Record<string, NodeState>
  stickyDatabase: StickyDatabaseContext | null
  treeScrollRef: MutableRefObject<HTMLDivElement | null>
  dbRowRefs: MutableRefObject<Record<string, DatabaseRowRefEntry>>
  getTableFilter: (connectionId: string, database: string) => string
  isSelectedTable: (connectionId: string, database: string, table: string) => boolean
  onToggleConnection: (connection: SafeConnection) => void | Promise<void>
  onEditConnection: (connection: SafeConnection) => void
  onDeleteConnection: (connection: SafeConnection) => void | Promise<void>
  onToggleDatabase: (connection: SafeConnection, database: string) => void | Promise<void>
  onOpenSQLConsole: (connection: SafeConnection, database: string) => void
  onRefreshDatabase: (connection: SafeConnection, database: string) => void | Promise<void>
  onTableFilterChange: (connectionId: string, database: string, value: string) => void
  onSelectTable: (connection: SafeConnection, database: string, table: string) => void
  onOpenTableMenu: (
    event: MouseEvent<HTMLDivElement>,
    connection: SafeConnection,
    database: string,
    table: string
  ) => void
}

export function SidebarTree({
  keyword,
  onKeywordChange,
  onCreateConnection,
  filteredConnections,
  nodes,
  stickyDatabase,
  treeScrollRef,
  dbRowRefs,
  getTableFilter,
  isSelectedTable,
  onToggleConnection,
  onEditConnection,
  onDeleteConnection,
  onToggleDatabase,
  onOpenSQLConsole,
  onRefreshDatabase,
  onTableFilterChange,
  onSelectTable,
  onOpenTableMenu
}: SidebarTreeProps) {
  return (
    <>
      <div className="space-y-2 border-b border-border p-2">
        <div className="flex gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => onKeywordChange(event.target.value)}
              placeholder="Search connection"
              className="h-8 pl-7"
            />
          </div>
          <Button size="icon" variant="outline" onClick={onCreateConnection} title="New connection">
            <Plus className="h-4 w-4" />
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

        {filteredConnections.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground">No connection.</div>
        )}

        {filteredConnections.map((connection) => {
          const node = nodes[connection.id]

          return (
            <div key={connection.id}>
              <div className="group flex cursor-pointer items-center px-2 py-1 hover:bg-accent">
                <button
                  onClick={() => onToggleConnection(connection)}
                  className="flex flex-1 items-center gap-1 text-left"
                >
                  {node?.expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <Database className="h-3.5 w-3.5 text-sky-400" />
                  <span className="truncate">{connection.name}</span>
                  {connection.useSSH && <span className="ml-1 text-[9px] text-amber-400">SSH</span>}
                </button>
                <div className="flex opacity-0 group-hover:opacity-100">
                  <button
                    onClick={() => onEditConnection(connection)}
                    className="p-1 text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onDeleteConnection(connection)}
                    className="p-1 text-muted-foreground hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {node?.expanded && (
                <div className="pl-4">
                  {node.loading && <div className="px-2 py-1 text-xs text-muted-foreground">Loading...</div>}
                  {node.databases?.map((database) => {
                    const dbExpanded = node.expandedDbs.has(database)
                    const filterValue = getTableFilter(connection.id, database)

                    return (
                      <div key={database}>
                        <div
                          ref={(element) => {
                            const key = `${connection.id}:${database}`
                            if (!element) {
                              delete dbRowRefs.current[key]
                              return
                            }

                            dbRowRefs.current[key] = {
                              element,
                              connectionName: connection.name,
                              database
                            }
                          }}
                          className="flex cursor-pointer items-center px-2 py-1 hover:bg-accent"
                          onClick={() => onToggleDatabase(connection, database)}
                        >
                          {dbExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <Database className="mx-1 h-3 w-3 text-emerald-400" />
                          <span className="flex-1 truncate">{database}</span>
                          {dbExpanded && (
                            <div className="flex items-center">
                              <button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onOpenSQLConsole(connection, database)
                                }}
                                className="p-1 text-muted-foreground hover:text-foreground"
                                title={`Open SQL console for ${database}`}
                              >
                                <FileCode2 className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onRefreshDatabase(connection, database)
                                }}
                                className="p-1 text-muted-foreground hover:text-foreground"
                                title="Refresh"
                              >
                                <RefreshCw className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        {dbExpanded && (
                          <div className="pl-5">
                            <Input
                              value={filterValue}
                              onChange={(event) =>
                                onTableFilterChange(connection.id, database, event.target.value)
                              }
                              placeholder="Filter tables"
                              className="my-1 h-6 text-xs"
                            />
                            {(node.tables[database] || [])
                              .filter((table) => {
                                return !filterValue || table.toLowerCase().includes(filterValue.toLowerCase())
                              })
                              .map((table) => (
                                <div
                                  key={table}
                                  className={cn(
                                    'flex cursor-pointer items-center rounded px-2 py-0.5 hover:bg-accent',
                                    isSelectedTable(connection.id, database, table) && 'bg-accent'
                                  )}
                                  onClick={() => onSelectTable(connection, database, table)}
                                  onContextMenu={(event) =>
                                    onOpenTableMenu(event, connection, database, table)
                                  }
                                  title="Right click for table actions"
                                >
                                  <TableIcon className="mr-1 h-3 w-3 text-muted-foreground" />
                                  <span className="flex-1 truncate text-xs">{table}</span>
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
    </>
  )
}