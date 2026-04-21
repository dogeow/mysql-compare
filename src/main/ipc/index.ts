import { registerConnectionIPC } from './connection.ipc'
import { registerMySQLIPC } from './mysql.ipc'
import { registerSchemaIPC } from './schema.ipc'
import { registerDiffIPC } from './diff.ipc'
import { registerSyncIPC } from './sync.ipc'

export function registerIPC(): void {
  registerConnectionIPC()
  registerMySQLIPC()
  registerSchemaIPC()
  registerDiffIPC()
  registerSyncIPC()
}
