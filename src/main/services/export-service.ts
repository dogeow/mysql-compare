import { appendFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { RowDataPacket } from 'mysql2'
import { schemaService } from './schema-service'
import { mysqlService } from './mysql-service'
import type { ColumnInfo, ExportTableRequest, ExportTableResult } from '../../shared/types'

const EXPORT_BATCH_SIZE = 1000

export class ExportService {
  async exportTable(req: ExportTableRequest): Promise<ExportTableResult> {
    this.validate(req)

    const schema = await schemaService.getTableSchema(req.connectionId, req.database, req.table)
    this.validateQueryOptions(req, schema.columns)
    const filePath = await this.pickFilePath(req)
    if (!filePath) {
      return { canceled: true, rowsExported: 0 }
    }

    await writeFile(filePath, '', 'utf8')

    let rowsExported = 0
    if (req.format === 'sql') {
      const includeCreateTable = req.includeCreateTable !== false
      const includeData = req.includeData !== false

      if (includeCreateTable) {
        await appendFile(filePath, `${ensureSemicolon(schema.createSQL)}\n\n`, 'utf8')
      }
      if (includeData) {
        for await (const rows of this.iterateRows(req, schema.columns, schema.primaryKey)) {
          if (rows.length === 0) continue
          rowsExported += rows.length
          await appendFile(filePath, `${buildInsertSQL(req.database, req.table, schema.columns, rows)}\n`, 'utf8')
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

      for await (const rows of this.iterateRows(req, schema.columns, schema.primaryKey)) {
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
    if (req.scope !== 'all' && req.scope !== 'filtered' && req.scope !== 'page') {
      throw new Error('Unsupported export scope')
    }
    if (req.scope === 'page') {
      if (!req.page || req.page < 1) throw new Error('Page export requires a valid page number')
      if (!req.pageSize || req.pageSize < 1) throw new Error('Page export requires page size')
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

  private async pickFilePath(req: ExportTableRequest): Promise<string | null> {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const extension = req.format === 'sql' ? 'sql' : req.format
    const formatName = req.format === 'txt' ? 'Text' : req.format.toUpperCase()
    const options = {
      title: `Export ${req.database}.${req.table}`,
      defaultPath: sanitizeFileName(`${req.database}.${req.table}.${req.scope}.${extension}`),
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
    req: ExportTableRequest,
    columns: ColumnInfo[],
    primaryKey: string[]
  ): AsyncGenerator<Record<string, unknown>[]> {
    const pool = await mysqlService.getPool(req.connectionId, req.database)
    const columnList = columns.map((column) => quoteIdent(column.name)).join(', ')
    const tableName = quoteTable(req.database, req.table)
    const whereClause =
      req.scope === 'all' || !req.where?.trim() ? '' : `WHERE ${req.where.trim()}`
    const orderClause = buildStableOrderClause(columns, primaryKey, req.orderBy)

    if (req.scope === 'page') {
      const limit = Math.max(1, req.pageSize ?? 100)
      const offset = Math.max(0, ((req.page ?? 1) - 1) * limit)
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${columnList} FROM ${tableName} ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`
      )
      yield rows as Record<string, unknown>[]
      return
    }

    let offset = 0
    while (true) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT ${columnList} FROM ${tableName} ${whereClause} ${orderClause} LIMIT ${EXPORT_BATCH_SIZE} OFFSET ${offset}`
      )
      const chunk = rows as Record<string, unknown>[]
      if (chunk.length === 0) return
      yield chunk
      if (chunk.length < EXPORT_BATCH_SIZE) return
      offset += chunk.length
    }
  }
}

function buildInsertSQL(
  database: string,
  table: string,
  columns: ColumnInfo[],
  rows: Record<string, unknown>[]
): string {
  const columnList = columns.map((column) => quoteIdent(column.name)).join(', ')
  const values = rows
    .map((row) => {
      const serialized = columns.map((column) => formatSQLValue(row[column.name]))
      return `(${serialized.join(', ')})`
    })
    .join(',\n  ')
  return `INSERT INTO ${quoteTable(database, table)} (${columnList}) VALUES\n  ${values};`
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

function formatSQLValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`
  if (Buffer.isBuffer(value)) return `0x${value.toString('hex')}`
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
  }
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

function ensureSemicolon(sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) return ''
  return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``
}

function quoteTable(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`
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

function buildStableOrderClause(
  columns: ColumnInfo[],
  primaryKey: string[],
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
): string {
  const parts: string[] = []
  const seen = new Set<string>()

  if (orderBy) {
    parts.push(`${quoteIdent(orderBy.column)} ${orderBy.dir}`)
    seen.add(orderBy.column)
  }

  const stableColumns = primaryKey.length > 0 ? primaryKey : columns.map((column) => column.name)
  for (const column of stableColumns) {
    if (seen.has(column)) continue
    parts.push(`${quoteIdent(column)} ASC`)
    seen.add(column)
  }

  return parts.length > 0 ? `ORDER BY ${parts.join(', ')}` : ''
}

export const exportService = new ExportService()
