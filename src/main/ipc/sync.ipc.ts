import { IPC } from '../../shared/ipc-channels'
import type { SyncRequest } from '../../shared/types'
import { syncService } from '../services/sync-service'
import { handle } from './_wrap'

export function registerSyncIPC(): void {
  handle(IPC.BuildSyncPlan, (req: SyncRequest) => syncService.buildPlan(req))
  handle(IPC.ExecuteSync, (req: SyncRequest) => syncService.execute(req))
}
