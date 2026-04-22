import type { ColumnInfo, IndexInfo, TableSchema } from '../../../shared/types'
import type { Dialect } from './types'

function escapeIdent(name: string): string {
  return name.replace(/"/g, '""')
}

export const pgDialect: Dialect = {
  engine: 'postgres',

  quoteIdent(name) {
    return `"${escapeIdent(name)}"`
  },

  quoteTable(database, table) {
    // PG：MVP 把 UI 层传入的 database 视为 schema（下层 pg Client 已绑定具体 database）。
    return `${this.quoteIdent(database)}.${this.quoteIdent(table)}`
  },

  formatLiteral(value) {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (value instanceof Date) return `'${value.toISOString()}'`
    if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'`
    if (typeof value === 'object') {
      const s = JSON.stringify(value).replace(/'/g, "''")
      return `'${s}'`
    }
    const s = String(value).replace(/'/g, "''")
    return `'${s}'`
  },

  renderInsert(database, table, columns, rows) {
    const target = this.quoteTable(database, table)
    const columnList = columns.map((c) => this.quoteIdent(c.name)).join(', ')
    const valuesSQL = rows
      .map((row) => {
        const vals = columns.map((c) => this.formatLiteral(row[c.name]))
        return `(${vals.join(', ')})`
      })
      .join(',\n  ')
    return `INSERT INTO ${target} (${columnList}) VALUES\n  ${valuesSQL};`
  },

  renderTruncate(database, table) {
    return `TRUNCATE TABLE ${this.quoteTable(database, table)};`
  },

  renderDropIfExists(database, table) {
    return `DROP TABLE IF EXISTS ${this.quoteTable(database, table)};`
  },

  /** PG 不需要 DEFINER 清理 */
  stripDefiner(sql) {
    return sql
  }
}

/** 从 schema 重建 CREATE TABLE（MVP：列 / NOT NULL / DEFAULT / PRIMARY KEY / UNIQUE / 普通索引） */
export function renderPgCreateTable(schema: TableSchema, database: string): string {
  const q = pgDialect.quoteIdent.bind(pgDialect)
  const target = pgDialect.quoteTable(database, schema.name)

  const columnDefs = schema.columns.map((c) => renderColumnDef(c))
  const pkCols = schema.primaryKey
  if (pkCols.length > 0) {
    columnDefs.push(`PRIMARY KEY (${pkCols.map((n) => q(n)).join(', ')})`)
  }

  const lines = [`CREATE TABLE ${target} (`, columnDefs.map((l) => `  ${l}`).join(',\n'), ');']
  const body = lines.join('\n')

  const indexStmts = schema.indexes
    .filter((i) => i.name !== 'PRIMARY' && !isPkIndex(i, pkCols))
    .map((i) => renderIndex(database, schema.name, i))

  const comments: string[] = []
  if (schema.tableComment) {
    comments.push(
      `COMMENT ON TABLE ${target} IS ${pgDialect.formatLiteral(schema.tableComment)};`
    )
  }
  for (const c of schema.columns) {
    if (c.comment) {
      comments.push(
        `COMMENT ON COLUMN ${target}.${q(c.name)} IS ${pgDialect.formatLiteral(c.comment)};`
      )
    }
  }

  return [body, ...indexStmts, ...comments].join('\n')
}

function renderColumnDef(c: ColumnInfo): string {
  const q = pgDialect.quoteIdent.bind(pgDialect)
  const parts = [`${q(c.name)} ${c.type}`]
  if (!c.nullable) parts.push('NOT NULL')
  if (c.defaultValue !== null && c.defaultValue !== undefined) {
    parts.push(`DEFAULT ${c.defaultValue}`)
  }
  return parts.join(' ')
}

function renderIndex(database: string, table: string, index: IndexInfo): string {
  const q = pgDialect.quoteIdent.bind(pgDialect)
  const unique = index.unique ? 'UNIQUE ' : ''
  const cols = index.columns.map((c) => q(c)).join(', ')
  return `CREATE ${unique}INDEX ${q(index.name)} ON ${pgDialect.quoteTable(database, table)} (${cols});`
}

function isPkIndex(index: IndexInfo, pkCols: string[]): boolean {
  if (!index.unique) return false
  if (index.columns.length !== pkCols.length) return false
  return index.columns.every((c, i) => c === pkCols[i])
}
