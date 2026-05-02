import { useI18nStore } from '../../i18n'
import type { ColumnInfo, QueryRowsResult } from '../../../shared/types'

export const testColumns: ColumnInfo[] = [
  {
    name: 'id',
    type: 'int',
    nullable: false,
    defaultValue: null,
    isPrimaryKey: true,
    isAutoIncrement: true,
    comment: 'identifier',
    columnKey: 'PRI'
  },
  {
    name: 'name',
    type: 'varchar(255)',
    nullable: false,
    defaultValue: null,
    isPrimaryKey: false,
    isAutoIncrement: false,
    comment: 'display name',
    columnKey: ''
  },
  {
    name: 'active',
    type: 'tinyint(1)',
    nullable: false,
    defaultValue: '1',
    isPrimaryKey: false,
    isAutoIncrement: false,
    comment: '',
    columnKey: ''
  }
]

export const testRows: Array<Record<string, unknown>> = [
  { id: 1, name: 'Alice', active: 1 },
  { id: 2, name: 'Bob', active: 0 },
  { id: 3, name: 'Carol', active: 1 }
]

export function createQueryRowsResult(overrides: Partial<QueryRowsResult> = {}): QueryRowsResult {
  return {
    rows: testRows,
    total: testRows.length,
    hasPrimaryKey: true,
    primaryKey: ['id'],
    columns: testColumns,
    ...overrides
  }
}

export function createNoPrimaryKeyQueryRowsResult(overrides: Partial<QueryRowsResult> = {}): QueryRowsResult {
  return createQueryRowsResult({
    hasPrimaryKey: false,
    primaryKey: [],
    columns: testColumns.map((column) => ({
      ...column,
      isPrimaryKey: false,
      columnKey: ''
    })),
    ...overrides
  })
}

export function setEnglishLocale(): void {
  useI18nStore.getState().setLocale('en')
}