import { IPC } from '../../shared/ipc-channels'
import type { DiffRequest } from '../../shared/types'
import { diffService } from '../services/diff-service'
import { handle } from './_wrap'

export function registerDiffIPC(): void {
  handle(IPC.DiffDatabases, (req: DiffRequest) =>
    diffService.diffDatabases(
      req.sourceConnectionId,
      req.sourceDatabase,
      req.targetConnectionId,
      req.targetDatabase
    )
  )
}
