// 新增 / 编辑连接的弹窗
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { api, unwrap } from '@renderer/lib/api'
import { useUIStore } from '@renderer/store/ui-store'
import type { ConnectionConfig, DbEngine, SafeConnection } from '../../../shared/types'

const DEFAULT_PORT: Record<DbEngine, number> = {
  mysql: 3306,
  postgres: 5432
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection?: SafeConnection | null
  onSaved?: () => void
}

export function ConnectionDialog({ open, onOpenChange, connection, onSaved }: Props) {
  const { showToast } = useUIStore()
  const sshKeyInputRef = useRef<HTMLInputElement | null>(null)
  const [testFeedback, setTestFeedback] = useState<{
    level: 'success' | 'error'
    message: string
  } | null>(null)
  const [draggingSSHKey, setDraggingSSHKey] = useState(false)
  const [form, setForm] = useState<ConnectionConfig>(createInitialForm(connection))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(createInitialForm(connection))
    setBusy(false)
    setDraggingSSHKey(false)
    setTestFeedback(null)
  }, [connection, open])

  const update = <K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) => {
    setTestFeedback(null)
    setForm((current) => {
      if (key === 'useSSH' && !value) {
        return {
          ...current,
          useSSH: false,
          sshHost: '',
          sshPort: 22,
          sshUsername: '',
          sshPassword: '',
          sshPrivateKey: '',
          sshPassphrase: ''
        }
      }
      if (key === 'engine') {
        const nextEngine = value as DbEngine
        const previousDefault = DEFAULT_PORT[current.engine]
        // 切换引擎时，若当前端口还是上一引擎默认值，同步切换为新默认值
        const nextPort = current.port === previousDefault ? DEFAULT_PORT[nextEngine] : current.port
        return { ...current, engine: nextEngine, port: nextPort }
      }
      return { ...current, [key]: value }
    })
  }

  const loadSSHKeyFile = async (file: File) => {
    try {
      const content = await file.text()
      update('sshPrivateKey', content)
      showToast(`Loaded SSH key: ${file.name}`, 'success')
    } catch {
      showToast('Failed to read SSH key file', 'error')
    }
  }

  const onSSHKeyInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await loadSSHKeyFile(file)
    e.target.value = ''
  }

  const onSSHKeyDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDraggingSSHKey(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await loadSSHKeyFile(file)
  }

  const onTest = async () => {
    const validationError = validateConnectionForm(form)
    if (validationError) {
      showToast(validationError, 'error')
      setTestFeedback({ level: 'error', message: validationError })
      return
    }

    setBusy(true)
    setTestFeedback(null)
    try {
      const result = await unwrap(api.connection.test(buildPayload(form)))
      setTestFeedback({ level: 'success', message: result.message })
      showToast(result.message, 'success')
    } catch (err) {
      const message = (err as Error).message
      setTestFeedback({ level: 'error', message })
      showToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const onSave = async () => {
    const validationError = validateConnectionForm(form)
    if (validationError) {
      showToast(validationError, 'error')
      return
    }

    setBusy(true)
    try {
      await unwrap(api.connection.upsert(buildPayload(form)))
      showToast('Saved', 'success')
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={connection ? 'Edit Connection' : 'New Connection'}
      description="Connect to MySQL or PostgreSQL, directly or through an SSH tunnel."
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onTest} disabled={busy}>
            Test
          </Button>
          <Button onClick={onSave} disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Engine">
          <select
            value={form.engine}
            onChange={(e) => update('engine', e.target.value as DbEngine)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="mysql">MySQL</option>
            <option value="postgres">PostgreSQL</option>
          </select>
        </Field>
        <Field label="Name">
          <Input value={form.name} onChange={(e) => update('name', e.target.value)} />
        </Field>
        <Field label="Group">
          <Input value={form.group || ''} onChange={(e) => update('group', e.target.value)} />
        </Field>
        <div />
        <Field label="Host">
          <Input value={form.host} onChange={(e) => update('host', e.target.value)} />
        </Field>
        <Field label="Port">
          <Input
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(e) => update('port', parsePortValue(e.target.value, DEFAULT_PORT[form.engine]))}
          />
        </Field>
        <Field label="Username">
          <Input value={form.username} onChange={(e) => update('username', e.target.value)} />
        </Field>
        <Field label={`Password${connection?.hasPassword ? ' (leave blank to keep)' : ''}`}>
          <Input
            type="password"
            value={form.password || ''}
            onChange={(e) => update('password', e.target.value)}
          />
        </Field>
        <Field label="Default Database">
          <Input
            value={form.database || ''}
            onChange={(e) => update('database', e.target.value)}
          />
        </Field>
        <div />

        <div className="col-span-2 mt-2 flex items-center gap-2">
          <Checkbox
            checked={form.useSSH}
            onChange={(e) => update('useSSH', e.target.checked)}
            id="useSSH"
          />
          <label htmlFor="useSSH" className="text-sm">Use SSH Tunnel</label>
        </div>

        {form.useSSH && (
          <>
            <Field label="SSH Host">
              <Input value={form.sshHost || ''} onChange={(e) => update('sshHost', e.target.value)} />
            </Field>
            <Field label="SSH Port">
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.sshPort || 22}
                onChange={(e) => update('sshPort', parsePortValue(e.target.value, 22))}
              />
            </Field>
            <Field label="SSH Username">
              <Input
                value={form.sshUsername || ''}
                onChange={(e) => update('sshUsername', e.target.value)}
              />
            </Field>
            <Field label={`SSH Password${connection?.hasSSHPassword ? ' (leave blank to keep)' : ''}`}>
              <Input
                type="password"
                value={form.sshPassword || ''}
                onChange={(e) => update('sshPassword', e.target.value)}
              />
            </Field>
            <Field
              label={`SSH Private Key${connection?.hasSSHPrivateKey ? ' (leave blank to keep)' : ''}`}
              className="col-span-2"
            >
              <input
                ref={sshKeyInputRef}
                type="file"
                className="hidden"
                onChange={onSSHKeyInputChange}
              />
              <div
                className={
                  draggingSSHKey
                    ? 'mb-2 rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm text-primary'
                    : 'mb-2 rounded-md border border-dashed border-input bg-background/60 px-3 py-2 text-sm text-muted-foreground'
                }
                onDragOver={(e) => e.preventDefault()}
                onDragEnter={(e) => {
                  e.preventDefault()
                  setDraggingSSHKey(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  setDraggingSSHKey(false)
                }}
                onDrop={onSSHKeyDrop}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Drop a private key file here, or choose a file.</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => sshKeyInputRef.current?.click()}
                  >
                    Choose File
                  </Button>
                </div>
              </div>
              <textarea
                value={form.sshPrivateKey || ''}
                onChange={(e) => update('sshPrivateKey', e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                rows={4}
                className="w-full rounded-md border border-input bg-background p-2 text-xs font-mono"
              />
            </Field>
            <Field label="Key Passphrase">
              <Input
                type="password"
                value={form.sshPassphrase || ''}
                onChange={(e) => update('sshPassphrase', e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      {testFeedback && (
        <div
          className={
            testFeedback.level === 'error'
              ? 'mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300'
              : 'mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300'
          }
        >
          {testFeedback.message}
        </div>
      )}
    </Dialog>
  )
}

function createInitialForm(connection?: SafeConnection | null): ConnectionConfig {
  const engine: DbEngine = connection?.engine || 'mysql'
  return {
    id: connection?.id || '',
    engine,
    name: connection?.name || '',
    group: connection?.group || '',
    host: connection?.host || '127.0.0.1',
    port: connection?.port || DEFAULT_PORT[engine],
    username: connection?.username || (engine === 'postgres' ? 'postgres' : 'root'),
    password: '',
    database: connection?.database || '',
    useSSH: connection?.useSSH || false,
    sshHost: connection?.sshHost || '',
    sshPort: connection?.sshPort || 22,
    sshUsername: connection?.sshUsername || '',
    sshPassword: '',
    sshPrivateKey: '',
    sshPassphrase: '',
    createdAt: connection?.createdAt || 0,
    updatedAt: 0
  }
}

function buildPayload(form: ConnectionConfig): ConnectionConfig {
  return {
    ...form,
    name: form.name.trim(),
    group: form.group?.trim(),
    host: form.host.trim(),
    username: form.username.trim(),
    database: form.database?.trim(),
    sshHost: form.useSSH ? form.sshHost?.trim() : undefined,
    sshUsername: form.useSSH ? form.sshUsername?.trim() : undefined,
    password: form.password ? form.password : undefined,
    sshPassword: form.useSSH && form.sshPassword ? form.sshPassword : undefined,
    sshPrivateKey: form.useSSH && form.sshPrivateKey?.trim() ? form.sshPrivateKey.trim() : undefined,
    sshPassphrase: form.useSSH && form.sshPassphrase ? form.sshPassphrase : undefined
  }
}

function validateConnectionForm(form: ConnectionConfig): string | null {
  if (!form.name.trim()) return 'Name is required'
  if (!form.host.trim()) return 'Host is required'
  if (!form.username.trim()) return 'Username is required'
  if (!isValidPort(form.port)) return 'Port must be between 1 and 65535'

  if (!form.useSSH) return null

  if (!form.sshHost?.trim()) return 'SSH host is required when SSH tunnel is enabled'
  if (!form.sshUsername?.trim()) return 'SSH username is required when SSH tunnel is enabled'
  if (!isValidPort(form.sshPort)) return 'SSH port must be between 1 and 65535'

  const hasSSHPassword = Boolean(form.sshPassword?.trim())
  const hasSSHKey = Boolean(form.sshPrivateKey?.trim())
  if (!hasSSHPassword && !hasSSHKey) {
    return 'SSH password or private key is required when SSH tunnel is enabled'
  }

  return null
}

function parsePortValue(value: string, fallback: number): number {
  if (!value.trim()) return fallback
  const port = Number(value)
  return Number.isInteger(port) ? port : fallback
}

function isValidPort(value: number | undefined): boolean {
  if (value === undefined) return false
  return Number.isInteger(value) && value >= 1 && value <= 65535
}

function Field({
  label,
  children,
  className
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <Label className="mb-1 block">{label}</Label>
      {children}
    </div>
  )
}
