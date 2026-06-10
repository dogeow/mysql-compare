import { describe, expect, it } from 'vitest'
import { buildRowDiffLookup } from './table-compare-diff'

describe('buildRowDiffLookup', () => {
  it('marks changed columns on modified rows', () => {
    const lookup = buildRowDiffLookup(
      [{ id: 1, name: 'Boar', level: 1 }],
      [{ id: 1, name: 'Boar', level: 2 }],
      ['id'],
      ['id', 'name', 'level']
    )

    expect(lookup?.source.get(JSON.stringify([{ column: 'id', value: 1 }]))).toEqual({
      status: 'modified',
      changedColumns: new Set(['level'])
    })
    expect(lookup?.target.get(JSON.stringify([{ column: 'id', value: 1 }]))?.changedColumns).toEqual(
      new Set(['level'])
    )
  })

  it('marks source-only and target-only rows', () => {
    const lookup = buildRowDiffLookup(
      [{ id: 1, name: 'A' }],
      [{ id: 2, name: 'B' }],
      ['id'],
      ['id', 'name']
    )

    expect(lookup?.source.get(JSON.stringify([{ column: 'id', value: 1 }]))?.status).toBe(
      'source-only'
    )
    expect(lookup?.target.get(JSON.stringify([{ column: 'id', value: 2 }]))?.status).toBe(
      'target-only'
    )
  })
})
