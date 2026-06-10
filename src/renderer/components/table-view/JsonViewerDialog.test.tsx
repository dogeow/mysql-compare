// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JsonViewerDialog } from './JsonViewerDialog'
import { setEnglishLocale } from './table-data-test-helpers'

const jsonColumn = {
  name: 'drop_table',
  type: 'json',
  nullable: true,
  defaultValue: null,
  isPrimaryKey: false,
  isAutoIncrement: false,
  comment: '',
  columnKey: ''
}

const row = {
  id: 1,
  drop_table: {
    item_chance: 0.3,
    potion_chance: 0.25
  }
}

afterEach(cleanup)

describe('JsonViewerDialog', () => {
  beforeEach(() => {
    setEnglishLocale()
  })

  it('renders editable textarea and saves valid json changes', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    render(
      <JsonViewerDialog
        state={{
          column: jsonColumn,
          row,
          content: '{\n  "item_chance": 0.3\n}'
        }}
        onClose={onClose}
        onSave={onSave}
      />
    )

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, {
      target: { value: '{\n  "item_chance": 0.1\n}' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(row, 'drop_table', '{\n  "item_chance": 0.1\n}')
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('shows validation error for invalid json', () => {
    render(
      <JsonViewerDialog
        state={{
          column: jsonColumn,
          row,
          content: '{\n  "item_chance": 0.3\n}'
        }}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '{\n  "item_chance": 0.\n}' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    expect(screen.getByText('Must be valid JSON')).toBeTruthy()
  })

  it('renders read-only content when saving is unavailable', () => {
    render(
      <JsonViewerDialog
        state={{
          column: jsonColumn,
          row,
          content: '{\n  "item_chance": 0.3\n}'
        }}
        readOnly
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/"item_chance": 0.3/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })
})
