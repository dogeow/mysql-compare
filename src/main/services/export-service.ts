import { appendFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { schemaService } from './schema-service'
import { dbService } from './db-service'
import type { DbDriver } from './drivers/types'
import type { ColumnInfo, ExportTableRequest, ExportTableResult } from '../../shared/types'

const EXPORT_BATCH_SIZE = 1000

export class ExportService {
  async exportTable(req: ExportTableRequest): Promise<ExportTableResult> {
    this.validate(req)

    const driver = await dbService.getDriver(req.connectionId)
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
        for await (const rows of this.iterateRows(driver, req, schema.columns, schema.primaryKey)) {
          if (rows.length === 0) continue
          rowsExported += rows.length
          await appendFile(
            filePath,
            `${driver.dialect.renderInsert(req.database, req.table, schema.columns, rows)}\n`,
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
    driver: DbDriver,
    req: ExportTableRequest,
    columns: ColumnInfo[],
    primaryKey: string[]
  ): AsyncGenerator<Record<string, unknown>[]> {
    const columnNames = columns.map((c) => c.name)
    const where = req.scope === 'all' ? undefined : req.where

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
