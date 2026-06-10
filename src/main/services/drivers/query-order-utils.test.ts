import { describe, expect, it, vi } from 'vitest'
import {
  buildDefaultOrderBy,
  resolveQueryOrderContext,
  resolveQueryRowsRequest
} from './query-order-utils'

describe('resolveQueryRowsRequest', () => {
  it('injects default primary key order when client omits orderBy', () => {
    expect(
      resolveQueryRowsRequest(
        {
          connectionId: 'conn-1',
          database: 'next',
          table: 'game_monster_definitions',
          page: 1,
          pageSize: 100
        },
        {
          name: 'game_monster_definitions',
          primaryKey: ['id'],
          columns: [{ name: 'id' } as never, { name: 'name' } as never],
          indexes: [],
          createSQL: '',
          rowEstimate: 0,
          tableComment: ''
        }
      )
    ).toEqual({
      connectionId: 'conn-1',
      database: 'next',
      table: 'game_monster_definitions',
      page: 1,
      pageSize: 100,
      orderBy: { column: 'id', dir: 'ASC' },
      primaryKey: ['id'],
      columnNames: ['id', 'name']
    })
  })
})

describe('resolveQueryOrderContext', () => {
  it('uses request context when primary key and columns are provided', async () => {
    const getTableSchema = vi.fn()

    await expect(
      resolveQueryOrderContext(
        {
          connectionId: 'conn-1',
          database: 'next',
          table: 'users',
          page: 1,
          pageSize: 100,
          primaryKey: ['id'],
          columnNames: ['id', 'name']
        },
        getTableSchema
      )
    ).resolves.toEqual({
      primaryKey: ['id'],
      columnNames: ['id', 'name']
    })

    expect(getTableSchema).not.toHaveBeenCalled()
  })

  it('loads schema when order context is missing', async () => {
    const getTableSchema = vi.fn().mockResolvedValue({
      primaryKey: ['id'],
      columns: [{ name: 'id' }, { name: 'name' }]
    })

    await expect(
      resolveQueryOrderContext(
        {
          connectionId: 'conn-1',
          database: 'next',
          table: 'users',
          page: 1,
          pageSize: 100
        },
        getTableSchema
      )
    ).resolves.toEqual({
      primaryKey: ['id'],
      columnNames: ['id', 'name']
    })
  })
})

describe('buildDefaultOrderBy', () => {
  it('returns ascending primary key order', () => {
    expect(buildDefaultOrderBy(['id'])).toEqual({ column: 'id', dir: 'ASC' })
    expect(buildDefaultOrderBy([])).toBeUndefined()
  })
})
