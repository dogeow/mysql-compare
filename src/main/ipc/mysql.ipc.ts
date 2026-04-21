import { IPC } from '../../shared/ipc-channels'
import type {
  CopyTableRequest,
  DeleteRowsRequest,
  DropTableRequest,
  ExportTableRequest,
  ExportTableResult,
  InsertRowRequest,
  QueryRowsRequest,
  QueryRowsResult,
  RenameTableRequest,
  UpdateRowRequest
} from '../../shared/types'
import { exportService } from '../services/export-service'
import { mysqlService } from '../services/mysql-service'
import { schemaService } from '../services/schema-service'
import { handle } from './_wrap'

export function registerMySQLIPC(): void {
  handle(IPC.ListDatabases, ({ connectionId }: { connectionId: string }) =>
    mysqlService.listDatabases(connectionId)
  )

  handle(
    IPC.ListTables,
    ({ connectionId, database }: { connectionId: string; database: string }) =>
      mysqlService.listTables(connectionId, database)
  )

  handle(IPC.QueryRows, async (req: QueryRowsRequest): Promise<QueryRowsResult> => {
    const schema = await schemaService.getTableSchema(req.connectionId, req.database, req.table)
    const { rows, total } = await mysqlService.queryRows(req)
    return {
      rows,
      total,
      hasPrimaryKey: schema.primaryKey.length > 0,
      primaryKey: schema.primaryKey,
      columns: schema.columns
    }
  })

  handle(IPC.InsertRow, (req: InsertRowRequest) => mysqlService.insertRow(req))
  handle(IPC.UpdateRow, (req: UpdateRowRequest) => mysqlService.updateRow(req))
  handle(IPC.DeleteRows, (req: DeleteRowsRequest) => mysqlService.deleteRows(req))
  handle(IPC.RenameTable, (req: RenameTableRequest) => mysqlService.renameTable(req))
  handle(IPC.CopyTable, (req: CopyTableRequest) => mysqlService.copyTable(req))
  handle(IPC.DropTable, (req: DropTableRequest) => mysqlService.dropTable(req))
  handle(IPC.ExportTable, (req: ExportTableRequest): Promise<ExportTableResult> => exportService.exportTable(req))

  handle(
    IPC.ExecuteSQL,
    ({ connectionId, sql, database }: { connectionId: string; sql: string; database?: string }) =>
      mysqlService.executeSQL(connectionId, sql, database)
  )
}
