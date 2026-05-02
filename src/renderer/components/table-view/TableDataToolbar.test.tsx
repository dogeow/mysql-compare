// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableDataToolbar } from './TableDataToolbar'
import { setEnglishLocale } from './table-data-test-helpers'

afterEach(cleanup)

function createProps(overrides: Partial<React.ComponentProps<typeof TableDataToolbar>> = {}) {
  return {
    where: '',
    hasPendingWhere: false,
    hasActiveFilter: false,
    loading: false,
    selectedCount: 0,
    wrapCells: false,
    density: 'compact' as const,
    columnCounts: undefined,
    onWhereChange: vi.fn(),
    onApplyWhere: vi.fn(),
    onClearWhere: vi.fn(),
    onRefresh: vi.fn(),
    onOpenExport: vi.fn(),
    onOpenColumnPanel: vi.fn(),
    onToggleWrapCells: vi.fn(),
    onToggleDensity: vi.fn(),
    onInsert: vi.fn(),
    onDeleteSelected: vi.fn(),
    onCopySelectedRows: vi.fn(),
    onClearSelection: vi.fn(),
    ...overrides
  }
}

describe('TableDataToolbar', () => {
  beforeEach(() => {
    setEnglishLocale()
  })

  it('wires filter input changes and keyboard shortcuts', () => {
    const props = createProps({
      where: 'status = 1',
      hasPendingWhere: true,
      hasActiveFilter: true
    })

    render(<TableDataToolbar {...props} />)

    const input = screen.getByPlaceholderText(/WHERE clause, e\.g\./i)
    fireEvent.change(input, { target: { value: 'id > 10' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.click(screen.getByTitle('Clear filter'))

    expect(props.onWhereChange).toHaveBeenCalledWith('id > 10')
    expect(props.onApplyWhere).toHaveBeenCalledTimes(1)
    expect(props.onClearWhere).toHaveBeenCalledTimes(2)
  })

  it('renders column controls and selected-row actions', () => {
    const props = createProps({
      selectedCount: 2,
      wrapCells: true,
      density: 'comfortable',
      columnCounts: { visible: 2, total: 3 }
    })

    render(<TableDataToolbar {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('button', { name: '2 / 3 columns' }))
    fireEvent.click(screen.getByTitle('Toggle cell wrapping'))
    fireEvent.click(screen.getByTitle('Toggle row density'))
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.getByText('2 selected')).toBeTruthy()
    expect(props.onOpenExport).toHaveBeenCalledTimes(1)
    expect(props.onOpenColumnPanel).toHaveBeenCalledTimes(1)
    expect(props.onToggleWrapCells).toHaveBeenCalledTimes(1)
    expect(props.onToggleDensity).toHaveBeenCalledTimes(1)
    expect(props.onInsert).toHaveBeenCalledTimes(1)
    expect(props.onDeleteSelected).toHaveBeenCalledTimes(1)
    expect(props.onCopySelectedRows).toHaveBeenCalledTimes(1)
    expect(props.onClearSelection).toHaveBeenCalledTimes(1)
  })
})