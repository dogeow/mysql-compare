import { describe, expect, it } from 'vitest'
import type { ColumnInfo } from '../../../shared/types'
import { buildCopyValues, buildRowKey } from './table-compare-utils'

function createColumn(name: string): ColumnInfo {
  return {
    name,
    type: 'varchar(255)',
    nullable: false,
    defaultValue: null,
    isPrimaryKey: name === 'id',
    isAutoIncrement: name === 'id',
    comment: '',
    columnKey: name === 'id' ? 'PRI' : ''
  }
}

describe('table-compare-utils', () => {
  it('builds a stable row key from the provided key columns', () => {
    expect(buildRowKey({ id: 7, tenant_id: 'acme', name: 'Ada' }, ['tenant_id', 'id'])).toBe(
      JSON.stringify([
        { column: 'tenant_id', value: 'acme' },
        { column: 'id', value: 7 }
      ])
    )
  })

  it('returns null when no key columns are available', () => {
    expect(buildRowKey({ id: 7 }, [])).toBeNull()
  })

  it('copies only columns that exist on the target schema', () => {
    expect(
      buildCopyValues(
        {
          id: 7,
          email: 'ada@example.com',
          display_name: 'Ada',
          ignored_field: 'skip me'
        },
        [createColumn('id'), createColumn('email'), createColumn('display_name')]
      )
    ).toEqual({
      id: 7,
      email: 'ada@example.com',
      display_name: 'Ada'
    })
  })

  it('returns an empty payload when the target schema has no shared columns', () => {
    expect(buildCopyValues({ id: 7, email: 'ada@example.com' }, [createColumn('name')])).toEqual(
      {}
    )
  })
})