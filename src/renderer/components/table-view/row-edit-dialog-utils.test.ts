import { describe, expect, it } from 'vitest'
import type { ColumnInfo } from '../../../shared/types'
import {
  formatInputValue,
  formatJsonForDisplay,
  getFormattedJsonDisplay,
  isJsonContentEqual,
  isRowEditValueEqual,
  prepareRowEditValues
} from './row-edit-dialog-utils'

const jsonColumn: ColumnInfo = {
  name: 'drop_table',
  type: 'json',
  nullable: true,
  defaultValue: null,
  isPrimaryKey: false,
  isAutoIncrement: false,
  comment: '',
  columnKey: ''
}

describe('formatJsonForDisplay', () => {
  it('pretty-prints parsed objects', () => {
    expect(formatJsonForDisplay({ item_chance: 0 })).toBe(
      '{\n  "item_chance": 0\n}'
    )
  })

  it('pretty-prints valid JSON strings', () => {
    expect(formatJsonForDisplay('{"item_chance":0.1}')).toBe(
      '{\n  "item_chance": 0.1\n}'
    )
  })
})

describe('formatInputValue', () => {
  it('keeps raw string while editing json columns', () => {
    const editing = '{\n  "item_chance": 0.1,\n  "potion_chance": 0.1\n}'
    expect(formatInputValue(jsonColumn, editing)).toBe(editing)
  })

  it('formats object values for initial display', () => {
    expect(formatInputValue(jsonColumn, { item_chance: 0 })).toBe(
      '{\n  "item_chance": 0\n}'
    )
  })
})

describe('isJsonContentEqual', () => {
  it('compares json objects and formatted strings', () => {
    expect(isJsonContentEqual({ item_chance: 0 }, '{\n  "item_chance": 0\n}')).toBe(true)
  })
})

describe('getFormattedJsonDisplay', () => {
  it('returns null for non-json strings', () => {
    expect(getFormattedJsonDisplay('plain text')).toBeNull()
  })

  it('formats json-like values for display', () => {
    expect(getFormattedJsonDisplay({ item_chance: 0.1 })).toBe(
      '{\n  "item_chance": 0.1\n}'
    )
  })
})

describe('isRowEditValueEqual', () => {
  it('treats parsed json objects and formatted strings as equal', () => {
    expect(
      isRowEditValueEqual(jsonColumn, { item_chance: 0 }, '{\n  "item_chance": 0\n}')
    ).toBe(true)
  })

  it('detects semantic json changes', () => {
    expect(
      isRowEditValueEqual(jsonColumn, { item_chance: 0 }, '{\n  "item_chance": 0.1\n}')
    ).toBe(false)
  })
})

describe('prepareRowEditValues', () => {
  it('converts json column objects to editable strings on load', () => {
    const values = prepareRowEditValues('edit', [jsonColumn], {
      drop_table: { item_chance: 0 }
    })

    expect(values.drop_table).toBe('{\n  "item_chance": 0\n}')
  })
})
