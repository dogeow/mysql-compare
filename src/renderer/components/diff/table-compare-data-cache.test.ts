import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryRowsResult } from '../../../shared/types'

const queryRows = vi.fn()

vi.mock('@renderer/lib/api', () => ({
  api: {
    db: {
      queryRows
    }
  },
  unwrap: async <T>(promise: Promise<{ ok: boolean; data: T; error?: string }>) => {
    const result = await promise
    if (!result.ok) {
      throw new Error(result.error || 'IPC error')
    }

    return result.data
  }
}))

type TableCompareDataCacheModule = typeof import('./table-compare-data-cache')

let cacheModule: TableCompareDataCacheModule

beforeEach(async () => {
  vi.resetModules()
  queryRows.mockReset()
  cacheModule = await import('./table-compare-data-cache')
})

describe('table-compare-data-cache', () => {
  it('deduplicates identical in-flight requests within the same compare view scope', async () => {
    let resolveRequest: ((value: { ok: boolean; data: QueryRowsResult }) => void) | undefined

    queryRows.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve
      })
    )

    const query = buildQuery('scope-1')
    const firstRequest = cacheModule.fetchComparedTableData(query)
    const secondRequest = cacheModule.fetchComparedTableData(query)

    expect(queryRows).toHaveBeenCalledTimes(1)

    resolveRequest?.({ ok: true, data: buildRowsResult([{ id: 1, name: 'Ada' }]) })

    await expect(firstRequest).resolves.toMatchObject({ total: 1, rows: [{ id: 1, name: 'Ada' }] })
    await expect(secondRequest).resolves.toMatchObject({ total: 1, rows: [{ id: 1, name: 'Ada' }] })
  })

  it('does not reuse cached rows across different compare view scopes', async () => {
    queryRows.mockResolvedValueOnce({ ok: true, data: buildRowsResult([{ id: 1, name: 'Ada' }]) })

    await expect(cacheModule.fetchComparedTableData(buildQuery('scope-1'))).resolves.toMatchObject({
      rows: [{ id: 1, name: 'Ada' }]
    })

    queryRows.mockResolvedValueOnce({ ok: true, data: buildRowsResult([{ id: 2, name: 'Bob' }]) })

    await expect(cacheModule.fetchComparedTableData(buildQuery('scope-2'))).resolves.toMatchObject({
      rows: [{ id: 2, name: 'Bob' }]
    })
    expect(queryRows).toHaveBeenCalledTimes(2)
  })
})

function buildQuery(cacheScopeKey: string) {
  return {
    cacheScopeKey,
    connectionId: 'source-connection',
    database: 'app',
    table: 'users',
    page: 1,
    pageSize: 100,
    reloadToken: 0,
    orderBy: undefined
  }
}

function buildRowsResult(rows: Record<string, unknown>[]): QueryRowsResult {
  return {
    rows,
    total: rows.length,
    columns: [
      {
        name: 'id',
        type: 'int',
        nullable: false,
        defaultValue: null,
        isPrimaryKey: true,
        isAutoIncrement: true,
        comment: '',
        columnKey: 'PRI'
      },
      {
        name: 'name',
        type: 'varchar(255)',
        nullable: false,
        defaultValue: null,
        isPrimaryKey: false,
        isAutoIncrement: false,
        comment: '',
        columnKey: ''
      }
    ],
    primaryKey: ['id'],
    hasPrimaryKey: true
  }
}