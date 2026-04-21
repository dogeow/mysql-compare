import { IPC } from '../../shared/ipc-channels'
import type { ConnectionConfig } from '../../shared/types'
import { connectionStore } from '../store/connection-store'
import { mysqlService } from '../services/mysql-service'
import { handle } from './_wrap'

export function registerConnectionIPC(): void {
  handle(IPC.ConnectionList, () => connectionStore.list())

  handle(IPC.ConnectionUpsert, async (conn: ConnectionConfig) => {
    const saved = connectionStore.upsert(conn)
    await mysqlService.closeConnection(saved.id)
    return saved
  })

  handle(IPC.ConnectionDelete, async (id: string) => {
    connectionStore.remove(id)
    await mysqlService.closeConnection(id)
  })

  handle(IPC.ConnectionTest, async (conn: ConnectionConfig) => {
    const resolved = connectionStore.resolveSecrets(conn)
    const message = await mysqlService.testConnection(resolved)
    return { message }
  })
}
