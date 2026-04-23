import { describe, expect, it } from 'vitest'
import type { TableCompareEntry } from './diff-panel-utils'
import {
  DEFAULT_TABLE_COMPARE_CONCURRENCY,
  filterComparisonEntries,
  parseDiffPanelPreferences,
  parseTableCompareConcurrency
} from './diff-panel-utils'

describe('diff-panel-utils', () => {
  const entries: TableCompareEntry[] = [
    {
      table: 'comparing_table',
      sourceExists: true,
      targetExists: true,
      status: 'comparing',
      tableDiff: null,
      rowComparison: null
    },
    {
      table: 'changed_table',
      sourceExists: true,
      targetExists: true,
      status: 'done',
      tableDiff: {
        table: 'changed_table',
        kind: 'modified',
        columnDiffs: [
          {
            name: 'name',
            kind: 'modified',
            source: {
              name: 'name',
              type: 'varchar(255)',
              nullable: false,
              defaultValue: null,
              isPrimaryKey: false,
              isAutoIncrement: false,
              comment: '',
              columnKey: ''
            },
            target: {
              name: 'name',
              type: 'varchar(128)',
              nullable: false,
              defaultValue: null,
              isPrimaryKey: false,
              isAutoIncrement: false,
              comment: '',
              columnKey: ''
            }
          }
        ],
        indexDiffs: []
      },
      rowComparison: null
    },
    {
      table: 'row_changed_table',
      sourceExists: true,
      targetExists: true,
      status: 'done',
      tableDiff: {
        table: 'row_changed_table',
        kind: 'modified',
        columnDiffs: [],
        indexDiffs: [],
        dataDiff: {
          comparable: true,
          keyColumns: ['id'],
          compareColumns: ['id', 'name'],
          sourceRowCount: 2,
          targetRowCount: 2,
          sourceOnly: 0,
          targetOnly: 0,
          modified: 1,
          identical: 1,
          samples: []
        }
      },
      rowComparison: {
        table: 'row_changed_table',
        dataDiff: {
          comparable: true,
          keyColumns: ['id'],
          compareColumns: ['id', 'name'],
          sourceRowCount: 2,
          targetRowCount: 2,
          sourceOnly: 0,
          targetOnly: 0,
          modified: 1,
          identical: 1,
          samples: []
        }
      }
    },
    {
      table: 'identical_table',
      sourceExists: true,
      targetExists: true,
      status: 'done',
      tableDiff: null,
      rowComparison: {
        table: 'identical_table',
        dataDiff: {
          comparable: true,
          keyColumns: ['id'],
          compareColumns: ['id', 'name'],
          sourceRowCount: 1,
          targetRowCount: 1,
          sourceOnly: 0,
          targetOnly: 0,
          modified: 0,
          identical: 1,
          samples: []
        }
      }
    }
  ]

  it('keeps only currently comparing entries when the comparing filter is selected', () => {
    expect(filterComparisonEntries(entries, 'comparing').map((entry) => entry.table)).toEqual([
      'comparing_table'
    ])
  })

  it('keeps only changed entries when the changed filter is selected', () => {
    expect(filterComparisonEntries(entries, 'changed').map((entry) => entry.table)).toEqual([
      'changed_table',
      'row_changed_table'
    ])
  })

  it('keeps only schema changes when the schema-changed filter is selected', () => {
    expect(filterComparisonEntries(entries, 'schema-changed').map((entry) => entry.table)).toEqual([
      'changed_table'
    ])
  })

  it('keeps only row changes when the row-changed filter is selected', () => {
    expect(filterComparisonEntries(entries, 'row-changed').map((entry) => entry.table)).toEqual([
      'row_changed_table'
    ])
  })

  it('falls back to the default concurrency for invalid select values', () => {
    expect(parseTableCompareConcurrency('5')).toBe(5)
    expect(parseTableCompareConcurrency('invalid')).toBe(DEFAULT_TABLE_COMPARE_CONCURRENCY)
    expect(parseTableCompareConcurrency('0')).toBe(DEFAULT_TABLE_COMPARE_CONCURRENCY)
  })

  it('restores persisted filter and concurrency preferences with safe fallbacks', () => {
    expect(
      parseDiffPanelPreferences(
        JSON.stringify({ statusFilter: 'row-changed', tableCompareConcurrency: 8 })
      )
    ).toEqual({
      statusFilter: 'row-changed',
      tableCompareConcurrency: 8
    })

    expect(parseDiffPanelPreferences('{"statusFilter":"invalid","tableCompareConcurrency":99}')).toEqual({
      statusFilter: 'all',
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY
    })

    expect(parseDiffPanelPreferences('not-json')).toEqual({
      statusFilter: 'all',
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY
    })
  })
})