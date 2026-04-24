import { describe, expect, it } from 'vitest'
import type { TableCompareEntry } from './diff-panel-utils'
import {
  DEFAULT_COMPARE_SETUP_EXPANDED,
  DEFAULT_DIFF_RESULT_TAB,
  DEFAULT_TABLE_COMPARE_CONCURRENCY,
  DEFAULT_TABLE_SEARCH_QUERY,
  filterChangedRowComparisons,
  filterComparisonEntries,
  getPreferredComparisonTable,
  getRowDiffNavigation,
  parseDiffPanelPreferences,
  parseTableCompareConcurrency,
  prioritizeComparisonEntries
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

  it('returns only comparable row comparisons with actual differences', () => {
    expect(
      filterChangedRowComparisons(
        entries
          .map((entry) => entry.rowComparison)
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      ).map((entry) => entry.table)
    ).toEqual(['row_changed_table'])
  })

  it('filters entries by table name after the status filter is applied', () => {
    expect(filterComparisonEntries(entries, 'changed', 'row_').map((entry) => entry.table)).toEqual([
      'row_changed_table'
    ])

    expect(filterComparisonEntries(entries, 'all', 'IDENT')).toEqual([
      entries[3]!
    ])
  })

  it('moves unfinished comparison entries to the top while preserving order within each priority', () => {
    expect(prioritizeComparisonEntries([
      {
        ...entries[1]!,
        table: 'failed_table',
        status: 'error',
        error: 'boom'
      },
      entries[2]!,
      entries[0]!,
      {
        ...entries[3]!,
        table: 'queued_table',
        status: 'queued'
      }
    ]).map((entry) => entry.table)).toEqual([
      'comparing_table',
      'queued_table',
      'failed_table',
      'row_changed_table'
    ])
  })

  it('prefers the first unfinished entry and otherwise falls back to the current or first entry', () => {
    const prioritizedEntries = prioritizeComparisonEntries([
      {
        ...entries[1]!,
        table: 'failed_table',
        status: 'error',
        error: 'boom'
      },
      entries[0]!,
      entries[2]!
    ])

    expect(getPreferredComparisonTable(prioritizedEntries, null)).toBe('comparing_table')
    expect(getPreferredComparisonTable(prioritizedEntries, 'row_changed_table')).toBe(
      'row_changed_table'
    )
    expect(getPreferredComparisonTable(prioritizedEntries, 'missing')).toBe('comparing_table')
    expect(getPreferredComparisonTable([], null)).toBeNull()
  })

  it('falls back to the default concurrency for invalid select values', () => {
    expect(parseTableCompareConcurrency('5')).toBe(5)
    expect(parseTableCompareConcurrency('invalid')).toBe(DEFAULT_TABLE_COMPARE_CONCURRENCY)
    expect(parseTableCompareConcurrency('0')).toBe(DEFAULT_TABLE_COMPARE_CONCURRENCY)
  })

  it('resolves previous and next changed tables from the current table context', () => {
    expect(
      getRowDiffNavigation(
        ['activity_log', 'cache', 'chat_moderation_actions', 'users'],
        ['cache', 'users'],
        'cache'
      )
    ).toEqual({
      previousTable: null,
      nextTable: 'users',
      currentDiffPosition: 1,
      totalDiffTables: 2
    })

    expect(
      getRowDiffNavigation(
        ['activity_log', 'cache', 'chat_moderation_actions', 'users'],
        ['cache', 'users'],
        'chat_moderation_actions'
      )
    ).toEqual({
      previousTable: 'cache',
      nextTable: 'users',
      currentDiffPosition: null,
      totalDiffTables: 2
    })
  })

  it('restores the tables result tab from persisted preferences', () => {
    expect(
      parseDiffPanelPreferences(
        JSON.stringify({
          resultTab: 'tables'
        })
      )
    ).toEqual({
      statusFilter: 'all',
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY,
      resultTab: 'tables',
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      tableSearchQuery: DEFAULT_TABLE_SEARCH_QUERY
    })
  })

  it('keeps an explicit result tab even when legacy expanded table-list flags are present', () => {
    expect(
      parseDiffPanelPreferences(
        JSON.stringify({
          resultTab: 'status',
          sourceTablesExpanded: true
        })
      )
    ).toEqual({
      statusFilter: 'all',
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY,
      resultTab: 'status',
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      tableSearchQuery: DEFAULT_TABLE_SEARCH_QUERY
    })
  })

  it('maps legacy expanded table-list preferences to the tables result tab when no explicit tab exists', () => {
    expect(
      parseDiffPanelPreferences(
        JSON.stringify({
          sourceTablesExpanded: true
        })
      )
    ).toEqual({
      statusFilter: 'all',
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY,
      resultTab: 'tables',
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      tableSearchQuery: DEFAULT_TABLE_SEARCH_QUERY
    })
  })

  it('restores persisted filter and concurrency preferences while keeping compare setup expanded initially', () => {
    expect(
      parseDiffPanelPreferences(
        JSON.stringify({
          statusFilter: 'row-changed',
          tableCompareConcurrency: 8,
          resultTab: 'data',
          setupExpanded: false,
          tableSearchQuery: 'users'
        })
      )
    ).toEqual({
      statusFilter: 'row-changed',
      tableCompareConcurrency: 8,
      resultTab: 'data',
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      tableSearchQuery: 'users'
    })

    expect(
      parseDiffPanelPreferences(
        '{"statusFilter":"invalid","tableCompareConcurrency":99,"resultTab":"invalid","setupExpanded":"no","tableSearchQuery":123}'
      )
    ).toEqual({
      statusFilter: 'all',
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY,
      resultTab: DEFAULT_DIFF_RESULT_TAB,
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      tableSearchQuery: DEFAULT_TABLE_SEARCH_QUERY
    })

    expect(parseDiffPanelPreferences('not-json')).toEqual({
      statusFilter: 'all',
      tableCompareConcurrency: DEFAULT_TABLE_COMPARE_CONCURRENCY,
      resultTab: DEFAULT_DIFF_RESULT_TAB,
      setupExpanded: DEFAULT_COMPARE_SETUP_EXPANDED,
      tableSearchQuery: DEFAULT_TABLE_SEARCH_QUERY
    })
  })
})