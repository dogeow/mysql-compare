// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TableDataPagination } from './TableDataPagination'
import { setEnglishLocale } from './table-data-test-helpers'

afterEach(cleanup)

function createProps(overrides: Partial<React.ComponentProps<typeof TableDataPagination>> = {}) {
  return {
    totalRows: 320,
    page: 2,
    totalPages: 4,
    pageDraft: '2',
    pageSize: 100,
    hiddenColumnCount: 2,
    onPageSizeChange: vi.fn(),
    onGoToPage: vi.fn(),
    onPageDraftChange: vi.fn(),
    onSubmitPageDraft: vi.fn(),
    onResetPageDraft: vi.fn(),
    ...overrides
  }
}

describe('TableDataPagination', () => {
  beforeEach(() => {
    setEnglishLocale()
  })

  it('wires page size, paging buttons, and page draft interactions', () => {
    const props = createProps()

    render(<TableDataPagination {...props} />)

    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Prev' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    const pageInput = screen.getByLabelText('Page number')
    fireEvent.change(pageInput, { target: { value: '4' } })
    fireEvent.blur(pageInput)
    fireEvent.keyDown(pageInput, { key: 'Escape' })

    expect(screen.getByText('2 hidden')).toBeTruthy()
    expect(props.onPageSizeChange).toHaveBeenCalledWith(250)
    expect(props.onGoToPage).toHaveBeenNthCalledWith(1, 1)
    expect(props.onGoToPage).toHaveBeenNthCalledWith(2, 3)
    expect(props.onPageDraftChange).toHaveBeenCalledWith('4')
    expect(props.onSubmitPageDraft).toHaveBeenCalledTimes(1)
    expect(props.onResetPageDraft).toHaveBeenCalledTimes(1)
  })

  it('disables navigation buttons at the edges', () => {
    render(<TableDataPagination {...createProps({ page: 1, totalPages: 1, hiddenColumnCount: 0 })} />)

    const prevButton = screen.getByRole('button', { name: 'Prev' })
    const nextButton = screen.getByRole('button', { name: 'Next' })

    expect((prevButton as HTMLButtonElement).disabled).toBe(true)
    expect((nextButton as HTMLButtonElement).disabled).toBe(true)
  })
})