import { useEffect, useMemo, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { useI18n } from '@renderer/i18n'
import type { SSHFileEntry } from '../../../shared/types'

interface SSHMoveDialogProps {
  entry: SSHFileEntry | null
  open: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (value: { directory: string; name: string }) => void
}

export function SSHMoveDialog({ entry, open, busy, onOpenChange, onConfirm }: SSHMoveDialogProps) {
  const { t } = useI18n()
  const [directory, setDirectory] = useState('.')
  const [name, setName] = useState('')

  useEffect(() => {
    if (!open || !entry) return
    setDirectory(getParentRemotePath(entry.path))
    setName(entry.name)
  }, [entry, open])

  const previewPath = useMemo(() => buildRemotePath(directory, name), [directory, name])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('sshFiles.moveDialog.title')}
      description={entry ? t('sshFiles.moveDialog.description', { name: entry.name }) : undefined}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onConfirm({ directory, name })} disabled={busy || !entry}>
            {t('sshFiles.moveDialog.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{t('sshFiles.moveDialog.destinationFolder')}</span>
          <Input
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            className="font-mono text-xs"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{t('sshFiles.moveDialog.name')}</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="font-mono text-xs" />
        </label>
        <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <div>{t('sshFiles.moveDialog.preview')}</div>
          <div className="mt-1 break-all font-mono text-foreground">{previewPath}</div>
        </div>
      </div>
    </Dialog>
  )
}

function getParentRemotePath(path: string): string {
  if (path === '/' || path === '.') return path
  const normalized = path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path
  const index = normalized.lastIndexOf('/')
  if (index < 0) return '.'
  if (index === 0) return '/'
  return normalized.slice(0, index)
}

function buildRemotePath(directory: string, name: string): string {
  if (!directory) return name
  if (directory === '/') return `/${name}`
  if (directory === '.') return name
  return directory.endsWith('/') ? `${directory}${name}` : `${directory}/${name}`
}