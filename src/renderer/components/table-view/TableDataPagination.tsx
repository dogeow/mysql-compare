import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Select } from '@renderer/components/ui/select'
import { useI18n } from '@renderer/i18n'

interface TableDataPaginationProps {
  totalRows: number
  page: number
  totalPages: number
  pageDraft: string
  pageSize: number
  hiddenColumnCount: number
  onPageSizeChange: (pageSize: number) => void
  onGoToPage: (page: number) => void
  onPageDraftChange: (value: string) => void
  onSubmitPageDraft: () => void
  onResetPageDraft: () => void
}

export function TableDataPagination({
  totalRows,
  page,
  totalPages,
  pageDraft,
  pageSize,
  hiddenColumnCount,
  onPageSizeChange,
  onGoToPage,
  onPageDraftChange,
  onSubmitPageDraft,
  onResetPageDraft
}: TableDataPaginationProps) {
  const { t } = useI18n()

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card/70 px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        {t('tableData.rowsPagination', {
          total: totalRows.toLocaleString(),
          page,
          totalPages
        })}
      </span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-muted-foreground">
          <span>{t('tableData.pageSize')}</span>
          <Select
            value={String(pageSize)}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            options={[
              { value: '50', label: '50' },
              { value: '100', label: '100' },
              { value: '250', label: '250' },
              { value: '500', label: '500' }
            ]}
            className="h-7 w-20 px-2 text-xs"
            aria-label={t('tableData.pageSize')}
          />
        </label>
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onGoToPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
          {t('common.prev')}
        </Button>
        <div className="flex items-center gap-1 text-muted-foreground">
          <span>{t('tableData.pageLabel')}</span>
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={pageDraft}
            onChange={(event) => onPageDraftChange(event.target.value)}
            onBlur={onSubmitPageDraft}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onSubmitPageDraft()
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                onResetPageDraft()
                event.currentTarget.blur()
              }
            }}
            aria-label={t('tableData.pageInput')}
            className="h-7 w-16 px-2 text-center text-xs"
          />
          <span>/ {totalPages}</span>
        </div>
        {hiddenColumnCount > 0 && (
          <span className="text-muted-foreground">
            {t('tableData.hiddenColumns', { count: hiddenColumnCount })}
          </span>
        )}
        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onGoToPage(page + 1)}>
          {t('common.next')}
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}