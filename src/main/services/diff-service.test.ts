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
})

function createFakeDriver(options: {
  connectionId: string
  engine?: DbDriver['engine']
  tablesByDatabase?: Record<string, string[]>
  schemas?: Record<string, TableSchema>
  schemaImpl?: (database: string, table: string) => Promise<TableSchema>
}): {
  driver: DbDriver
  listTables: ReturnType<typeof vi.fn>
  getTableSchema: ReturnType<typeof vi.fn>
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
    streamRows: async function* () {
      return
    },
    testConnection: async () => 'OK',
    close: async () => undefined
  } satisfies DbDriver

  return { driver, listTables, getTableSchema }
}

function buildSchema(
  name: string,
  overrides?: {
    columns?: Array<{
      name: string
      type?: string
      nullable?: boolean
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
      defaultValue: null,
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