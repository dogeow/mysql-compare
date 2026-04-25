import { Copy, Download, FileCode2, Pencil, Trash2 } from 'lucide-react'
import { ConnectionDialog } from '@renderer/components/connection/ConnectionDialog'
import { ExportTableDialog } from '@renderer/components/table-view/ExportTableDialog'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { cn } from '@renderer/lib/utils'
import type { SafeConnection } from '../../../shared/types'
import type {
  CreateSQLDialogState,
  ExportDialogState,
  RenameDialogState,
  TableMenuState
} from './sidebar-types'

interface SidebarOverlaysProps {
  creating: boolean
  editing: SafeConnection | null
  onConnectionDialogOpenChange: (open: boolean) => void
  onConnectionSaved: () => void
  tableMenu: TableMenuState | null
  onCloseTableMenu: () => void
  onRenameTable: (menu: TableMenuState) => void
  onCopyTable: (menu: TableMenuState) => void | Promise<void>
  onShowCreateSQL: (menu: TableMenuState) => void | Promise<void>
  onExportTable: (menu: TableMenuState) => void
  onDropTable: (menu: TableMenuState) => void | Promise<void>
  renameDialog: RenameDialogState | null
  renameDraft: string
  actionBusy: boolean
  onRenameDraftChange: (value: string) => void
  onRenameDialogOpenChange: (open: boolean) => void
  onSubmitRename: () => void | Promise<void>
  createSQLDialog: CreateSQLDialogState | null
  onCreateSQLDialogOpenChange: (open: boolean) => void
  onCopyCreateSQL: () => void
  exportDialog: ExportDialogState | null
  onExportDialogOpenChange: (open: boolean) => void
}

export function SidebarOverlays({
  creating,
  editing,
  onConnectionDialogOpenChange,
  onConnectionSaved,
  tableMenu,
  onCloseTableMenu,
  onRenameTable,
  onCopyTable,
  onShowCreateSQL,
  onExportTable,
  onDropTable,
  renameDialog,
  renameDraft,
  actionBusy,
  onRenameDraftChange,
  onRenameDialogOpenChange,
  onSubmitRename,
  createSQLDialog,
  onCreateSQLDialogOpenChange,
  onCopyCreateSQL,
  exportDialog,
  onExportDialogOpenChange
}: SidebarOverlaysProps) {
  return (
    <>
      {(creating || editing) && (
        <ConnectionDialog
          open
          connection={editing}
          onOpenChange={onConnectionDialogOpenChange}
          onSaved={onConnectionSaved}
        />
      )}

      {tableMenu && (
        <div className="fixed inset-0 z-[80]" onClick={onCloseTableMenu}>
          <div
            className="absolute w-56 rounded-md border border-border bg-card p-1 shadow-xl"
            style={{ left: tableMenu.x, top: tableMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <TableMenuItem
              icon={<Pencil className="h-3.5 w-3.5" />}
              label="Rename Table"
              onClick={() => onRenameTable(tableMenu)}
            />
            <TableMenuItem
              icon={<Copy className="h-3.5 w-3.5" />}
              label={`Copy to ${tableMenu.table}_copy`}
              onClick={() => onCopyTable(tableMenu)}
            />
            <TableMenuItem
              icon={<FileCode2 className="h-3.5 w-3.5" />}
              label="Show CREATE TABLE"
              onClick={() => onShowCreateSQL(tableMenu)}
            />
            <TableMenuItem
              icon={<Download className="h-3.5 w-3.5" />}
              label="Export..."
              onClick={() => onExportTable(tableMenu)}
            />
            <div className="my-1 h-px bg-border" />
            <TableMenuItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Drop Table"
              onClick={() => onDropTable(tableMenu)}
              danger
            />
          </div>
        </div>
      )}

      {renameDialog && (
        <Dialog
          open
          onOpenChange={onRenameDialogOpenChange}
          title="Rename Table"
          description={`Rename ${renameDialog.database}.${renameDialog.table} to a new table name.`}
          className="max-w-md"
          footer={
            <>
              <Button variant="outline" onClick={() => onRenameDialogOpenChange(false)} disabled={actionBusy}>
                Cancel
              </Button>
              <Button onClick={onSubmitRename} disabled={actionBusy || !renameDraft.trim()}>
                Rename
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <Label className="block">New Table Name</Label>
            <Input value={renameDraft} onChange={(event) => onRenameDraftChange(event.target.value)} />
          </div>
        </Dialog>
      )}

      {createSQLDialog && (
        <Dialog
          open
          onOpenChange={onCreateSQLDialogOpenChange}
          title="CREATE TABLE"
          description={createSQLDialog.title}
          className="max-w-4xl"
          footer={
            <>
              <Button variant="outline" onClick={() => onCreateSQLDialogOpenChange(false)}>
                Close
              </Button>
              <Button
                onClick={onCopyCreateSQL}
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
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-border bg-card p-3 text-xs">
              {createSQLDialog.sql}
            </pre>
          )}
        </Dialog>
      )}

      {exportDialog && (
        <ExportTableDialog
          open
          onOpenChange={onExportDialogOpenChange}
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