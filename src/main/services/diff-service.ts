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
import { schemaService } from './schema-service'

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
    const tableDiffs: TableDiff[] = []
    for (const table of all) {
      const inS = sTables.includes(table)
      const inT = tTables.includes(table)
      if (inS && !inT) {
        tableDiffs.push({ table, kind: 'only-in-source', columnDiffs: [], indexDiffs: [] })
        continue
      }
      if (!inS && inT) {
        tableDiffs.push({ table, kind: 'only-in-target', columnDiffs: [], indexDiffs: [] })
        continue
      }
      const [sSchema, tSchema] = await Promise.all([
        schemaService.getTableSchema(sourceConnectionId, sourceDatabase, table),
        schemaService.getTableSchema(targetConnectionId, targetDatabase, table)
      ])
      const columnDiffs = diffColumns(sSchema.columns, tSchema.columns)
      const indexDiffs = diffIndexes(sSchema.indexes, tSchema.indexes)
      const kind = columnDiffs.length === 0 && indexDiffs.length === 0
        ? 'modified' // 实际相同; 调用方可根据 diffs 是否为空判断
        : 'modified'
      // 仅当有差异才加入
      if (columnDiffs.length > 0 || indexDiffs.length > 0) {
        tableDiffs.push({ table, kind, columnDiffs, indexDiffs })
      }
    }

    return { sourceDatabase, targetDatabase, tableDiffs }
  }
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
