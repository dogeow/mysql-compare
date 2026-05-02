import type { MouseEvent, Ref, UIEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Table, TBody, Td, THead, Th, Tr } from '@renderer/components/ui/table'
import { cn, formatCellValue } from '@renderer/lib/utils'
import { useI18n } from '@renderer/i18n'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'
import { buildRowKey, type CompareColumn } from './table-compare-utils'

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
  onToggleRow?: (row: Record<string, unknown>, event: MouseEvent<HTMLInputElement>) => void
  compareColumns?: CompareColumn[]
  side?: 'source' | 'target'
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
  onToggleRow,
  compareColumns,
  side = 'source'
}: TableComparePaneProps) {
  const { t } = useI18n()
  const columns =
    compareColumns ??
    data?.columns.map((column) => ({
      name: column.name,
      [side]: column
    })) ??
    []
  const tableWidth =
    columns.reduce((total, column) => total + getCompareColumnWidth(column.name), 0) +
    (showSelection || leadingSpacer ? 44 : 0)

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded border border-border bg-card/40">
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="shrink-0 text-xs text-muted-foreground">{title}</span>
            <strong className="shrink-0 font-medium">{connectionName}</strong>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {database} / {table}
            </span>
            {loading && (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
                aria-label={t('diff.pane.loadingRows')}
              />
            )}
          </div>
          {data && (
            <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
              <span>{t('diff.pane.rows', { count: data.total.toLocaleString() })}</span>
              <span>{data.hasPrimaryKey ? t('diff.pane.pkPrefix', { columns: data.primaryKey.join(', ') }) : t('diff.pane.noPrimaryKey')}</span>
            </div>
          )}
        </div>
      </div>

      <div ref={scrollContainerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto">
        {!loading && error && <div className="break-all p-3 text-xs text-red-300">{error}</div>}
        {data && (
          <Table className="table-fixed" style={{ width: tableWidth }}>
            <colgroup>
              {(showSelection || leadingSpacer) && <col style={{ width: 44 }} />}
              {columns.map((column) => (
                <col key={column.name} style={{ width: getCompareColumnWidth(column.name) }} />
              ))}
            </colgroup>
            <THead>
              <Tr>
                {(showSelection || leadingSpacer) && (
                  <Th className="h-14 w-11 align-middle">
                    <div className="flex h-full items-center">
                      {showSelection && (
                        <Checkbox
                          checked={allVisibleSelected}
                          onChange={() => onToggleAllVisible?.()}
                          disabled={!selectionEnabled}
                        />
                      )}
                    </div>
                  </Th>
                )}
                {columns.map((column) => {
                  const sideColumn = getSideColumn(column, side)
                  return (
                    <Th key={column.name} className="h-14 align-middle">
                      <div className="flex min-w-0 items-center gap-1 overflow-hidden leading-tight">
                        {sideColumn?.isPrimaryKey && <Badge variant="warning">PK</Badge>}
                        {!sideColumn && <Badge variant="destructive">{t('diff.pane.missingColumn')}</Badge>}
                        <span className="shrink-0 truncate">{column.name}</span>
                        <span className="shrink-0 truncate text-[10px] text-muted-foreground">
                          {sideColumn?.type ?? t('diff.pane.notPresent')}
                        </span>
                      </div>
                    </Th>
                  )
                })}
              </Tr>
            </THead>
            <TBody>
              {data.rows.length === 0 && (
                <Tr>
                  <Td colSpan={columns.length + (showSelection || leadingSpacer ? 1 : 0)} className="h-11 text-xs text-muted-foreground">
                    {t('diff.pane.noRowsOnPage')}
                  </Td>
                </Tr>
              )}
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
                            onChange={() => undefined}
                            onClick={(event) => onToggleRow?.(row, event)}
                            disabled={!selectionEnabled}
                          />
                        )}
                      </Td>
                    )}
                    {columns.map((column) => {
                      const sideColumn = getSideColumn(column, side)
                      return (
                        <Td
                          key={column.name}
                          title={sideColumn ? renderCellValue(row[column.name], sideColumn.type) : t('diff.pane.notPresent')}
                          className="h-11"
                        >
                          {sideColumn ? (
                            renderCellValue(row[column.name], sideColumn.type)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </Td>
                      )
                    })}
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

function getSideColumn(column: CompareColumn, side: 'source' | 'target'): ColumnInfo | undefined {
  return side === 'source' ? column.source : column.target
}

function getCompareColumnWidth(columnName: string): number {
  if (/^(id|.*_id)$/.test(columnName)) return 144
  if (/(created_at|updated_at|deleted_at|time|date)$/i.test(columnName)) return 220
  if (/(name|title|email|slug)$/i.test(columnName)) return 190
  return 180
}

function renderCellValue(value: unknown, columnType: string): string {
  if (value === null || value === undefined) return 'NULL'
  if (columnType === 'tinyint(1)') return value ? '✓' : '✗'
  return formatCellValue(value)
}
