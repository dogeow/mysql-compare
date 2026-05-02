import { describe, expect, it } from 'vitest'
import { renderTableCellValue } from './table-cell-render'
import { testColumns } from './table-data-test-helpers'

describe('table-cell-render', () => {
  it('renders nullish values as NULL', () => {
    expect(renderTableCellValue(null, testColumns[0]!)).toBe('NULL')
    expect(renderTableCellValue(undefined, testColumns[0]!)).toBe('NULL')
  })

  it('renders tinyint(1) values as boolean glyphs', () => {
    expect(renderTableCellValue(1, testColumns[2]!)).toBe('✓')
    expect(renderTableCellValue(0, testColumns[2]!)).toBe('✗')
  })

  it('stringifies object values', () => {
    expect(renderTableCellValue({ ok: true }, testColumns[1]!)).toBe('{"ok":true}')
  })

  it('falls back to string coercion for primitive values', () => {
    expect(renderTableCellValue(42, testColumns[0]!)).toBe('42')
  })
})