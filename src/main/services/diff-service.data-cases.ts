import { expect, it, vi } from 'vitest'
import { buildSchema, createFakeDriver } from './diff-service.test-helpers'
import { diffService } from './diff-service'

export function registerDiffServiceDataTests(getDriver: ReturnType<typeof vi.fn>): void {
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
        'target_db.shared': [[
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Robert' },
          { id: 3, name: 'Carol' }
        ]]
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
}