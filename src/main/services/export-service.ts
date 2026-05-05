import { open, type FileHandle } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, extname, join } from 'node:path'
import { schemaService } from './schema-service'
import { dbService } from './db-service'
import { sshService } from './ssh-service'
import { connectionStore } from '../store/connection-store'
import { showSaveDialog } from '../platform/electron-runtime'
import type { DbDriver } from './drivers/types'
import { mysqlDialect } from './drivers/mysql-dialect'
import { pgDialect, renderPgCreateTable } from './drivers/pg-dialect'
import type {
  ColumnInfo,
  DbEngine,
  ExportDatabaseBackend,
  ExportDatabaseRequest,
  ExportDatabaseResult,
  ExportSqlDialect,
  ExportTableRequest,
  ExportTableResult,
  TableSchema
} from '../../shared/types'

const EXPORT_BATCH_SIZE = 1000
const EXPORT_WRITE_BUFFER_BYTES = 512 * 1024

class BufferedExportWriter {
  private readonly chunks: string[] = []
  private bufferedBytes = 0

  constructor(private readonly fileHandle: FileHandle) {}

  async write(chunk: string): Promise<void> {
    if (!chunk) return
    this.chunks.push(chunk)
    this.bufferedBytes += Buffer.byteLength(chunk, 'utf8')
    if (this.bufferedBytes >= EXPORT_WRITE_BUFFER_BYTES) {
      await this.flush()
    }
  }

  async close(): Promise<void> {
    try {
      await this.flush()
    } finally {
      await this.fileHandle.close()
    }
  }

  private async flush(): Promise<void> {
    if (this.chunks.length === 0) return
    const combined = this.chunks.join('')
    this.chunks.length = 0
    this.bufferedBytes = 0
    await this.fileHandle.appendFile(combined, 'utf8')
  }
}

async function openExportWriter(filePath: string): Promise<BufferedExportWriter> {
  return new BufferedExportWriter(await open(filePath, 'w'))
}

interface ExportTargetOptions {
  filePath?: string
}

export class ExportService {
  async exportDatabase(
    req: ExportDatabaseRequest,
    options: ExportTargetOptions = {}
  ): Promise<ExportDatabaseResult> {
    this.validateDatabase(req)

    const driver = await dbService.getDriver(req.connectionId)
    const sqlDialect = resolveSqlDialect(req.sqlDialect, driver.engine)
    assertSqlDialectSupported(driver.engine, sqlDialect)
    const tables = await driver.listTables(req.database)
    const filePath = options.filePath
      ? normalizeExtension(options.filePath, 'sql')
      : await this.pickDatabaseFilePath(req, sqlDialect)
    if (!filePath) {
      return { canceled: true, tablesExported: 0, rowsExported: 0 }
    }

    const backend = resolveDatabaseExportBackend(req.backend)
    if (backend === 'mysqldump') {
      assertMySQLDumpSupported(driver.engine, sqlDialect)
      await this.exportDatabaseWithMySQLDump(req, filePath)
      return {
        canceled: false,
        filePath,
        tablesExported: tables.length,
        rowsExported: 0,
        backend,
        rowsCountAccurate: req.includeData === false
      }
    }

    if (backend === 'mysqldump-ssh') {
      assertMySQLDumpSupported(driver.engine, sqlDialect)
      await this.exportDatabaseWithMySQLDumpOverSSH(req, filePath)
      return {
        canceled: false,
        filePath,
        tablesExported: tables.length,
        rowsExported: 0,
        backend,
        rowsCountAccurate: req.includeData === false
      }
    }

    const writer = await openExportWriter(filePath)

    const includeCreateTable = req.includeCreateTable !== false
    const includeData = req.includeData !== false
    const targetDialect = getTargetDialect(driver, sqlDialect)
    let rowsExported = 0

    try {
      if (includeCreateTable) {
        const prelude = buildDatabasePrelude(req.database, sqlDialect)
        if (prelude) await writer.write(`${prelude}\n\n`)
      }

      for (const table of tables) {
        const schema = await schemaService.getTableSchema(req.connectionId, req.database, table)
        if (includeCreateTable) {
          await writer.write(
            `${buildCreateTableSQL(schema, req.database, driver, sqlDialect, { includeDatabasePrelude: false })}\n\n`
          )
        }
        if (includeData) {
          for await (const rows of this.iterateAllRows(driver, req.database, table, schema.columns, schema.primaryKey)) {
            if (rows.length === 0) continue
            rowsExported += rows.length
            await writer.write(`${targetDialect.renderInsert(req.database, table, schema.columns, rows)}\n`)
          }
        }
      }
    } finally {
      await writer.close()
    }

    return { canceled: false, filePath, tablesExported: tables.length, rowsExported }
  }

  async exportTable(req: ExportTableRequest, options: ExportTargetOptions = {}): Promise<ExportTableResult> {
    this.validate(req)

    const driver = await dbService.getDriver(req.connectionId)
    const schema = await schemaService.getTableSchema(req.connectionId, req.database, req.table)
    const sqlDialect = resolveSqlDialect(req.sqlDialect, driver.engine)
    assertSqlDialectSupported(driver.engine, sqlDialect)
    this.validateQueryOptions(req, schema.columns)
    const extension = req.format === 'sql' ? 'sql' : req.format
    const filePath = options.filePath
      ? normalizeExtension(options.filePath, extension)
      : await this.pickFilePath(req, sqlDialect)
    if (!filePath) {
      return { canceled: true, rowsExported: 0 }
    }

    const writer = await openExportWriter(filePath)

    let rowsExported = 0
    try {
      if (req.format === 'sql') {
        const includeCreateTable = req.includeCreateTable !== false
        const includeData = req.includeData !== false

        if (includeCreateTable) {
          await writer.write(`${buildCreateTableSQL(schema, req.database, driver, sqlDialect)}\n\n`)
        }
        if (includeData) {
          const targetDialect = getTargetDialect(driver, sqlDialect)
          for await (const rows of this.iterateRows(driver, req, schema.columns, schema.primaryKey)) {
            if (rows.length === 0) continue
            rowsExported += rows.length
            await writer.write(`${targetDialect.renderInsert(req.database, req.table, schema.columns, rows)}\n`)
          }
        }
      } else {
        const delimiter = req.format === 'csv' ? ',' : '\t'
        const includeHeaders = req.includeHeaders !== false

        if (includeHeaders) {
          await writer.write(
            `${schema.columns.map((column) => quoteDelimitedValue(column.name, delimiter)).join(delimiter)}\n`
          )
        }

        for await (const rows of this.iterateRows(driver, req, schema.columns, schema.primaryKey)) {
          if (rows.length === 0) continue
          rowsExported += rows.length
          await writer.write(`${buildDelimitedRows(schema.columns, rows, delimiter)}\n`)
        }
      }
    } finally {
      await writer.close()
    }

    return { canceled: false, filePath, rowsExported }
  }

  private validateDatabase(req: ExportDatabaseRequest): void {
    if (!req.connectionId) throw new Error('Connection is required')
    if (!req.database) throw new Error('Database is required')
    if (req.format !== 'sql') throw new Error('Database export only supports SQL')
    if (req.includeCreateTable === false && req.includeData === false) {
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
    if (
      req.backend !== undefined &&
      req.backend !== 'builtin' &&
      req.backend !== 'mysqldump' &&
      req.backend !== 'mysqldump-ssh'
    ) {
      throw new Error('Unsupported database export backend')
    }
  }

  private async exportDatabaseWithMySQLDump(req: ExportDatabaseRequest, filePath: string): Promise<void> {
    const conn = connectionStore.getFull(req.connectionId)
    if (!conn) throw new Error(`Connection ${req.connectionId} not found`)
    if (conn.engine !== 'mysql') throw new Error('mysqldump export only supports MySQL connections')

    const localPort = conn.useSSH ? await sshService.ensureTunnel(conn) : undefined
    const host = conn.useSSH ? '127.0.0.1' : conn.host
    const port = localPort ?? conn.port
    const args = buildMySQLDumpArgs(req, {
      host,
      port,
      username: conn.username,
      database: req.database,
      resultFile: filePath
    })
    const env = conn.password ? { ...process.env, MYSQL_PWD: conn.password } : process.env

    await new Promise<void>((resolve, reject) => {
      const child = spawn('mysqldump', args, {
        env,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })

      let stderr = ''
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.once('error', (error) => {
        const spawnError = error as NodeJS.ErrnoException
        if (spawnError.code === 'ENOENT') {
          reject(new Error('mysqldump is not installed or not in PATH. Install the MySQL client or switch the export backend to Built-in exporter.'))
          return
        }
        reject(error)
      })
      child.once('close', (code) => {
        if (code === 0) {
          resolve()
          return
        }
        reject(new Error(formatMySQLDumpError(stderr.trim(), code)))
      })
    })
  }

  private async exportDatabaseWithMySQLDumpOverSSH(req: ExportDatabaseRequest, filePath: string): Promise<void> {
    const conn = connectionStore.getFull(req.connectionId)
    if (!conn) throw new Error(`Connection ${req.connectionId} not found`)
    if (conn.engine !== 'mysql') throw new Error('mysqldump export only supports MySQL connections')
    if (!conn.useSSH) throw new Error('Remote mysqldump export requires an SSH connection')

    const args = buildMySQLDumpArgs(req, {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      database: req.database
    })
    const command = buildRemoteMySQLDumpCommand(args, conn.password)
    const fileHandle = await open(filePath, 'w')
    let stderr = ''

    try {
      await sshService.execCommand(conn, {
        command,
        onStdout: async (chunk) => {
          await fileHandle.appendFile(chunk)
        },
        onStderr: (chunk) => {
          stderr += chunk
        }
      })
    } catch (error) {
      const message = stderr.trim() || (error as Error).message
      throw new Error(formatMySQLDumpError(message, null, { source: 'ssh' }))
    } finally {
      await fileHandle.close()
    }
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
    const response = await showSaveDialog(options)
    if (response.canceled || !response.filePath) return null
    return normalizeExtension(response.filePath, extension)
  }

  private async pickDatabaseFilePath(req: ExportDatabaseRequest, sqlDialect: DbEngine): Promise<string | null> {
    const options = {
      title: `Export ${req.database}`,
      defaultPath: sanitizeFileName(`${req.database}.${sqlDialect}.sql`),
      filters: [
        { name: `${sqlDialect.toUpperCase()} SQL`, extensions: ['sql'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    }
    const response = await showSaveDialog(options)
    if (response.canceled || !response.filePath) return null
    return normalizeExtension(response.filePath, 'sql')
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

  private async *iterateAllRows(
    driver: DbDriver,
    database: string,
    table: string,
    columns: ColumnInfo[],
    primaryKey: string[]
  ): AsyncGenerator<Record<string, unknown>[]> {
    for await (const batch of driver.streamRows({
      database,
      table,
      columns: columns.map((column) => column.name),
      primaryKey,
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

function resolveDatabaseExportBackend(backend: ExportDatabaseBackend | undefined): ExportDatabaseBackend {
  return backend ?? 'builtin'
}

function assertSqlDialectSupported(sourceEngine: DbEngine, sqlDialect: DbEngine): void {
  if ((sourceEngine === 'mysql' || sourceEngine === 'postgres') && (sqlDialect === 'mysql' || sqlDialect === 'postgres')) return
  throw new Error(`Exporting ${sourceEngine} tables as ${sqlDialect} SQL is not supported`)
}

function assertMySQLDumpSupported(sourceEngine: DbEngine, sqlDialect: DbEngine): void {
  if (sourceEngine === 'mysql' && sqlDialect === 'mysql') return
  throw new Error('mysqldump export only supports MySQL to MySQL-compatible SQL')
}

function buildMySQLDumpArgs(
  req: ExportDatabaseRequest,
  options: { host: string; port: number; username: string; database: string; resultFile?: string }
): string[] {
  const includeCreateTable = req.includeCreateTable !== false
  const includeData = req.includeData !== false
  const args = [
    `--host=${options.host}`,
    `--port=${options.port}`,
    `--user=${options.username}`,
    '--protocol=tcp',
    '--single-transaction',
    '--quick',
    '--skip-lock-tables',
    '--skip-comments',
    '--skip-dump-date',
    '--skip-triggers',
    '--hex-blob',
    '--complete-insert'
  ]

  if (!includeCreateTable) args.push('--no-create-info')
  if (!includeData) args.push('--no-data')

  if (includeCreateTable) {
    args.push('--databases', options.database)
  } else {
    args.push(options.database)
  }

  if (options.resultFile) args.push(`--result-file=${options.resultFile}`)

  return args
}

function buildRemoteMySQLDumpCommand(args: string[], password?: string): string {
  const envPrefix = password ? `MYSQL_PWD=${shellEscape(password)} ` : ''
  return `${envPrefix}exec mysqldump ${args.map(shellEscape).join(' ')}`
}

function shellEscape(value: string): string {
  if (value.length === 0) return "''"
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function formatMySQLDumpError(
  stderr: string,
  exitCode: number | null,
  options: { source?: 'local' | 'ssh' } = {}
): string {
  const source = options.source ?? 'local'
  const toolName = source === 'ssh' ? 'Remote mysqldump' : 'mysqldump'

  if (!stderr) return `${toolName} exited with code ${exitCode ?? -1}`

  if (source === 'ssh' && /(?:^|\s)mysqldump:\s+not found|command not found/i.test(stderr)) {
    return `Remote mysqldump failed: mysqldump is not installed or not in PATH on the SSH server. Original error: ${stderr}`
  }

  // MySQL 9 client no longer ships mysql_native_password plugin, causing auth error 2059.
  if (/got error:\s*2059/i.test(stderr) && /authentication plugin\s+'mysql_native_password'\s+cannot be loaded/i.test(stderr)) {
    return [
      `${toolName} failed: mysql_native_password plugin cannot be loaded (error 2059).`,
      `This usually happens when using MySQL 9 client tools ${source === 'ssh' ? 'on the SSH server' : 'on this machine'} against a mysql_native_password account.`,
      'Fix options: 1) ALTER USER ... IDENTIFIED WITH caching_sha2_password; 2) install/use mysql-client 8.4 mysqldump; 3) switch export backend to Built-in exporter.',
      `Original error: ${stderr}`
    ].join(' ')
  }

  return stderr
}

function getTargetDialect(sourceDriver: DbDriver, sqlDialect: DbEngine) {
  if (sqlDialect === 'postgres') return pgDialect
  if (sqlDialect === 'mysql') return mysqlDialect
  return sourceDriver.dialect
}

export function buildCreateTableSQL(
  schema: TableSchema,
  database: string,
  sourceDriver: DbDriver,
  sqlDialect: DbEngine,
  options: { includeDatabasePrelude?: boolean } = {}
): string {
  const includeDatabasePrelude = options.includeDatabasePrelude !== false
  if (sqlDialect === 'postgres') {
    return ensureSemicolon(
      renderPgCreateTable(schema, database, {
        includeSchema: includeDatabasePrelude,
        sourceEngine: sourceDriver.engine
      })
    )
  }

  if (sqlDialect === 'mysql' && sourceDriver.engine === 'postgres') {
    return renderMySQLCreateTable(schema, database, { includeDatabasePrelude })
  }

  if (sqlDialect === 'mysql') {
    return ensureSemicolon(
      [
        includeDatabasePrelude ? `CREATE DATABASE IF NOT EXISTS ${mysqlDialect.quoteIdent(database)};` : '',
        qualifyMySQLCreateTable(sourceDriver.dialect.stripDefiner(schema.createSQL), database, schema.name)
      ].filter(Boolean).join('\n')
    )
  }

  return ensureSemicolon(sourceDriver.dialect.stripDefiner(schema.createSQL))
}

function renderMySQLCreateTable(
  schema: TableSchema,
  database: string,
  options: { includeDatabasePrelude?: boolean } = {}
): string {
  const includeDatabasePrelude = options.includeDatabasePrelude !== false
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
    includeDatabasePrelude ? `CREATE DATABASE IF NOT EXISTS ${mysqlDialect.quoteIdent(database)};` : '',
    `CREATE TABLE ${mysqlDialect.quoteTable(database, schema.name)} (`,
    [...columnLines, ...primaryKey].join(',\n'),
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
  ].filter(Boolean).join('\n'))
}

function buildDatabasePrelude(database: string, sqlDialect: DbEngine): string {
  if (sqlDialect === 'mysql') {
    return `CREATE DATABASE IF NOT EXISTS ${mysqlDialect.quoteIdent(database)};`
  }
  if (sqlDialect === 'postgres') {
    return `CREATE SCHEMA IF NOT EXISTS ${pgDialect.quoteIdent(database)};`
  }
  return ''
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
