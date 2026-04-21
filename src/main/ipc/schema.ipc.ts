import { IPC } from '../../shared/ipc-channels'
import { schemaService } from '../services/schema-service'
import { handle } from './_wrap'

export function registerSchemaIPC(): void {
  handle(
    IPC.GetTableSchema,
    ({ connectionId, database, table }: { connectionId: string; database: string; table: string }) =>
      schemaService.getTableSchema(connectionId, database, table)
  )
}
