import { appendFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { schemaService } from './schema-service'
import { dbService } from './db-service'
import type { DbDriver } from './drivers/types'
import { mysqlDialect } from './drivers/mysql-dialect'
import { pgDialect, renderPgCreateTable } from './drivers/pg-dialect'
import type { ColumnInfo, DbEngine, ExportSqlDialect, ExportTableRequest, ExportTableResult, TableSchema } from '../../shared/types'

const EXPORT_BATCH_SIZE = 1000

export class ExportService {
  async exportTable(req: ExportTableRequest): Promise<ExportTableResult> {
    this.validate(req)

    const driver = await dbService.getDriver(req.connectionId)
    const schema = await schemaService.getTableSchema(req.connectionId, req.database, req.table)
    const sqlDialect = resolveSqlDialect(req.sqlDialect, driver.engine)
    assertSqlDialectSupported(driver.engine, sqlDialect)
    this.validateQueryOptions(req, schema.columns)
    const filePath = await this.pickFilePath(req, sqlDialect)
    if (!filePath) {
      return { canceled: true, rowsExported: 0 }
    }

    await writeFile(filePath, '', 'utf8')

    let rowsExported = 0
    if (req.format === 'sql') {
      const includeCreateTable = req.includeCreateTable !== false
      const includeData = req.includeData !== false

      if (includeCreateTable) {
        await appendFile(filePath, `${buildCreateTableSQL(schema, req.database, driver, sqlDialect)}\n\n`, 'utf8')
      }
      if (includeData) {
        const targetDialect = getTargetDialect(driver, sqlDialect)
        for await (const rows of this.iterateRows(driver, req, schema.columns, schema.primaryKey)) {
          if (rows.length === 0) continue
          rowsExported += rows.length
          await appendFile(
            filePath,
            `${targetDialect.renderInsert(req.database, req.table, schema.columns, rows)}\n`,
            'utf8'
          )
        }
      }
    } else {
      const delimiter = req.format === 'csv' ? ',' : '\t'
      const includeHeaders = req.includeHeaders !== false

      if (includeHeaders) {
        await appendFile(
          filePath,
          `${schema.columns.map((column) => quoteDelimitedValue(column.name, delimiter)).join(delimiter)}\n`,
          'utf8'
        )
      }

      for await (const rows of this.iterateRows(driver, req, schema.columns, schema.primaryKey)) {
        if (rows.length === 0) continue
        rowsExported += rows.length
        await appendFile(filePath, `${buildDelimitedRows(schema.columns, rows, delimiter)}\n`, 'utf8')
      }
    }

    return { canceled: false, filePath, rowsExported }
  }

  private validate(req: ExportTableRequest): void {
    if (req.format === 'sql' && req.includeCreateTable === false && req.includeData === false) {
      throw new Error('Select structure or data for SQL export')
    }
    if (
      req.sqlDialect !== undefined &&
      req.sqlDialect !== 'source' &&
      req.sqlDialect !== 'mysql' &&
      req.sqlDialect !== 'postgres'
    ) {
      throw new Error('Unsupported SQL export dialect')
    }
    if (req.scope !== 'all' && req.scope !== 'filtered' && req.scope !== 'page' && req.scope !== 'selected') {
      throw new Error('Unsupported export scope')
    }
    if (req.scope === 'page') {
      if (!req.page || req.page < 1) throw new Error('Page export requires a valid page number')
      if (!req.pageSize || req.pageSize < 1) throw new Error('Page export requires page size')
    }
    if (req.scope === 'selected' && (!req.selectedRows || req.selectedRows.length === 0)) {
      throw new Error('Selected export requires at least one row')
    }
  }

  private validateQueryOptions(req: ExportTableRequest, columns: ColumnInfo[]): void {
    if (req.where?.trim()) {
      const where = req.where.trim()
      if (where.includes(';')) throw new Error('WHERE clause must not contain semicolons')
      if (/--|\/\*/.test(where)) throw new Error('WHERE clause must not contain SQL comments')
    }

    if (req.orderBy) {
      const allowedColumns = new Set(columns.map((column) => column.name))
      if (!allowedColumns.has(req.orderBy.column)) {
        throw new Error(`Unknown sort column "${req.orderBy.column}"`)
      }
    }
  }

  private async pickFilePath(req: ExportTableRequest, sqlDialect: DbEngine): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const extension = req.format === 'sql' ? 'sql' : req.format
    const formatName = req.format === 'sql' ? `${sqlDialect.toUpperCase()} SQL` : req.format === 'txt' ? 'Text' : req.format.toUpperCase()
    const dialectSuffix = req.format === 'sql' ? `.${sqlDialect}` : ''
    const options = {
      title: `Export ${req.database}.${req.table}`,
      defaultPath: sanitizeFileName(`${req.database}.${req.table}.${req.scope}${dialectSuffix}.${extension}`),
      filters: [
        { name: formatName, extensions: [extension] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const response = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (response.canceled || !response.filePath) return null
    return normalizeExtension(response.filePath, extension)
  }

  private async *iterateRows(
    driver: DbDriver,
    req: ExportTableRequest,
    columns: ColumnInfo[],
    primaryKey: string[]
  ): AsyncGenerator<Record<string, unknown>[]> {
    const columnNames = columns.map((c) => c.name)
    const where = req.scope === 'all' ? undefined : req.where

    if (req.scope === 'selected') {
      yield (req.selectedRows ?? []).map((row) => {
        const projected: Record<string, unknown> = {}
        for (const name of columnNames) projected[name] = row[name]
        return projected
      })
      return
    }

    if (req.scope === 'page') {
      const pageSize = Math.max(1, req.pageSize ?? 100)
      const result = await driver.queryRows({
        connectionId: req.connectionId,
        database: req.database,
        table: req.table,
        page: req.page ?? 1,
        pageSize,
        orderBy: req.orderBy,
        where
      })
      yield result.rows.map((row) => {
        const projected: Record<string, unknown> = {}
        for (const name of columnNames) projected[name] = row[name]
        return projected
      })
      return
    }

    for await (const batch of driver.streamRows({
      database: req.database,
      table: req.table,
      columns: columnNames,
      primaryKey,
      orderBy: req.orderBy,
      where,
      batchSize: EXPORT_BATCH_SIZE
    })) {
      yield batch
    }
  }
}

function resolveSqlDialect(sqlDialect: ExportSqlDialect | undefined, sourceEngine: DbEngine): DbEngine {
  if (!sqlDialect || sqlDialect === 'source') return sourceEngine
  return sqlDialect
}

function assertSqlDialectSupported(sourceEngine: DbEngine, sqlDialect: DbEngine): void {
  if ((sourceEngine === 'mysql' || sourceEngine === 'postgres') && (sqlDialect === 'mysql' || sqlDialect === 'postgres')) return
  throw new Error(`Exporting ${sourceEngine} tables as ${sqlDialect} SQL is not supported`)
}

function getTargetDialect(sourceDriver: DbDriver, sqlDialect: DbEngine) {
  if (sqlDialect === 'postgres') return pgDialect
  if (sqlDialect === 'mysql') return mysqlDialect
  return sourceDriver.dialect
}

function buildCreateTableSQL(
  schema: TableSchema,
  database: string,
  sourceDriver: DbDriver,
  sqlDialect: DbEngine
): string {
  if (sqlDialect === 'postgres') {
    return ensureSemicolon(
      renderPgCreateTable(schema, database, {
        includeSchema: true,
        sourceEngine: sourceDriver.engine
      })
    )
  }

  if (sqlDialect === 'mysql' && sourceDriver.engine === 'postgres') {
    return renderMySQLCreateTable(schema, database)
  }

  if (sqlDialect === 'mysql') {
    return ensureSemicolon(
      [
        `CREATE DATABASE IF NOT EXISTS ${mysqlDialect.quoteIdent(database)};`,
        qualifyMySQLCreateTable(sourceDriver.dialect.stripDefiner(schema.createSQL), database, schema.name)
      ].join('\n')
    )
  }

  return ensureSemicolon(sourceDriver.dialect.stripDefiner(schema.createSQL))
}

function renderMySQLCreateTable(schema: TableSchema, database: string): string {
  const columnLines = schema.columns.map((column) => {
    const type = mapTypeToMySQL(column.type)
    const nullable = column.nullable ? 'NULL' : 'NOT NULL'
    const autoIncrement = column.isAutoIncrement ? ' AUTO_INCREMENT' : ''
    const defaultValue = renderMySQLDefaultValue(column.defaultValue, column.isAutoIncrement)
    return `  ${mysqlDialect.quoteIdent(column.name)} ${type}${autoIncrement} ${nullable}${defaultValue}`
  })
  const primaryKey = schema.primaryKey.length
    ? [`  PRIMARY KEY (${schema.primaryKey.map((name) => mysqlDialect.quoteIdent(name)).join(', ')})`]
    : []
  return ensureSemicolon([
    `CREATE DATABASE IF NOT EXISTS ${mysqlDialect.quoteIdent(database)};`,
    `CREATE TABLE ${mysqlDialect.quoteTable(database, schema.name)} (`,
    [...columnLines, ...primaryKey].join(',\n'),
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  ].join('\n'))
}

function qualifyMySQLCreateTable(createSQL: string, database: string, table: string): string {
  const trimmed = createSQL.trim()
  if (!trimmed) return ''
  return trimmed.replace(
    /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(?:`[^`]+`|[^\s(.]+)(?:\.(?:`[^`]+`|[^\s(]+))?/i,
    (_match, ifNotExists: string | undefined) => {
      const existenceClause = ifNotExists ? ` ${ifNotExists.trim()}` : ''
      return `CREATE TABLE${existenceClause} ${mysqlDialect.quoteTable(database, table)}`
    }
  )
}

function mapTypeToMySQL(type: string): string {
  const normalized = type.toLowerCase().trim()
  const varcharMatch = normalized.match(/^(character varying|varchar)\((\d+)\)$/)
  if (varcharMatch) return `varchar(${varcharMatch[2]})`
  const charMatch = normalized.match(/^character\((\d+)\)$/)
  if (charMatch) return `char(${charMatch[1]})`
  const numericMatch = normalized.match(/^numeric\((\d+)(?:,(\d+))?\)$/)
  if (numericMatch) return `decimal(${numericMatch[1]}${numericMatch[2] ? `,${numericMatch[2]}` : ''})`
  if (normalized === 'bigint' || normalized === 'bigserial') return 'bigint'
  if (normalized === 'integer' || normalized === 'serial') return 'int'
  if (normalized === 'smallint' || normalized === 'smallserial') return 'smallint'
  if (normalized === 'boolean') return 'tinyint(1)'
  if (normalized === 'double precision') return 'double'
  if (normalized === 'real') return 'float'
  if (normalized === 'text' || normalized === 'citext') return 'text'
  if (normalized === 'json' || normalized === 'jsonb') return 'json'
  if (normalized === 'bytea') return 'blob'
  if (normalized === 'uuid') return 'char(36)'
  if (normalized === 'date') return 'date'
  if (normalized.startsWith('timestamp')) return 'datetime(6)'
  if (normalized.startsWith('time')) return 'time(6)'
  return type
}

function renderMySQLDefaultValue(defaultValue: string | null, isAutoIncrement: boolean): string {
  if (isAutoIncrement || defaultValue === null || defaultValue === undefined) return ''
  const normalized = defaultValue.trim()
  if (!normalized) return ''
  if (/^nextval\(/i.test(normalized)) return ''
  if (/^now\(\)|^current_timestamp/i.test(normalized)) return ' DEFAULT CURRENT_TIMESTAMP'
  if (/^null$/i.test(normalized)) return ' DEFAULT NULL'
  if (/^true$/i.test(normalized)) return ' DEFAULT 1'
  if (/^false$/i.test(normalized)) return ' DEFAULT 0'
  const castMatch = normalized.match(/^'(.*)'::[\w\s.[\]]+$/)
  if (castMatch) return ` DEFAULT ${mysqlDialect.formatLiteral(castMatch[1])}`
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return ` DEFAULT ${normalized}`
  return ` DEFAULT ${mysqlDialect.formatLiteral(normalized)}`
}

function buildDelimitedRows(
  columns: ColumnInfo[],
  rows: Record<string, unknown>[],
  delimiter: string
): string {
  return rows
    .map((row) =>
      columns
        .map((column) => quoteDelimitedValue(formatTextValue(row[column.name]), delimiter))
        .join(delimiter)
    )
    .join('\n')
}

function quoteDelimitedValue(value: string, delimiter: string): string {
  const escaped = value.replace(/"/g, '""')
  if (escaped.includes(delimiter) || escaped.includes('\n') || escaped.includes('\r') || escaped.includes('"')) {
    return `"${escaped}"`
  }
  return escaped
}

function formatTextValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function ensureSemicolon(sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) return ''
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

function normalizeExtension(filePath: string, extension: string): string {
  if (extname(filePath).toLowerCase() === `.${extension}`) return filePath
  const baseName = filePath.slice(0, filePath.length - extname(filePath).length)
  if (!extname(filePath)) return `${filePath}.${extension}`
  return join(dirname(filePath), `${baseName.split('/').pop() ?? 'export'}.${extension}`)
}

export const exportService = new ExportService()
