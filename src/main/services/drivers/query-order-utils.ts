import type { QueryRowsRequest, TableSchema } from '../../../shared/types'

export function resolveQueryRowsRequest(
  req: QueryRowsRequest,
  schema: TableSchema
): QueryRowsRequest {
  const orderBy =
    req.orderBy ??
    (schema.primaryKey[0] ? { column: schema.primaryKey[0], dir: 'ASC' as const } : undefined)

  return {
    ...req,
    orderBy,
    primaryKey: schema.primaryKey,
    columnNames: schema.columns.map((column) => column.name)
  }
}

export async function resolveQueryOrderContext(
  req: QueryRowsRequest,
  getTableSchema: (database: string, table: string) => Promise<TableSchema>
): Promise<{ primaryKey: string[]; columnNames: string[] }> {
  let primaryKey = req.primaryKey ?? []
  let columnNames = req.columnNames ?? []

  if (columnNames.length === 0 || primaryKey.length === 0) {
    const schema = await getTableSchema(req.database, req.table)
    if (columnNames.length === 0) {
      columnNames = schema.columns.map((column) => column.name)
    }
    if (primaryKey.length === 0) {
      primaryKey = schema.primaryKey
    }
  }

  return { primaryKey, columnNames }
}

export function buildDefaultOrderBy(primaryKey: string[]): QueryRowsRequest['orderBy'] {
  const primaryColumn = primaryKey[0]
  return primaryColumn ? { column: primaryColumn, dir: 'ASC' } : undefined
}
