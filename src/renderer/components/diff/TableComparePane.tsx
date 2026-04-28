import type { Ref, UIEvent } from 'react'
import { Badge } from '@renderer/components/ui/badge'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Table, TBody, Td, THead, Th, Tr } from '@renderer/components/ui/table'
import { cn, formatCellValue } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { QueryRowsResult } from '../../../shared/types'
import { buildRowKey } from './table-compare-utils'

interface TableComparePaneProps {
  title: string
  connectionName: string
  database: string
  table: string
  data: QueryRowsResult | null
  error: string | null
  loading: boolean
  scrollContainerRef?: Ref<HTMLDivElement>
  onScroll?: (event: UIEvent<HTMLDivElement>) => void
  selectedKeys?: Set<string>
  showSelection?: boolean
  leadingSpacer?: boolean
  selectionEnabled?: boolean
  allVisibleSelected?: boolean
  onToggleAllVisible?: () => void
  onToggleRow?: (row: Record<string, unknown>) => void
}

export function TableComparePane({
  title,
  connectionName,
  database,
  table,
  data,
  error,
  loading,
  scrollContainerRef,
  onScroll,
  selectedKeys,
  showSelection = false,
  leadingSpacer = false,
  selectionEnabled = false,
  allVisibleSelected = false,
  onToggleAllVisible,
  onToggleRow
}: TableComparePaneProps) {
  const { t } = useI18n()

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded border border-border bg-card/40">
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{title}</div>
            <div className="truncate text-sm font-medium">{connectionName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {database} / {table}
            </div>
          </div>
          {data && (
            <div className="shrink-0 text-right text-[11px] text-muted-foreground">
              <div>{t('diff.pane.rows', { count: data.total.toLocaleString() })}</div>
              <div>{data.hasPrimaryKey ? t('diff.pane.pkPrefix', { columns: data.primaryKey.join(', ') }) : t('diff.pane.noPrimaryKey')}</div>
            </div>
          )}
        </div>
      </div>

      <div ref={scrollContainerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        {loading && <div className="p-3 text-xs text-muted-foreground">{t('diff.pane.loadingRows')}</div>}
        {!loading && error && <div className="break-all p-3 text-xs text-red-300">{error}</div>}
        {!loading && !error && data && data.rows.length === 0 && (
          <div className="p-3 text-xs text-muted-foreground">{t('diff.pane.noRowsOnPage')}</div>
        )}
        {data && data.rows.length > 0 && (
          <Table>
            <THead>
              <Tr>
                {(showSelection || leadingSpacer) && (
                  <Th className="w-8">
                    {showSelection && (
                      <Checkbox
                        checked={allVisibleSelected}
                        onChange={() => onToggleAllVisible?.()}
                        disabled={!selectionEnabled}
                      />
                    )}
                  </Th>
                )}
                {data.columns.map((column) => (
                  <Th key={column.name}>
                    <div className="flex flex-col items-start gap-1 whitespace-normal py-1 leading-tight">
                      <div className="flex flex-wrap items-center gap-1">
                        {column.isPrimaryKey && <Badge variant="warning">PK</Badge>}
                        <span>{column.name}</span>
                        <span className="text-[10px] text-muted-foreground">{column.type}</span>
                      </div>
                      {column.comment && (
                        <span
                          className="max-w-[14rem] truncate text-[10px] font-normal text-amber-300/90"
                          title={column.comment}
                        >
                          {column.comment}
                        </span>
                      )}
                    </div>
                  </Th>
                ))}
              </Tr>
            </THead>
            <TBody>
              {data.rows.map((row, index) => {
                const rowKey = buildRowKey(row, data.primaryKey) ?? `${title}-${index}`
                const selected = selectedKeys?.has(rowKey) ?? false

                return (
                  <Tr key={rowKey} className={cn(selected && 'bg-accent/30')}>
                    {(showSelection || leadingSpacer) && (
                      <Td>
                        {showSelection && (
                          <Checkbox
                            checked={selected}
                            onChange={() => onToggleRow?.(row)}
                            disabled={!selectionEnabled}
                          />
                        )}
                      </Td>
                    )}
                    {data.columns.map((column) => (
                      <Td key={column.name} title={renderCellValue(row[column.name], column.type)}>
                        {renderCellValue(row[column.name], column.type)}
                      </Td>
                    ))}
                  </Tr>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}

function renderCellValue(value: unknown, columnType: string): string {
  if (value === null || value === undefined) return 'NULL'
  if (columnType === 'tinyint(1)') return value ? '✓' : '✗'
  return formatCellValue(value)
}