import { useEffect, useRef, useState } from 'react'
import { Download, FileCode2, Folder, GitCompareArrows, Table as TableIcon, X } from 'lucide-react'
import { Tabs } from '@renderer/components/ui/tabs'
import { Button } from '@renderer/components/ui/button'
import { DatabaseExportTaskView } from '@renderer/components/table-view/DatabaseExportTaskView'
import { TableDataView } from '@renderer/components/table-view/TableDataView'
import { TableInfoView } from '@renderer/components/table-view/TableInfoView'
import { TableStructureView } from '@renderer/components/table-view/TableStructureView'
import { DiffPanel } from '@renderer/components/diff/DiffPanel'
import { TableCompareView } from '@renderer/components/diff/TableCompareView'
import { SQLQueryView } from '@renderer/components/sql/SQLQueryView'
import { SSHFileEditor } from '@renderer/components/ssh/SSHFileEditor'
import { SSHFileManager } from '@renderer/components/ssh/SSHFileManager'
import { useUIStore, type WorkspaceTab, type WorkspaceView } from '@renderer/store/ui-store'
import { cn } from '@renderer/lib/utils'
import { useI18n, type Translator } from '@renderer/i18n'

type TableTabKind = 'data' | 'structure' | 'info'

function isTableTabKind(value: string): value is TableTabKind {
  return value === 'data' || value === 'structure' || value === 'info'
}

function getTabDisplayTitle(view: WorkspaceView, t: Translator): string {
  if (view.kind === 'diff') return t('app.diffSync')
  if (view.kind === 'sql') {
    const prefix = t('workspace.tabTitle.sqlPrefix')
    return view.connectionName
      ? `${prefix} · ${view.database} @ ${view.connectionName}`
      : `${prefix} · ${view.database}`
  }
  if (view.kind === 'database-export') {
    const prefix = t('workspace.tabTitle.databaseExportPrefix')
    return view.connectionName
      ? `${prefix} · ${view.request.database} @ ${view.connectionName}`
      : `${prefix} · ${view.request.database}`
  }
  if (view.kind === 'table-compare') {
    return `${t('workspace.tabTitle.comparePrefix')} · ${view.table}`
  }
  if (view.kind === 'ssh-files') return `${t('workspace.tabTitle.sshFilesPrefix')} · ${view.connectionName}`
  if (view.kind === 'ssh-editor') {
    return `${t('workspace.tabTitle.sshEditorPrefix')} · ${view.path.split('/').filter(Boolean).pop() ?? view.path}`
  }
  return view.table
}

export function Workspace() {
  const { workspaceTabs, activeTabId, rightView, setActiveTab, closeTab } = useUIStore()
  const { t } = useI18n()
  const [tableTabs, setTableTabs] = useState<Record<string, TableTabKind>>({})
  const previousTabsRef = useRef<WorkspaceTab[]>([])

  useEffect(() => {
    const previousTabs = previousTabsRef.current
    setTableTabs((current) => {
      const alive = new Set(workspaceTabs.map((tab) => tab.id))
      const next = Object.fromEntries(
        Object.entries(current).filter(([tabId]) => alive.has(tabId))
      ) as Record<string, TableTabKind>

      workspaceTabs.forEach((tab, index) => {
        const previousTab = previousTabs[index]
        if (
          previousTab?.view.kind === 'table' &&
          tab.view.kind === 'table' &&
          previousTab.id !== tab.id &&
          previousTab.view.connectionId === tab.view.connectionId &&
          previousTab.view.database === tab.view.database &&
          current[previousTab.id] &&
          !next[tab.id]
        ) {
          next[tab.id] = current[previousTab.id]!
        }
      })

      return next
    })
    previousTabsRef.current = workspaceTabs
  }, [workspaceTabs])

  const activeTab = workspaceTabs.find((tab) => tab.id === activeTabId) ?? null

  if (!activeTab || rightView.kind === 'empty') {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        {t('workspace.selectTablePrompt')}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-2 py-1.5">
        {workspaceTabs.map((tab) => {
          const active = tab.id === activeTab.id
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex min-w-0 shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-primary/40 bg-accent text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-accent/70 hover:text-foreground'
              )}
            >
              <button
                type="button"
                className="flex min-w-0 items-center gap-2"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.view.kind === 'diff' || tab.view.kind === 'table-compare' ? (
                  <GitCompareArrows className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'sql' ? (
                  <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'database-export' ? (
                  <Download className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'ssh-editor' ? (
                  <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                ) : tab.view.kind === 'ssh-files' ? (
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <TableIcon className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate max-w-48">{getTabDisplayTitle(tab.view, t)}</span>
              </button>
              <button
                type="button"
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-background/80 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
                title={t('workspace.closeTab')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex-1 overflow-hidden">
        {workspaceTabs.map((tab) => {
          const active = tab.id === activeTab.id
          const currentTableTab = tableTabs[tab.id] ?? 'data'

          return (
            <div
              key={tab.id}
              className={cn('h-full min-h-0 flex-col overflow-hidden', active ? 'flex' : 'hidden')}
            >
              {tab.view.kind === 'diff' ? (
                <DiffPanel />
              ) : tab.view.kind === 'table-compare' ? (
                <TableCompareView
                  compareSessionId={tab.view.compareSessionId}
                  sourceConnectionId={tab.view.sourceConnectionId}
                  sourceDatabase={tab.view.sourceDatabase}
                  targetConnectionId={tab.view.targetConnectionId}
                  targetDatabase={tab.view.targetDatabase}
                  table={tab.view.table}
                  comparedTables={tab.view.comparedTables}
                  diffTables={tab.view.diffTables}
                />
              ) : tab.view.kind === 'sql' ? (
                <SQLQueryView
                  connectionId={tab.view.connectionId}
                  connectionName={tab.view.connectionName}
                  database={tab.view.database}
                />
              ) : tab.view.kind === 'database-export' ? (
                <DatabaseExportTaskView
                  taskId={tab.view.exportTaskId}
                  connectionName={tab.view.connectionName}
                  request={tab.view.request}
                />
              ) : tab.view.kind === 'ssh-files' ? (
                <SSHFileManager connectionId={tab.view.connectionId} connectionName={tab.view.connectionName} />
              ) : tab.view.kind === 'ssh-editor' ? (
                <SSHFileEditor
                  connectionId={tab.view.connectionId}
                  connectionName={tab.view.connectionName}
                  remotePath={tab.view.path}
                />
              ) : (
                <>
                  <div className="px-3 py-2 border-b border-border bg-card text-sm flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate">
                      <span className="text-muted-foreground">{tab.view.database}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <strong>{tab.view.table}</strong>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => closeTab(tab.id)}>
                      {t('common.close')}
                    </Button>
                  </div>
                  <Tabs
                    value={currentTableTab}
                    onValueChange={(value) =>
                      isTableTabKind(value) &&
                      setTableTabs((current) => ({
                        ...current,
                        [tab.id]: value
                      }))
                    }
                    items={[
                      { value: 'data', label: t('common.data') },
                      { value: 'structure', label: t('common.structure') },
                      { value: 'info', label: t('common.info') }
                    ]}
                  />
                  <div className="flex-1 overflow-hidden">
                    {currentTableTab === 'data' ? (
                      <TableDataView
                        connectionId={tab.view.connectionId}
                        database={tab.view.database}
                        table={tab.view.table}
                      />
                    ) : currentTableTab === 'info' ? (
                      <TableInfoView
                        connectionId={tab.view.connectionId}
                        database={tab.view.database}
                        table={tab.view.table}
                      />
                    ) : (
                      <TableStructureView
                        connectionId={tab.view.connectionId}
                        database={tab.view.database}
                        table={tab.view.table}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
