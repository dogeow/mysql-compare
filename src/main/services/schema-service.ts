// 表结构 / 索引 / DDL 读取。所有写操作都不在这里。
import type { RowDataPacket } from 'mysql2'
import { mysqlService } from './mysql-service'
import type { ColumnInfo, IndexInfo, TableSchema } from '../../shared/types'

export class SchemaService {
  async getTableSchema(
    connectionId: string,
    database: string,
    table: string
  ): Promise<TableSchema> {
    const pool = await mysqlService.getPool(connectionId, database)

    const [colRows] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
              COLUMN_KEY, EXTRA, COLUMN_COMMENT
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table]
    )

    const columns: ColumnInfo[] = colRows.map((r) => ({
      name: r['COLUMN_NAME'] as string,
      type: r['COLUMN_TYPE'] as string,
      nullable: (r['IS_NULLABLE'] as string) === 'YES',
      defaultValue: (r['COLUMN_DEFAULT'] as string | null) ?? null,
      isPrimaryKey: r['COLUMN_KEY'] === 'PRI',
      isAutoIncrement: typeof r['EXTRA'] === 'string' && r['EXTRA'].includes('auto_increment'),
      comment: (r['COLUMN_COMMENT'] as string) || '',
      columnKey: (r['COLUMN_KEY'] as string) || ''
    }))

    const [idxRows] = await pool.query<RowDataPacket[]>(
      `SELECT INDEX_NAME, NON_UNIQUE, INDEX_TYPE, COLUMN_NAME, SEQ_IN_INDEX
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [database, table]
    )
    const indexMap = new Map<string, IndexInfo>()
    for (const r of idxRows) {
      const name = r['INDEX_NAME'] as string
      if (!indexMap.has(name)) {
        indexMap.set(name, {
          name,
          columns: [],
          unique: r['NON_UNIQUE'] === 0 || r['NON_UNIQUE'] === '0',
          type: (r['INDEX_TYPE'] as string) || 'BTREE'
        })
      }
      indexMap.get(name)!.columns.push(r['COLUMN_NAME'] as string)
    }
    const indexes = Array.from(indexMap.values())
    const primaryKey = indexes.find((i) => i.name === 'PRIMARY')?.columns ?? []

    const [createRows] = await pool.query<RowDataPacket[]>(
      `SHOW CREATE TABLE ${quoteTable(database, table)}`
    )
    const createSQL = (createRows[0]?.['Create Table'] as string) || ''

    const [statRows] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_ROWS, ENGINE, TABLE_COLLATION, TABLE_COMMENT,
              DATA_LENGTH, INDEX_LENGTH, DATA_FREE, AVG_ROW_LENGTH,
              AUTO_INCREMENT, CREATE_TIME, UPDATE_TIME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [database, table]
    )

    return {
      name: table,
      columns,
      indexes,
      primaryKey,
      createSQL,
      rowEstimate: Number(statRows[0]?.['TABLE_ROWS'] ?? 0),
      engine: statRows[0]?.['ENGINE'] as string,
      charset: statRows[0]?.['TABLE_COLLATION'] as string,
      tableComment: (statRows[0]?.['TABLE_COMMENT'] as string) || '',
      dataLength: Number(statRows[0]?.['DATA_LENGTH'] ?? 0),
      indexLength: Number(statRows[0]?.['INDEX_LENGTH'] ?? 0),
      dataFree: Number(statRows[0]?.['DATA_FREE'] ?? 0),
      avgRowLength: Number(statRows[0]?.['AVG_ROW_LENGTH'] ?? 0),
      autoIncrement: (statRows[0]?.['AUTO_INCREMENT'] as number | null | undefined) ?? null,
      createdAt: (statRows[0]?.['CREATE_TIME'] as string | null | undefined) ?? null,
      updatedAt: (statRows[0]?.['UPDATE_TIME'] as string | null | undefined) ?? null
    }
  }
}

function quoteTable(database: string, table: string): string {
  return `\`${database.replace(/`/g, '``')}\`.\`${table.replace(/`/g, '``')}\``
}

export const schemaService = new SchemaService()
