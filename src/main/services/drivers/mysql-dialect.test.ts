import { describe, expect, it } from 'vitest'
import { buildMySQLOrderClause } from './mysql-dialect'

describe('buildMySQLOrderClause', () => {
  it('defaults to primary key ascending when no sort is provided', () => {
    expect(
      buildMySQLOrderClause([{ name: 'id' } as never, { name: 'name' } as never], ['id'])
    ).toBe('ORDER BY `id` ASC')
  })

  it('keeps user sort and appends primary key for stable ordering', () => {
    expect(
      buildMySQLOrderClause(
        [{ name: 'id' } as never, { name: 'name' } as never],
        ['id'],
        { column: 'name', dir: 'DESC' }
      )
    ).toBe('ORDER BY `name` DESC, `id` ASC')
  })
})
