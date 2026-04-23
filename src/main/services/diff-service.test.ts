import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableSchema } from '../../shared/types'
import type { DbDriver, Dialect } from './drivers/types'

const { getDriver } = vi.hoisted(() => ({
  getDriver: vi.fn()
}))

vi.mock('./db-service', () => ({
  dbService: {
    getDriver
  }
}))

import { diffService } from './diff-service'

const fakeDialect: Dialect = {
  engine: 'mysql',
  quoteIdent: (name) => `\`${name}\``,
  quoteTable: (database, table) => `\`${database}\`.\`${table}\``,
  formatLiteral: (value) => JSON.stringify(value),
  renderInsert: () => '',
  renderTruncate: () => '',
  renderDropIfExists: () => '',
  stripDefiner: (sql) => sql
}

describe('DiffService', () => {
  beforeEach(() => {
    getDriver.mockReset()
  })

  it('returns source-only and target-only tables without loading schemas', async () => {
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['only_source'] }
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['only_target'] }
    })

    getDriver.mockImplementation(async (connectionId: string) => {
      return connectionId === 'source-conn' ? sourceDriver.driver : targetDriver.driver
    })

    const diff = await diffService.diffDatabases('source-conn', 'source_db', 'target-conn', 'target_db')

    expect(diff.tableDiffs).toEqual([
      { table: 'only_source', kind: 'only-in-source', columnDiffs: [], indexDiffs: [] },
      { table: 'only_target', kind: 'only-in-target', columnDiffs: [], indexDiffs: [] }
    ])
    expect(sourceDriver.getTableSchema).not.toHaveBeenCalled()
    expect(targetDriver.getTableSchema).not.toHaveBeenCalled()
  })

  it('returns modified diffs for changed shared tables', async () => {
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['shared'] },
      schemas: {
        'source_db.shared': buildSchema('shared', {
          columns: [
            { name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true },
            { name: 'name', type: 'varchar(64)', nullable: false }
          ],
          indexes: [
            { name: 'PRIMARY', columns: ['id'], unique: true, type: 'BTREE' },
            { name: 'idx_name', columns: ['name'], unique: false, type: 'BTREE' }
          ]
        })
      }
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['shared'] },
      schemas: {
        'target_db.shared': buildSchema('shared', {
          columns: [
            { name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true },
            { name: 'name', type: 'varchar(128)', nullable: false }
          ],
          indexes: [{ name: 'PRIMARY', columns: ['id'], unique: true, type: 'BTREE' }]
        })
      }
    })

    getDriver.mockImplementation(async (connectionId: string) => {
      return connectionId === 'source-conn' ? sourceDriver.driver : targetDriver.driver
    })

    const diff = await diffService.diffDatabases('source-conn', 'source_db', 'target-conn', 'target_db')

    expect(diff.tableDiffs).toHaveLength(1)
    expect(diff.tableDiffs[0]).toMatchObject({
      table: 'shared',
      kind: 'modified'
    })
    expect(diff.tableDiffs[0]?.columnDiffs).toHaveLength(1)
    expect(diff.tableDiffs[0]?.indexDiffs).toHaveLength(1)
  })

  it('filters out shared tables when schemas are identical', async () => {
    const sharedSchema = buildSchema('shared', {
      columns: [
        { name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true },
        { name: 'title', type: 'varchar(255)', nullable: false }
      ],
      indexes: [
        { name: 'PRIMARY', columns: ['id'], unique: true, type: 'BTREE' },
        { name: 'idx_title', columns: ['title'], unique: false, type: 'BTREE' }
      ]
    })

    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['shared'] },
      schemas: { 'source_db.shared': sharedSchema }
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['shared'] },
      schemas: { 'target_db.shared': sharedSchema }
    })

    getDriver.mockImplementation(async (connectionId: string) => {
      return connectionId === 'source-conn' ? sourceDriver.driver : targetDriver.driver
    })

    const diff = await diffService.diffDatabases('source-conn', 'source_db', 'target-conn', 'target_db')

    expect(diff.tableDiffs).toEqual([])
  })

  it('treats common Laravel MySQL/PostgreSQL type mappings as compatible', async () => {
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      engine: 'mysql',
      tablesByDatabase: { source_db: ['users'] },
      schemas: {
        'source_db.users': buildSchema('users', {
          columns: [
            {
              name: 'id',
              type: 'bigint unsigned',
              nullable: false,
              isPrimaryKey: true,
              isAutoIncrement: true
            },
            {
              name: 'email',
              type: 'varchar(255)',
              nullable: false,
              defaultValue: "'guest@example.com'"
            },
            { name: 'bio', type: 'longtext', nullable: true },
            { name: 'avatar', type: 'longblob', nullable: true },
            { name: 'price', type: 'decimal(10,2)', nullable: false, defaultValue: '0.00' },
            { name: 'is_active', type: 'tinyint(1)', nullable: false, defaultValue: '1' },
            { name: 'created_at', type: 'timestamp', nullable: true },
            { name: 'published_at', type: 'datetime(0)', nullable: true },
            { name: 'publish_time', type: 'time(0)', nullable: true }
          ]
        })
      }
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      engine: 'postgres',
      tablesByDatabase: { target_db: ['users'] },
      schemas: {
        'target_db.users': buildSchema('users', {
          columns: [
            {
              name: 'id',
              type: 'bigint',
              nullable: false,
              isPrimaryKey: true,
              isAutoIncrement: true
            },
            {
              name: 'email',
              type: 'character varying(255)',
              nullable: false,
              defaultValue: "'guest@example.com'::character varying"
            },
            { name: 'bio', type: 'text', nullable: true },
            { name: 'avatar', type: 'bytea', nullable: true },
            { name: 'price', type: 'numeric(10,2)', nullable: false, defaultValue: '0.00' },
            { name: 'is_active', type: 'boolean', nullable: false, defaultValue: 'true' },
            { name: 'created_at', type: 'timestamp without time zone', nullable: true },
            { name: 'published_at', type: 'timestamp(0) without time zone', nullable: true },
            { name: 'publish_time', type: 'time(0) without time zone', nullable: true }
          ]
        })
      }
    })

    getDriver.mockImplementation(async (connectionId: string) => {
      return connectionId === 'source-conn' ? sourceDriver.driver : targetDriver.driver
    })

    const diff = await diffService.diffDatabases('source-conn', 'source_db', 'target-conn', 'target_db')

    expect(diff.tableDiffs).toEqual([])
  })

  it('treats json/jsonb, enum/string, and current timestamp precision zero as compatible across engines', async () => {
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      engine: 'mysql',
      tablesByDatabase: { source_db: ['settings'] },
      schemas: {
        'source_db.settings': buildSchema('settings', {
          columns: [
            { name: 'options', type: 'json', nullable: false },
            {
              name: 'status',
              type: "enum('draft','published')",
              nullable: false,
              defaultValue: "'draft'"
            },
            {
              name: 'updated_at',
              type: 'timestamp',
              nullable: false,
              defaultValue: 'CURRENT_TIMESTAMP'
            }
          ]
        })
      }
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      engine: 'postgres',
      tablesByDatabase: { target_db: ['settings'] },
      schemas: {
        'target_db.settings': buildSchema('settings', {
          columns: [
            { name: 'options', type: 'jsonb', nullable: false },
            {
              name: 'status',
              type: 'character varying(255)',
              nullable: false,
              defaultValue: "'draft'::character varying"
            },
            {
              name: 'updated_at',
              type: 'timestamp without time zone',
              nullable: false,
              defaultValue: 'CURRENT_TIMESTAMP(0)'
            }
          ]
        })
      }
    })

    getDriver.mockImplementation(async (connectionId: string) => {
      return connectionId === 'source-conn' ? sourceDriver.driver : targetDriver.driver
    })

    const diff = await diffService.diffDatabases(
      'source-conn',
      'source_db',
      'target-conn',
      'target_db'
    )

    expect(diff.tableDiffs).toEqual([])
  })

  it('allows concurrent schema reads when both sides share the same MySQL driver', async () => {
    const schemas: Record<string, TableSchema> = {
      'source_db.shared_a': buildSchema('shared_a'),
      'target_db.shared_a': buildSchema('shared_a', {
        columns: [{ name: 'value', type: 'varchar(255)' }]
      }),
      'source_db.shared_b': buildSchema('shared_b'),
      'target_db.shared_b': buildSchema('shared_b', {
        columns: [{ name: 'note', type: 'varchar(255)' }]
      })
    }
    let activeReads = 0
    let maxConcurrentReads = 0

    const sharedDriver = createFakeDriver({
      connectionId: 'shared',
      engine: 'mysql',
      tablesByDatabase: {
        source_db: ['shared_a', 'shared_b'],
        target_db: ['shared_a', 'shared_b']
      },
      schemaImpl: async (database, table) => {
        activeReads += 1
        maxConcurrentReads = Math.max(maxConcurrentReads, activeReads)
        await Promise.resolve()
        activeReads -= 1

        const schema = schemas[`${database}.${table}`]
        if (!schema) throw new Error(`Missing schema for ${database}.${table}`)
        return schema
      }
    })

    getDriver.mockResolvedValue(sharedDriver.driver)

    const diff = await diffService.diffDatabases('same-conn', 'source_db', 'same-conn', 'target_db')

    expect(diff.tableDiffs.map((tableDiff) => tableDiff.table)).toEqual(['shared_a', 'shared_b'])
    expect(maxConcurrentReads).toBeGreaterThan(1)
    expect(getDriver).toHaveBeenCalledTimes(2)
  })

  it('returns row-level diffs for shared tables when data comparison is enabled', async () => {
    const sharedSchema = buildSchema('shared', {
      columns: [
        { name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true },
        { name: 'name', type: 'varchar(255)', nullable: false }
      ]
    })
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['shared'] },
      schemas: { 'source_db.shared': sharedSchema },
      streamRowsByTable: {
        'source_db.shared': [[{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]]
      }
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['shared'] },
      schemas: { 'target_db.shared': sharedSchema },
      streamRowsByTable: {
        'target_db.shared': [[{ id: 1, name: 'Alice' }, { id: 2, name: 'Robert' }, { id: 3, name: 'Carol' }]]
      }
    })

    getDriver.mockImplementation(async (connectionId: string) => {
      return connectionId === 'source-conn' ? sourceDriver.driver : targetDriver.driver
    })

    const diff = await diffService.diffDatabases(
      'source-conn',
      'source_db',
      'target-conn',
      'target_db',
      true
    )

    expect(diff.tableDiffs).toHaveLength(1)
    expect(diff.tableDiffs[0]).toMatchObject({
      table: 'shared',
      kind: 'modified',
      columnDiffs: [],
      indexDiffs: [],
      dataDiff: {
        comparable: true,
        keyColumns: ['id'],
        sourceRowCount: 2,
        targetRowCount: 3,
        sourceOnly: 0,
        targetOnly: 1,
        modified: 1,
        identical: 1
      }
    })
    expect(diff.tableDiffs[0]?.dataDiff?.samples).toEqual([
      {
        kind: 'modified',
        key: 'id=2',
        source: { id: 2, name: 'Bob' },
        target: { id: 2, name: 'Robert' }
      },
      {
        kind: 'only-in-target',
        key: 'id=3',
        target: { id: 3, name: 'Carol' }
      }
    ])
    expect(diff.rowComparisons).toHaveLength(1)
    expect(diff.rowComparisons[0]?.table).toBe('shared')
  })

  it('returns row comparison results even when rows are identical', async () => {
    const sharedSchema = buildSchema('shared', {
      columns: [
        { name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true },
        { name: 'name', type: 'varchar(255)', nullable: false }
      ]
    })
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['shared'] },
      schemas: { 'source_db.shared': sharedSchema },
      streamRowsByTable: {
        'source_db.shared': [[{ id: 1, name: 'Alice' }]]
      }
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['shared'] },
      schemas: { 'target_db.shared': sharedSchema },
      streamRowsByTable: {
        'target_db.shared': [[{ id: 1, name: 'Alice' }]]
      }
    })

    getDriver.mockImplementation(async (connectionId: string) => {
      return connectionId === 'source-conn' ? sourceDriver.driver : targetDriver.driver
    })

    const diff = await diffService.diffDatabases(
      'source-conn',
      'source_db',
      'target-conn',
      'target_db',
      true
    )

    expect(diff.tableDiffs).toEqual([])
    expect(diff.rowComparisons).toEqual([
      {
        table: 'shared',
        dataDiff: {
          comparable: true,
          keyColumns: ['id'],
          compareColumns: ['id', 'name'],
          sourceRowCount: 1,
          targetRowCount: 1,
          sourceOnly: 0,
          targetOnly: 0,
          modified: 0,
          identical: 1,
          samples: []
        }
      }
    ])
  })

  it('compares a single shared table without listing all database tables', async () => {
    const sharedSchema = buildSchema('shared', {
      columns: [
        { name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true },
        { name: 'name', type: 'varchar(255)', nullable: false }
      ]
    })
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['shared'] },
      schemas: { 'source_db.shared': sharedSchema },
      streamRowsByTable: {
        'source_db.shared': [[{ id: 1, name: 'Alice' }]]
      }
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['shared'] },
      schemas: { 'target_db.shared': sharedSchema },
      streamRowsByTable: {
        'target_db.shared': [[{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]]
      }
    })

    getDriver.mockImplementation(async (connectionId: string) => {
      return connectionId === 'source-conn' ? sourceDriver.driver : targetDriver.driver
    })

    const result = await diffService.diffTable(
      'source-conn',
      'source_db',
      'target-conn',
      'target_db',
      'shared',
      true
    )

    expect(result.tableDiff).toMatchObject({
      table: 'shared',
      kind: 'modified',
      dataDiff: {
        comparable: true,
        sourceOnly: 0,
        targetOnly: 1,
        modified: 0,
        identical: 1
      }
    })
    expect(result.rowComparison).toMatchObject({
      table: 'shared',
      dataDiff: {
        comparable: true,
        targetOnly: 1
      }
    })
    expect(sourceDriver.listTables).not.toHaveBeenCalled()
    expect(targetDriver.listTables).not.toHaveBeenCalled()
  })

  it('limits database diffs to the requested table filter', async () => {
    const sharedSchema = buildSchema('shared', {
      columns: [
        { name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true },
        { name: 'name', type: 'varchar(255)', nullable: false }
      ]
    })
    const otherSchema = buildSchema('other', {
      columns: [
        { name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true },
        { name: 'title', type: 'varchar(255)', nullable: false }
      ]
    })
    const sourceDriver = createFakeDriver({
      connectionId: 'source',
      tablesByDatabase: { source_db: ['other', 'shared'] },
      schemas: {
        'source_db.shared': sharedSchema,
        'source_db.other': otherSchema
      }
    })
    const targetDriver = createFakeDriver({
      connectionId: 'target',
      tablesByDatabase: { target_db: ['other', 'shared'] },
      schemas: {
        'target_db.shared': sharedSchema,
        'target_db.other': buildSchema('other', {
          columns: [
            { name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true },
            { name: 'title', type: 'varchar(128)', nullable: false }
          ]
        })
      }
    })

    getDriver.mockImplementation(async (connectionId: string) => {
      return connectionId === 'source-conn' ? sourceDriver.driver : targetDriver.driver
    })

    const diff = await diffService.diffDatabases(
      'source-conn',
      'source_db',
      'target-conn',
      'target_db',
      false,
      ['shared']
    )

    expect(diff.tableDiffs).toEqual([])
    expect(sourceDriver.getTableSchema).toHaveBeenCalledTimes(1)
    expect(sourceDriver.getTableSchema).toHaveBeenCalledWith('source_db', 'shared')
    expect(targetDriver.getTableSchema).toHaveBeenCalledTimes(1)
    expect(targetDriver.getTableSchema).toHaveBeenCalledWith('target_db', 'shared')
  })
})

function createFakeDriver(options: {
  connectionId: string
  engine?: DbDriver['engine']
  tablesByDatabase?: Record<string, string[]>
  schemas?: Record<string, TableSchema>
  schemaImpl?: (database: string, table: string) => Promise<TableSchema>
  streamRowsByTable?: Record<string, Record<string, unknown>[][]>
}): {
  driver: DbDriver
  listTables: ReturnType<typeof vi.fn>
  getTableSchema: ReturnType<typeof vi.fn>
  streamRows: ReturnType<typeof vi.fn>
} {
  const listTables = vi.fn(async (database: string) => {
    return options.tablesByDatabase?.[database] ?? []
  })

  const getTableSchema = vi.fn(async (database: string, table: string) => {
    if (options.schemaImpl) {
      return options.schemaImpl(database, table)
    }

    const schema = options.schemas?.[`${database}.${table}`]
    if (!schema) {
      throw new Error(`Missing schema for ${database}.${table}`)
    }
    return schema
  })
  const streamRows = vi.fn(async function* (opts: { database: string; table: string }) {
    for (const batch of options.streamRowsByTable?.[`${opts.database}.${opts.table}`] ?? []) {
      yield batch
    }
  })

  const driver = {
    engine: options.engine ?? 'postgres',
    connectionId: options.connectionId,
    dialect: fakeDialect,
    listDatabases: async () => [],
    listTables,
    getTableSchema,
    queryRows: async () => ({ rows: [], total: 0 }),
    insertRow: async () => ({ insertId: 0, affectedRows: 0 }),
    updateRow: async () => ({ affectedRows: 0 }),
    deleteRows: async () => ({ affectedRows: 0 }),
    renameTable: async () => ({ table: '' }),
    copyTable: async () => ({ table: '' }),
    dropTable: async () => undefined,
    executeSQL: async () => undefined,
    streamRows,
    testConnection: async () => 'OK',
    close: async () => undefined
  } satisfies DbDriver

  return { driver, listTables, getTableSchema, streamRows }
}

function buildSchema(
  name: string,
  overrides?: {
      columns?: Array<{
        name: string
        type?: string
        nullable?: boolean
        defaultValue?: string | null
        isPrimaryKey?: boolean
        isAutoIncrement?: boolean
      }>
    indexes?: TableSchema['indexes']
  }
): TableSchema {
  const columns = (overrides?.columns ?? [{ name: 'id', type: 'int', nullable: false, isPrimaryKey: true, isAutoIncrement: true }]).map(
    (column) => ({
      name: column.name,
      type: column.type ?? 'int',
      nullable: column.nullable ?? false,
      defaultValue: column.defaultValue ?? null,
      isPrimaryKey: column.isPrimaryKey ?? false,
      isAutoIncrement: column.isAutoIncrement ?? false,
      comment: '',
      columnKey: column.isPrimaryKey ? 'PRI' : ''
    })
  )
  const indexes = overrides?.indexes ?? [{ name: 'PRIMARY', columns: ['id'], unique: true, type: 'BTREE' }]

  return {
    name,
    columns,
    indexes,
    primaryKey: columns.filter((column) => column.isPrimaryKey).map((column) => column.name),
    createSQL: `CREATE TABLE ${name} (...)`
  }
}
