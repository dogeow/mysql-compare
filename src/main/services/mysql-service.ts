// MySQL 连接池管理 + 通用查询/写入。每个 connectionId 维护一个 mysql2 Pool。
import { randomUUID } from 'node:crypto'
import mysql, { Pool, PoolOptions, RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type {
  ConnectionConfig,
  CopyTableRequest,
  DropTableRequest,
  RenameTableRequest
} from '../../shared/types'
import { connectionStore } from '../store/connection-store'
import { sshService } from './ssh-service'

const MAX_PAGE_SIZE = 1000

interface PoolEntry {
  pool: Pool
  /** 上次绑定的本地端口（SSH 时） */
  localPort?: number
}

class MySQLService {
  private pools = new Map<string, PoolEntry>()
  private pendingPools = new Map<string, Promise<PoolEntry>>()

  constructor() {
    sshService.onTunnelClosed((connectionId) => {
      const entry = this.pools.get(connectionId)
      if (!entry || entry.localPort === undefined) return
      this.pools.delete(connectionId)
      entry.pool.end().catch(() => undefined)
    })
  }

  private buildTestConnection(conn: ConnectionConfig): ConnectionConfig {
    return {
      ...conn,
      id: `${conn.id || 'connection'}::test::${randomUUID()}`
    }
  }

  /** 获取（必要时建立）连接池 */
  async getPool(connectionId: string, database?: string): Promise<Pool> {
    const conn = connectionStore.getFull(connectionId)
    if (!conn) throw new Error(`Connection ${connectionId} not found`)

    let activeLocalPort: number | undefined
    if (conn.useSSH) {
      activeLocalPort = await sshService.ensureTunnel(conn)
    }

    const cached = this.pools.get(connectionId)
    if (cached && cached.localPort === activeLocalPort) {
      if (database) await cached.pool.query(`USE ${quoteIdent(database)}`)
      return cached.pool
    }

    const pending = this.pendingPools.get(connectionId)
    if (pending) {
      const entry = await pending
      if (database) await entry.pool.query(`USE ${quoteIdent(database)}`)
      return entry.pool
    }

    if (cached) {
      this.pools.delete(connectionId)
      await cached.pool.end().catch(() => undefined)
    }

    const creation = this.createPoolEntry(conn, database, activeLocalPort)
    this.pendingPools.set(connectionId, creation)
    try {
      const entry = await creation
      if (database) await entry.pool.query(`USE ${quoteIdent(database)}`)
      return entry.pool
    } finally {
      this.pendingPools.delete(connectionId)
    }
  }

  /** 直接基于一个临时 ConnectionConfig 测试连接（不入池） */
  async testConnection(conn: ConnectionConfig): Promise<string> {
    const testConn = this.buildTestConnection(conn)
    const opts = await this.buildPoolOptions(testConn)
    const tmp = mysql.createPool({ ...opts, connectionLimit: 1 })
    try {
      const [rows] = await tmp.query<RowDataPacket[]>('SELECT VERSION() AS v')
      return `OK · MySQL ${rows[0]?.['v']}`
    } finally {
      await tmp.end()
      if (testConn.useSSH) await sshService.close(testConn.id)
    }
  }

  private async createPool(conn: ConnectionConfig, database?: string): Promise<Pool> {
    const opts = await this.buildPoolOptions(conn, database)
    return mysql.createPool(opts)
  }

  private async createPoolEntry(
    conn: ConnectionConfig,
    database: string | undefined,
    localPort: number | undefined
  ): Promise<PoolEntry> {
    const pool = await this.createPool(conn, database)
    const entry = { pool, localPort }
    this.pools.set(conn.id, entry)
    return entry
  }

  private async buildPoolOptions(
    conn: ConnectionConfig,
    database?: string
  ): Promise<PoolOptions> {
    let host = conn.host
    let port = conn.port
    if (conn.useSSH) {
      const localPort = await sshService.ensureTunnel(conn)
      host = '127.0.0.1'
      port = localPort
    }
    return {
      host,
      port,
      user: conn.username,
      password: conn.password,
      database: database || conn.database,
      connectionLimit: 5,
      waitForConnections: true,
      multipleStatements: false,
      dateStrings: true
    }
  }

  private async tableExists(connectionId: string, database: string, table: string): Promise<boolean> {
    const pool = await this.getPool(connectionId, database)
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 AS present
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       LIMIT 1`,
      [database, table]
    )
    return rows.length > 0
  }

  private async assertSourceExists(connectionId: string, database: string, table: string): Promise<void> {
    if (!(await this.tableExists(connectionId, database, table))) {
      throw new Error(`Table "${table}" not found`)
    }
  }

  private async assertTargetAbsent(connectionId: string, database: string, table: string): Promise<void> {
    if (await this.tableExists(connectionId, database, table)) {
      throw new Error(`Table "${table}" already exists`)
    }
  }

  // ---------- 浏览 ----------
  async listDatabases(connectionId: string): Promise<string[]> {
    const pool = await this.getPool(connectionId)
    const [rows] = await pool.query<RowDataPacket[]>('SHOW DATABASES')
    return rows
      .map((r) => Object.values(r)[0] as string)
      .filter((d) => !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(d))
      .concat([])
  }

  async listTables(connectionId: string, database: string): Promise<string[]> {
    const pool = await this.getPool(connectionId, database)
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [database]
    )
    return rows.map((r) => r['TABLE_NAME'] as string)
  }

  // ---------- 查询行 ----------
  async queryRows(req: {
    connectionId: string
    database: string
    table: string
    page: number
    pageSize: number
    orderBy?: { column: string; dir: 'ASC' | 'DESC' }
    where?: string
  }) {
    const { connectionId, database, table, page, pageSize, orderBy, where } = req
    assertNonEmptySQL(sqlFragmentLabel('database'), database)
    assertNonEmptySQL(sqlFragmentLabel('table'), table)
    assertSafeWhereClause(where)
    const pool = await this.getPool(connectionId, database)
    const safeTable = quoteTable(database, table)
    const whereClause = where && where.trim() ? `WHERE ${where}` : ''
    const orderClause = orderBy
      ? `ORDER BY ${quoteIdent(orderBy.column)} ${orderBy.dir}`
      : ''
    const offset = Math.max(0, (page - 1) * pageSize)
    const limit = Math.max(1, Math.min(pageSize, MAX_PAGE_SIZE))

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM ${safeTable} ${whereClause} ${orderClause} LIMIT ${limit} OFFSET ${offset}`
    )
    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM ${safeTable} ${whereClause}`
    )
    return {
      rows: rows as Record<string, unknown>[],
      total: Number(countRows[0]?.['c'] ?? 0)
    }
  }

  // ---------- 写入 ----------
  async insertRow(req: {
    connectionId: string
    database: string
    table: string
    values: Record<string, unknown>
  }): Promise<{ insertId: number | string; affectedRows: number }> {
    const pool = await this.getPool(connectionId(req), req.database)
    const cols = Object.keys(req.values)
    if (cols.length === 0) throw new Error('No values to insert')
    assertNonEmptySQL(sqlFragmentLabel('table'), req.table)
    assertColumns(cols, 'insert')
    const placeholders = cols.map(() => '?').join(', ')
    const sql = `INSERT INTO ${quoteTable(req.database, req.table)}
      (${cols.map((c) => quoteIdent(c)).join(', ')})
      VALUES (${placeholders})`
    const [res] = await pool.execute<ResultSetHeader>(sql, cols.map((c) => req.values[c]))
    return { insertId: res.insertId, affectedRows: res.affectedRows }
  }

  async updateRow(req: {
    connectionId: string
    database: string
    table: string
    pkValues: Record<string, unknown>
    changes: Record<string, unknown>
  }): Promise<{ affectedRows: number }> {
    const pkCols = Object.keys(req.pkValues)
    if (pkCols.length === 0) throw new Error('Refusing to UPDATE without primary key')
    const setCols = Object.keys(req.changes)
    if (setCols.length === 0) return { affectedRows: 0 }
    assertNonEmptySQL(sqlFragmentLabel('table'), req.table)
    assertColumns(pkCols, 'primary key')
    assertColumns(setCols, 'update')

    const pool = await this.getPool(connectionId(req), req.database)
    const setClause = setCols.map((c) => `${quoteIdent(c)} = ?`).join(', ')
    const whereClause = pkCols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
    const sql = `UPDATE ${quoteTable(req.database, req.table)} SET ${setClause} WHERE ${whereClause} LIMIT 1`
    const params = [
      ...setCols.map((c) => req.changes[c]),
      ...pkCols.map((c) => req.pkValues[c])
    ]
    const [res] = await pool.execute<ResultSetHeader>(sql, params)
    return { affectedRows: res.affectedRows }
  }

  async deleteRows(req: {
    connectionId: string
    database: string
    table: string
    pkRows: Record<string, unknown>[]
  }): Promise<{ affectedRows: number }> {
    if (req.pkRows.length === 0) return { affectedRows: 0 }
    assertNonEmptySQL(sqlFragmentLabel('table'), req.table)
    const pool = await this.getPool(connectionId(req), req.database)
    const conn = await pool.getConnection()
    const tableName = quoteTable(req.database, req.table)
    try {
      await conn.beginTransaction()
      let affected = 0
      for (const row of req.pkRows) {
        const cols = Object.keys(row)
        if (cols.length === 0) throw new Error('Refusing to DELETE without primary key')
        assertColumns(cols, 'primary key')
        const where = cols.map((c) => `${quoteIdent(c)} = ?`).join(' AND ')
        const [res] = await conn.execute<ResultSetHeader>(
          `DELETE FROM ${tableName} WHERE ${where} LIMIT 1`,
          cols.map((c) => row[c])
        )
        affected += res.affectedRows
      }
      await conn.commit()
      return { affectedRows: affected }
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  }

  async renameTable(req: RenameTableRequest): Promise<{ table: string }> {
    const nextName = req.newTable.trim()
    if (!nextName) throw new Error('New table name is required')
    if (nextName === req.table) return { table: req.table }
    await this.assertSourceExists(req.connectionId, req.database, req.table)
    await this.assertTargetAbsent(req.connectionId, req.database, nextName)

    const pool = await this.getPool(req.connectionId, req.database)
    await pool.query(
      `RENAME TABLE ${quoteTable(req.database, req.table)} TO ${quoteTable(req.database, nextName)}`
    )
    return { table: nextName }
  }

  async copyTable(req: CopyTableRequest): Promise<{ table: string }> {
    const targetTable = req.targetTable.trim()
    if (!targetTable) throw new Error('Target table name is required')
    if (targetTable === req.table) throw new Error('Target table name must be different')
    await this.assertSourceExists(req.connectionId, req.database, req.table)
    await this.assertTargetAbsent(req.connectionId, req.database, targetTable)

    const pool = await this.getPool(req.connectionId, req.database)
    const sourceName = quoteTable(req.database, req.table)
    const nextName = quoteTable(req.database, targetTable)
    let created = false
    try {
      await pool.query(`CREATE TABLE ${nextName} LIKE ${sourceName}`)
      created = true
      await pool.query(`INSERT INTO ${nextName} SELECT * FROM ${sourceName}`)
      return { table: targetTable }
    } catch (err) {
      if (created) {
        await pool.query(`DROP TABLE ${nextName}`).catch(() => undefined)
      }
      throw err
    }
  }

  async dropTable(req: DropTableRequest): Promise<void> {
    await this.assertSourceExists(req.connectionId, req.database, req.table)
    const pool = await this.getPool(req.connectionId, req.database)
    await pool.query(`DROP TABLE ${quoteTable(req.database, req.table)}`)
  }

  /** 直接执行 SQL（用于同步等高级操作） */
  async executeSQL(connectionId: string, sql: string, database?: string): Promise<unknown> {
    if (!sql.trim()) throw new Error('SQL is required')
    const conn = connectionStore.getFull(connectionId)
    if (!conn) throw new Error(`Connection ${connectionId} not found`)
    const opts = await this.buildPoolOptions(conn, database)
    const client = await mysql.createConnection({ ...opts, multipleStatements: true })
    try {
      const [res] = await client.query(sql)
      return res
    } finally {
      await client.end()
    }
  }

  async closeAll(): Promise<void> {
    const entries = Array.from(this.pools.values())
    this.pools.clear()
    this.pendingPools.clear()
    await Promise.all(entries.map((e) => e.pool.end().catch(() => undefined)))
  }

  async closeConnection(connectionId: string): Promise<void> {
    this.pendingPools.delete(connectionId)
    const entry = this.pools.get(connectionId)
    if (entry) {
      this.pools.delete(connectionId)
      await entry.pool.end().catch(() => undefined)
    }
    await sshService.close(connectionId)
  }
}

function escapeIdent(name: string): string {
  return name.replace(/`/g, '``')
}

function quoteIdent(name: string): string {
  return `\`${escapeIdent(name)}\``
}

function quoteTable(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`
}

function assertColumns(columns: string[], label: string): void {
  for (const column of columns) {
    assertNonEmptySQL(`${label} column`, column)
  }
}

function assertSafeWhereClause(where?: string): void {
  if (!where?.trim()) return
  const trimmed = where.trim()
  if (trimmed.includes(';')) {
    throw new Error('WHERE clause must not contain semicolons')
  }
  if (/--|\/\*/.test(trimmed)) {
    throw new Error('WHERE clause must not contain SQL comments')
  }
}

function assertNonEmptySQL(label: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required`)
  }
}

function sqlFragmentLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function connectionId(req: { connectionId: string }): string {
  return req.connectionId
}

export const mysqlService = new MySQLService()
