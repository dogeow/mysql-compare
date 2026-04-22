import type { ColumnInfo } from '../../../shared/types'
import type { Dialect } from './types'

function escapeIdent(name: string): string {
  return name.replace(/`/g, '``')
}

export const mysqlDialect: Dialect = {
  engine: 'mysql',

  quoteIdent(name) {
    return `\`${escapeIdent(name)}\``
  },

  quoteTable(database, table) {
    return `${this.quoteIdent(database)}.${this.quoteIdent(table)}`
  },

  formatLiteral(value) {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`
    if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`
    if (typeof value === 'object') {
      const s = JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "''")
      return `'${s}'`
    }
    const s = String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")
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

  stripDefiner(sql) {
    return sql.replace(/\sDEFINER=`[^`]+`@`[^`]+`/g, '')
  }
}

/** 辅助：在列基础上构建稳定排序子句，供 driver 内部 SELECT 使用 */
export function buildMySQLOrderClause(
  columns: ColumnInfo[],
  primaryKey: string[],
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
): string {
  const parts: string[] = []
  const seen = new Set<string>()

  if (orderBy) {
    parts.push(`${mysqlDialect.quoteIdent(orderBy.column)} ${orderBy.dir}`)
    seen.add(orderBy.column)
  }

  const stable = primaryKey.length > 0 ? primaryKey : columns.map((c) => c.name)
  for (const name of stable) {
    if (seen.has(name)) continue
    parts.push(`${mysqlDialect.quoteIdent(name)} ASC`)
    seen.add(name)
  }

  return parts.length > 0 ? `ORDER BY ${parts.join(', ')}` : ''
}
