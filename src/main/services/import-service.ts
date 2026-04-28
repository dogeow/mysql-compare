import { readFile } from 'node:fs/promises'
import { BrowserWindow, dialog, type FileFilter, type OpenDialogOptions } from 'electron'
import type {
  ColumnInfo,
  ImportFormat,
  ImportTableRequest,
  ImportTableResult,
  TableSchema
} from '../../shared/types'
import { dbService } from './db-service'
import type { DbDriver } from './drivers/types'
import { schemaService } from './schema-service'

type ImportRowValue = string | null

interface DelimitedImportPlan {
  columns: ColumnInfo[]
  rows: string[][]
}

interface PreparedDelimitedRow {
  values: Record<string, ImportRowValue>
}

interface ImportFileSource {
  content?: string
  label: string
  path?: string
}

export class ImportService {
  async importTable(req: ImportTableRequest): Promise<ImportTableResult> {
    validateRequest(req)

    const driver = await dbService.getDriver(req.connectionId)
    const file = await resolveImportFile(req)
    if (!file) {
      return { canceled: true, rowsImported: 0, statementsExecuted: 0 }
    }

    if (req.format === 'sql' && !(await confirmSQLImport(file.label, req.database))) {
      return { canceled: true, rowsImported: 0, statementsExecuted: 0 }
    }

    const content = stripBom(file.content ?? (await readFile(file.path!, 'utf8')))
    if (req.format === 'sql') {
      return importSQL(driver, req, file.label, content)
    }

    const schema = await schemaService.getTableSchema(req.connectionId, req.database, req.table)
    return importDelimited(driver, req, file.label, content, schema)
  }
}

async function resolveImportFile(req: ImportTableRequest): Promise<ImportFileSource | undefined> {
  if (req.fileContent !== undefined) {
    return {
      content: req.fileContent,
      label: req.fileName?.trim() || 'selected file'
    }
  }

  const path = await pickFilePath(req.format)
  return path ? { path, label: path } : undefined
}

async function importSQL(
  driver: DbDriver,
  req: ImportTableRequest,
  filePath: string,
  content: string
): Promise<ImportTableResult> {
  const sql = content.trim()
  if (!sql) throw new Error('Import file is empty')

  await driver.executeSQL(sql, req.database)
  return {
    canceled: false,
    filePath,
    rowsImported: 0,
    statementsExecuted: countSqlStatements(sql)
  }
}

async function importDelimited(
  driver: DbDriver,
  req: ImportTableRequest,
  filePath: string,
  content: string,
  schema: TableSchema
): Promise<ImportTableResult> {
  const delimiter = req.format === 'txt' ? '\t' : ','
  const parsedRows = parseDelimited(content, delimiter).filter((row) => !isEmptyRow(row))
  if (parsedRows.length === 0) throw new Error('Import file is empty')

  const plan = buildDelimitedImportPlan(parsedRows, schema, req.includeHeaders !== false)
  const preparedRows = prepareDelimitedRows(req, plan)
  const rowsImported = await executeDelimitedRows(driver, req, plan.columns, preparedRows)

  return {
    canceled: false,
    filePath,
    rowsImported,
    statementsExecuted: rowsImported
  }
}

async function pickFilePath(format: ImportFormat): Promise<string | undefined> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: OpenDialogOptions = {
    title: 'Import Table',
    properties: ['openFile'],
    filters: [getFileFilter(format), { name: 'All Files', extensions: ['*'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)

  return result.canceled ? undefined : result.filePaths[0]
}

async function confirmSQLImport(filePath: string, database: string): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    type: 'warning' as const,
    buttons: ['Import', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Confirm SQL Import',
    message: `Execute this SQL file against ${database}?`,
    detail: filePath
  }
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return result.response === 0
}

function getFileFilter(format: ImportFormat): FileFilter {
  switch (format) {
    case 'sql':
      return { name: 'SQL Files', extensions: ['sql'] }
    case 'csv':
      return { name: 'CSV Files', extensions: ['csv'] }
    case 'txt':
      return { name: 'Text Files', extensions: ['txt', 'tsv'] }
  }
}

function validateRequest(req: ImportTableRequest): void {
  if (!req.connectionId) throw new Error('Connection is required')
  if (!req.database) throw new Error('Database is required')
  if (!req.table) throw new Error('Table is required')
  if (!['sql', 'csv', 'txt'].includes(req.format)) throw new Error('Unsupported import format')
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
}

function buildDelimitedImportPlan(
  rows: string[][],
  schema: TableSchema,
  includeHeaders: boolean
): DelimitedImportPlan {
  if (schema.columns.length === 0) throw new Error('Target table has no columns')

  if (!includeHeaders) {
    return { columns: schema.columns, rows }
  }

  const [headerRow, ...dataRows] = rows
  if (!headerRow) throw new Error('Header row is required')

  const columns = resolveHeaderColumns(headerRow, schema)
  return { columns, rows: dataRows }
}

function resolveHeaderColumns(headerRow: string[], schema: TableSchema): ColumnInfo[] {
  const schemaColumns = new Map(schema.columns.map((column) => [column.name, column]))
  const seen = new Set<string>()

  return headerRow.map((rawName) => {
    const name = rawName.trim()
    if (!name) throw new Error('Header row contains an empty column name')
    if (seen.has(name)) throw new Error(`Duplicate import column "${name}"`)
    seen.add(name)

    const column = schemaColumns.get(name)
    if (!column) throw new Error(`Column "${name}" does not exist in target table`)
    return column
  })
}

function prepareDelimitedRows(
  req: ImportTableRequest,
  plan: DelimitedImportPlan
): PreparedDelimitedRow[] {
  const emptyAsNull = req.emptyAsNull !== false
  const lineOffset = req.includeHeaders === false ? 1 : 2

  return plan.rows.reduce<PreparedDelimitedRow[]>((preparedRows, row, index) => {
    const values = buildRowValues(row, plan.columns, emptyAsNull, index + lineOffset)
    if (!values) return preparedRows
    return [...preparedRows, { values }]
  }, [])
}

async function executeDelimitedRows(
  driver: DbDriver,
  req: ImportTableRequest,
  columns: ColumnInfo[],
  rows: PreparedDelimitedRow[]
): Promise<number> {
  if (rows.length === 0) return 0

  const tableScope = driver.engine === 'postgres' ? 'public' : req.database
  const inserts = rows.map((row) => {
    const insertColumns = columns.filter((column) => Object.prototype.hasOwnProperty.call(row.values, column.name))
    if (insertColumns.length === 0) throw new Error('No values to insert')
    return driver.dialect.renderInsert(tableScope, req.table, insertColumns, [row.values])
  })
  const transactionSQL = renderTransactionSQL(driver.engine, inserts)
  await driver.executeSQL(transactionSQL, req.database)

  return rows.length
}

function renderTransactionSQL(engine: DbDriver['engine'], statements: string[]): string {
  const begin = engine === 'postgres' ? 'BEGIN;' : 'START TRANSACTION;'
  return [begin, ...statements, 'COMMIT;'].join('\n')
}

function buildRowValues(
  row: string[],
  columns: ColumnInfo[],
  emptyAsNull: boolean,
  lineNumber: number
): Record<string, ImportRowValue> | null {
  if (row.length < columns.length) {
    throw new Error(`Line ${lineNumber} has fewer cells than import columns`)
  }
  if (row.length > columns.length) {
    throw new Error(`Line ${lineNumber} has more cells than import columns`)
  }
  if (isEmptyRow(row)) return null

  const values = columns.reduce<Record<string, ImportRowValue>>((current, column, index) => {
    const rawValue = row[index] ?? ''
    const value = rawValue === '' && emptyAsNull ? null : rawValue
    if (column.isAutoIncrement && value === null) return current
    return { ...current, [column.name]: value }
  }, {})

  return Object.keys(values).length > 0 ? values : null
}

function parseDelimited(content: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < content.length; index++) {
    const char = content[index] ?? ''
    const next = content[index + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"'
        index++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\r' || char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (char === '\r' && next === '\n') index++
    } else {
      field += char
    }
  }

  if (inQuotes) throw new Error('Import file contains an unterminated quoted field')
  row.push(field)
  if (!isEmptyRow(row) || content.endsWith(delimiter)) rows.push(row)
  return rows
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}

function countSqlStatements(sql: string): number {
  let statements = 0
  let hasContent = false
  let quote: string | null = null
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index] ?? ''
    const next = sql[index + 1]

    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index++
      }
      continue
    }
    if (quote) {
      if (char === quote && next === quote && quote !== '`') {
        index++
      } else if (char === quote && sql[index - 1] !== '\\') {
        quote = null
      }
      continue
    }
    if (char === '-' && next === '-') {
      lineComment = true
      index++
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index++
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      hasContent = true
      continue
    }
    if (char === ';') {
      if (hasContent) statements++
      hasContent = false
      continue
    }
    if (!/\s/.test(char)) hasContent = true
  }

  return hasContent ? statements + 1 : statements
}

export const importService = new ImportService()
