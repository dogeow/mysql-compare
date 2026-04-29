import { api, unwrap } from '@renderer/lib/api'
import type { QueryRowsResult } from '../../../shared/types'

const comparedTableDataCache = new Map<string, QueryRowsResult>()
const pendingComparedTableRequests = new Map<string, Promise<QueryRowsResult>>()

const MAX_CACHED_RESULTS = 96

export interface ComparedTableRowsQuery {
  cacheScopeKey: string
  connectionId: string
  database: string
  table: string
  page: number
  pageSize: number
  reloadToken: number
  orderBy?: { column: string; dir: 'ASC' | 'DESC' }
}

interface PrefetchComparedTablesOptions {
  cacheScopeKey: string
  sourceConnectionId: string
  sourceDatabase: string
  sourceReloadToken: number
  targetConnectionId: string
  targetDatabase: string
  targetReloadToken: number
  tables: string[]
  page: number
  pageSize: number
}

export function getCachedComparedTableData(query: ComparedTableRowsQuery): QueryRowsResult | undefined {
  return comparedTableDataCache.get(buildComparedTableQueryKey(query))
}

export async function fetchComparedTableData(query: ComparedTableRowsQuery): Promise<QueryRowsResult> {
  const cacheKey = buildComparedTableQueryKey(query)
  const cached = comparedTableDataCache.get(cacheKey)
  if (cached) return cached

  const pending = pendingComparedTableRequests.get(cacheKey)
  if (pending) return pending

  const request = unwrap<QueryRowsResult>(
    api.db.queryRows({
      connectionId: query.connectionId,
      database: query.database,
      table: query.table,
      page: query.page,
      pageSize: query.pageSize,
      orderBy: query.orderBy
    })
  )
    .then((data) => {
      comparedTableDataCache.set(cacheKey, data)
      trimComparedTableDataCache()
      return data
    })
    .finally(() => {
      pendingComparedTableRequests.delete(cacheKey)
    })

  pendingComparedTableRequests.set(cacheKey, request)
  return request
}

export async function prefetchComparedTables(options: PrefetchComparedTablesOptions): Promise<void> {
  for (const table of options.tables) {
    const sourceQuery: ComparedTableRowsQuery = {
      cacheScopeKey: options.cacheScopeKey,
      connectionId: options.sourceConnectionId,
      database: options.sourceDatabase,
      table,
      page: options.page,
      pageSize: options.pageSize,
      reloadToken: options.sourceReloadToken
    }
    const targetQuery: ComparedTableRowsQuery = {
      cacheScopeKey: options.cacheScopeKey,
      connectionId: options.targetConnectionId,
      database: options.targetDatabase,
      table,
      page: options.page,
      pageSize: options.pageSize,
      reloadToken: options.targetReloadToken
    }

    const [sourceData, targetData] = await Promise.all([
      fetchComparedTableData(sourceQuery),
      fetchComparedTableData(targetQuery)
    ])

    const sharedOrderBy = resolveSharedStableOrderBy(sourceData, targetData)
    if (!sharedOrderBy) continue

    await Promise.all([
      fetchComparedTableData({ ...sourceQuery, orderBy: sharedOrderBy }),
      fetchComparedTableData({ ...targetQuery, orderBy: sharedOrderBy })
    ])
  }
}

function buildComparedTableQueryKey(query: ComparedTableRowsQuery): string {
  return JSON.stringify([
    query.cacheScopeKey,
    query.connectionId,
    query.database,
    query.table,
    query.page,
    query.pageSize,
    query.reloadToken,
    query.orderBy?.column ?? null,
    query.orderBy?.dir ?? null
  ])
}

function resolveSharedStableOrderBy(
  sourceData: QueryRowsResult,
  targetData: QueryRowsResult
): { column: string; dir: 'ASC' } | undefined {
  const targetPrimaryKey = new Set(targetData.primaryKey)
  const sharedPrimaryKey = sourceData.primaryKey.find((column) => targetPrimaryKey.has(column))
  return sharedPrimaryKey ? { column: sharedPrimaryKey, dir: 'ASC' } : undefined
}

function trimComparedTableDataCache(): void {
  while (comparedTableDataCache.size > MAX_CACHED_RESULTS) {
    const oldestKey = comparedTableDataCache.keys().next().value
    if (!oldestKey) return
    comparedTableDataCache.delete(oldestKey)
  }
}