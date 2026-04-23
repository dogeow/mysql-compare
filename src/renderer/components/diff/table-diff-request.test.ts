import { describe, expect, it } from 'vitest'
import {
  extractTableComparisonResult,
  requestTableComparison,
  supportsIncrementalTableDiff
} from './table-diff-request'

describe('table-diff-request', () => {
  it('detects when the runtime diff router does not expose table diff', () => {
    expect(
      supportsIncrementalTableDiff({
        databases: async () => ({ ok: true as const, data: { sourceDatabase: '', targetDatabase: '', tableDiffs: [], rowComparisons: [] } })
      })
    ).toBe(false)
  })

  it('detects when the runtime diff router exposes table diff', () => {
    expect(
      supportsIncrementalTableDiff({
        databases: async () => ({ ok: true as const, data: { sourceDatabase: '', targetDatabase: '', tableDiffs: [], rowComparisons: [] } }),
        table: async () => ({ ok: true as const, data: { tableDiff: null, rowComparison: null } })
      })
    ).toBe(true)
  })

  it('extracts the requested table diff and row comparison from a full database diff', () => {
    expect(
      extractTableComparisonResult(
        {
          sourceDatabase: 'source_db',
          targetDatabase: 'target_db',
          tableDiffs: [
            { table: 'users', kind: 'modified', columnDiffs: [], indexDiffs: [] },
            { table: 'posts', kind: 'only-in-source', columnDiffs: [], indexDiffs: [] }
          ],
          rowComparisons: [
            {
              table: 'users',
              dataDiff: {
                comparable: true,
                keyColumns: ['id'],
                compareColumns: ['id', 'name'],
                sourceRowCount: 1,
                targetRowCount: 1,
                sourceOnly: 0,
                targetOnly: 0,
                modified: 1,
                identical: 0,
                samples: []
              }
            }
          ]
        },
        'users'
      )
    ).toEqual({
      tableDiff: { table: 'users', kind: 'modified', columnDiffs: [], indexDiffs: [] },
      rowComparison: {
        table: 'users',
        dataDiff: {
          comparable: true,
          keyColumns: ['id'],
          compareColumns: ['id', 'name'],
          sourceRowCount: 1,
          targetRowCount: 1,
          sourceOnly: 0,
          targetOnly: 0,
          modified: 1,
          identical: 0,
          samples: []
        }
      }
    })
  })

  it('falls back to filtered database diff requests when table diff is unavailable', async () => {
    const result = await requestTableComparison(
      {
        databases: async () => ({
          ok: true as const,
          data: {
            sourceDatabase: 'source_db',
            targetDatabase: 'target_db',
            tableDiffs: [{ table: 'users', kind: 'modified', columnDiffs: [], indexDiffs: [] }],
            rowComparisons: []
          }
        })
      },
      {
        sourceConnectionId: 'source-conn',
        sourceDatabase: 'source_db',
        targetConnectionId: 'target-conn',
        targetDatabase: 'target_db',
        table: 'users',
        includeData: false
      }
    )

    expect(result).toEqual({
      ok: true,
      data: {
        tableDiff: { table: 'users', kind: 'modified', columnDiffs: [], indexDiffs: [] },
        rowComparison: null
      }
    })
  })
})