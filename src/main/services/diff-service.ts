// 数据库结构对比：MVP 阶段只对比表 / 列 / 索引的存在与定义。
// 数据级 diff 留为第二阶段，可以新增 dataDiff 接口。
import type {
  ColumnDiff,
  ColumnInfo,
  DatabaseDiff,
  IndexDiff,
  IndexInfo,
  TableDiff
} from '../../shared/types'
import { dbService } from './db-service'

const TABLE_SCHEMA_DIFF_CONCURRENCY = 4

export class DiffService {
  async diffDatabases(
    sourceConnectionId: string,
    sourceDatabase: string,
    targetConnectionId: string,
    targetDatabase: string
  ): Promise<DatabaseDiff> {
    const [sDriver, tDriver] = await Promise.all([
      dbService.getDriver(sourceConnectionId),
      dbService.getDriver(targetConnectionId)
    ])
    const [sTables, tTables] = await Promise.all([
      sDriver.listTables(sourceDatabase),
      tDriver.listTables(targetDatabase)
    ])
    const all = Array.from(new Set([...sTables, ...tTables])).sort()
    const sourceTableSet = new Set(sTables)
    const targetTableSet = new Set(tTables)
    const tableDiffs = await mapWithConcurrencyLimit<string, TableDiff | null>(
      all,
      TABLE_SCHEMA_DIFF_CONCURRENCY,
      async (table) => {
        const inSource = sourceTableSet.has(table)
        const inTarget = targetTableSet.has(table)

        if (inSource && !inTarget) {
          return { table, kind: 'only-in-source', columnDiffs: [], indexDiffs: [] } satisfies TableDiff
        }

        if (!inSource && inTarget) {
          return { table, kind: 'only-in-target', columnDiffs: [], indexDiffs: [] } satisfies TableDiff
        }

        const [sourceSchema, targetSchema] = await Promise.all([
          sDriver.getTableSchema(sourceDatabase, table),
          tDriver.getTableSchema(targetDatabase, table)
        ])
        const columnDiffs = diffColumns(sourceSchema.columns, targetSchema.columns)
        const indexDiffs = diffIndexes(sourceSchema.indexes, targetSchema.indexes)

        if (columnDiffs.length === 0 && indexDiffs.length === 0) {
          return null
        }

        return { table, kind: 'modified', columnDiffs, indexDiffs } satisfies TableDiff
      }
    )

    return {
      sourceDatabase,
      targetDatabase,
      tableDiffs: tableDiffs.filter(isTableDiff)
    }
  }
}

function isTableDiff(tableDiff: TableDiff | null): tableDiff is TableDiff {
  return tableDiff !== null
}

async function mapWithConcurrencyLimit<T, TResult>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) return []

  const results = new Array<TResult>(items.length)
  const workerCount = Math.min(Math.max(concurrency, 1), items.length)
  let nextIndex = 0
  let firstError: unknown = undefined

  // 每个表会同时打到源库和目标库，限制并发可以避免把连接池瞬间打满。
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length && firstError === undefined) {
        const currentIndex = nextIndex
        nextIndex += 1
        const item = items[currentIndex]
        if (item === undefined) {
          return
        }
        try {
          results[currentIndex] = await mapper(item, currentIndex)
        } catch (error) {
          firstError = error
          return
        }
      }
    })
  )

  if (firstError !== undefined) {
    throw firstError
  }

  return results
}

function diffColumns(a: ColumnInfo[], b: ColumnInfo[]): ColumnDiff[] {
  const diffs: ColumnDiff[] = []
  const aMap = new Map(a.map((c) => [c.name, c]))
  const bMap = new Map(b.map((c) => [c.name, c]))
  for (const [name, src] of aMap) {
    const tgt = bMap.get(name)
    if (!tgt) {
      diffs.push({ name, kind: 'only-in-source', source: src })
    } else if (!sameColumn(src, tgt)) {
      diffs.push({ name, kind: 'modified', source: src, target: tgt })
    }
  }
  for (const [name, tgt] of bMap) {
    if (!aMap.has(name)) diffs.push({ name, kind: 'only-in-target', target: tgt })
  }
  return diffs
}

function sameColumn(a: ColumnInfo, b: ColumnInfo): boolean {
  return (
    a.type === b.type &&
    a.nullable === b.nullable &&
    (a.defaultValue ?? null) === (b.defaultValue ?? null) &&
    a.isPrimaryKey === b.isPrimaryKey &&
    a.isAutoIncrement === b.isAutoIncrement
  )
}

function diffIndexes(a: IndexInfo[], b: IndexInfo[]): IndexDiff[] {
  const diffs: IndexDiff[] = []
  const aMap = new Map(a.map((i) => [i.name, i]))
  const bMap = new Map(b.map((i) => [i.name, i]))
  for (const [name, src] of aMap) {
    const tgt = bMap.get(name)
    if (!tgt) diffs.push({ name, kind: 'only-in-source', source: src })
    else if (!sameIndex(src, tgt)) diffs.push({ name, kind: 'modified', source: src, target: tgt })
  }
  for (const [name, tgt] of bMap) {
    if (!aMap.has(name)) diffs.push({ name, kind: 'only-in-target', target: tgt })
  }
  return diffs
}

function sameIndex(a: IndexInfo, b: IndexInfo): boolean {
  return (
    a.unique === b.unique &&
    a.type === b.type &&
    a.columns.length === b.columns.length &&
    a.columns.every((c, i) => c === b.columns[i])
  )
}

export const diffService = new DiffService()
