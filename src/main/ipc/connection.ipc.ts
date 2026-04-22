import { IPC } from '../../shared/ipc-channels'
import type { ConnectionConfig } from '../../shared/types'
import { connectionStore } from '../store/connection-store'
import { dbService } from '../services/db-service'
import { handle } from './_wrap'

export function registerConnectionIPC(): void {
  handle(IPC.ConnectionList, () => connectionStore.list())

  handle(IPC.ConnectionUpsert, async (conn: ConnectionConfig) => {
    const saved = connectionStore.upsert(conn)
    await dbService.closeConnection(saved.id)
    return saved
  })

  handle(IPC.ConnectionDelete, async (id: string) => {
    connectionStore.remove(id)
    await dbService.closeConnection(id)
  })

  handle(IPC.ConnectionTest, async (conn: ConnectionConfig) => {
    const resolved = connectionStore.resolveSecrets(conn)
    const message = await dbService.testConnection(resolved)
    return { message }
  })
}
