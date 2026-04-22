import { registerConnectionIPC } from './connection.ipc'
import { registerDbIPC } from './db.ipc'
import { registerSchemaIPC } from './schema.ipc'
import { registerDiffIPC } from './diff.ipc'
import { registerSyncIPC } from './sync.ipc'

export function registerIPC(): void {
  registerConnectionIPC()
  registerDbIPC()
  registerSchemaIPC()
  registerDiffIPC()
  registerSyncIPC()
}
