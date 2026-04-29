import { describe, expect, it } from 'vitest'
import { toggleRowSelection } from './table-selection-utils'

describe('table-selection-utils', () => {
  it('toggles a single row when shift is not pressed', () => {
    expect(
      toggleRowSelection({
        selected: new Set([1]),
        rowIndex: 3,
        anchorIndex: 1,
        shiftKey: false
      })
    ).toEqual({
      selected: new Set([1, 3]),
      anchorIndex: 3
    })

    expect(
      toggleRowSelection({
        selected: new Set([1, 3]),
        rowIndex: 3,
        anchorIndex: 3,
        shiftKey: false
      })
    ).toEqual({
      selected: new Set([1]),
      anchorIndex: 3
    })
  })

  it('selects the inclusive range between the anchor and the clicked row on shift click', () => {
    expect(
      toggleRowSelection({
        selected: new Set([1, 5]),
        rowIndex: 4,
        anchorIndex: 1,
        shiftKey: true
      })
    ).toEqual({
      selected: new Set([1, 2, 3, 4, 5]),
      anchorIndex: 4
    })
  })

  it('falls back to a single toggle when shift is pressed without an anchor', () => {
    expect(
      toggleRowSelection({
        selected: new Set([2]),
        rowIndex: 4,
        anchorIndex: null,
        shiftKey: true
      })
    ).toEqual({
      selected: new Set([2, 4]),
      anchorIndex: 4
    })
  })
})