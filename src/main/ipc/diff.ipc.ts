import { IPC } from '../../shared/ipc-channels'
import type { DiffRequest, TableDiffRequest } from '../../shared/types'
import { diffService } from '../services/diff-service'
import { handle } from './_wrap'

export function registerDiffIPC(): void {
  handle(IPC.DiffDatabases, (req: DiffRequest) =>
    diffService.diffDatabases(
      req.sourceConnectionId,
      req.sourceDatabase,
      req.targetConnectionId,
      req.targetDatabase,
      req.includeData ?? true,
      req.tables
    )
  )
  handle(IPC.DiffTable, (req: TableDiffRequest) =>
    diffService.diffTable(
      req.sourceConnectionId,
      req.sourceDatabase,
      req.targetConnectionId,
      req.targetDatabase,
      req.table,
      req.includeData ?? true
    )
  )
}
