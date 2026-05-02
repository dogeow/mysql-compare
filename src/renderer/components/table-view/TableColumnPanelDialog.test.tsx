// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableColumnPanelDialog } from './TableColumnPanelDialog'
import { setEnglishLocale, testColumns } from './table-data-test-helpers'

afterEach(cleanup)

function createProps(overrides: Partial<React.ComponentProps<typeof TableColumnPanelDialog>> = {}) {
  return {
    open: true,
    columns: testColumns,
    visibleColumns: new Set(['id', 'name']),
    visibleColumnCount: 2,
    onOpenChange: vi.fn(),
    onShowAllColumns: vi.fn(),
    onShowPrimaryColumns: vi.fn(),
    onToggleColumn: vi.fn(),
    ...overrides
  }
}

describe('TableColumnPanelDialog', () => {
  beforeEach(() => {
    setEnglishLocale()
  })

  it('renders summary actions and closes through the dialog controls', () => {
    const props = createProps()

    render(<TableColumnPanelDialog {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Primary only' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)

    expect(screen.getByText('2 / 3 columns')).toBeTruthy()
    expect(props.onShowAllColumns).toHaveBeenCalledTimes(1)
    expect(props.onShowPrimaryColumns).toHaveBeenCalledTimes(1)
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('toggles column visibility from the checkbox list', () => {
    const props = createProps()

    render(<TableColumnPanelDialog {...props} />)

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1]!)

    expect(props.onToggleColumn).toHaveBeenCalledWith('name', false)
  })

  it('keeps the last visible column checkbox disabled', () => {
    render(
      <TableColumnPanelDialog
        {...createProps({ visibleColumns: new Set(['id']), visibleColumnCount: 1 })}
      />
    )

    const checkboxes = screen.getAllByRole('checkbox')
    expect((checkboxes[0] as HTMLInputElement).disabled).toBe(true)
  })
})