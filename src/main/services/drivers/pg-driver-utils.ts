import type { IndexInfo } from '../../../shared/types'
import { pgDialect } from './pg-dialect'

const DEFAULT_SCHEMA = 'public'

export function formatPgType(column: {
  data_type: string
  udt_name: string
  character_maximum_length: number | null
  numeric_precision: number | null
  numeric_scale: number | null
}): string {
  if (column.character_maximum_length) {
    return `${column.data_type}(${column.character_maximum_length})`
  }
  if (
    column.data_type === 'numeric' &&
    column.numeric_precision !== null &&
    column.numeric_scale !== null
  ) {
    return `numeric(${column.numeric_precision},${column.numeric_scale})`
  }
  return column.data_type
}

export function parseIndexDef(name: string, definition: string): IndexInfo {
  const unique = /^CREATE\s+UNIQUE\s+INDEX/i.test(definition)
  const usingMatch = definition.match(/USING\s+(\w+)/i)
  const type = usingMatch ? usingMatch[1]!.toUpperCase() : 'BTREE'
  const columnsMatch = definition.match(/\(([^)]+)\)\s*$/)
  const columns = columnsMatch
    ? columnsMatch[1]!.split(',').map((value) => value.trim().replace(/^"/, '').replace(/"$/, ''))
    : []
  return { name, columns, unique, type }
}

export function buildPgOrderClause(
  columns: string[],
  primaryKey: string[],
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
): string {
  const parts: string[] = []
  const seen = new Set<string>()
  if (orderBy) {
    parts.push(`${pgDialect.quoteIdent(orderBy.column)} ${orderBy.dir}`)
    seen.add(orderBy.column)
  }
  const stable = primaryKey.length > 0 ? primaryKey : columns
  for (const name of stable) {
    if (seen.has(name)) continue
    parts.push(`${pgDialect.quoteIdent(name)} ASC`)
    seen.add(name)
  }
  return parts.length > 0 ? `ORDER BY ${parts.join(', ')}` : ''
}

export function qualifiedName(table: string): string {
  return `"${DEFAULT_SCHEMA}"."${table.replace(/"/g, '""')}"`
}

export function assertColumns(columns: string[], label: string): void {
  for (const column of columns) {
    assertNonEmptySQL(`${label} column`, column)
  }
}

export function assertSafeWhereClause(where?: string): void {
  if (!where?.trim()) return
  const trimmed = where.trim()
  if (trimmed.includes(';')) throw new Error('WHERE clause must not contain semicolons')
  if (/--|\/\*/.test(trimmed)) throw new Error('WHERE clause must not contain SQL comments')
}

export function assertNonEmptySQL(label: string, value: string): void {
  if (!value.trim()) throw new Error(`${label} is required`)
}