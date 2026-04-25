// 新增 / 编辑连接的弹窗
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { api, unwrap } from '@renderer/lib/api'
import { useUIStore } from '@renderer/store/ui-store'
import type { ConnectionConfig, DbEngine, SafeConnection } from '../../../shared/types'
import { ConnectionDialogForm } from './ConnectionDialogForm'
import {
  buildPayload,
  createInitialForm,
  DEFAULT_PORT,
  validateConnectionForm
} from './connection-dialog-utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  connection?: SafeConnection | null
  onSaved?: () => void
}

export function ConnectionDialog({ open, onOpenChange, connection, onSaved }: Props) {
  const { showToast } = useUIStore()
  const sshKeyInputRef = useRef<HTMLInputElement>(null)
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
      <ConnectionDialogForm
        connection={connection}
        form={form}
        draggingSSHKey={draggingSSHKey}
        onChange={update}
        onSSHKeyInputChange={onSSHKeyInputChange}
        onSSHKeyDrop={onSSHKeyDrop}
        onSSHKeyDraggingChange={setDraggingSSHKey}
        sshKeyInputRef={sshKeyInputRef}
      />
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
