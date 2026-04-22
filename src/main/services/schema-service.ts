// 表结构委托给 driver。保留这一层是为了让 IPC 层仍按原 channel 调用。
import type { TableSchema } from '../../shared/types'
import { dbService } from './db-service'

export class SchemaService {
  async getTableSchema(
    connectionId: string,
    database: string,
    table: string
  ): Promise<TableSchema> {
    const driver = await dbService.getDriver(connectionId)
    return driver.getTableSchema(database, table)
  }
}

export const schemaService = new SchemaService()
