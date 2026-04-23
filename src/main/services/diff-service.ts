// 数据库结构对比：MVP 阶段只对比表 / 列 / 索引的存在与定义。
// 数据级 diff 留为第二阶段，可以新增 dataDiff 接口。
import type {
  ColumnDiff,
  ColumnInfo,
  DbEngine,
  DatabaseDiff,
  IndexDiff,
  IndexInfo,
  TableDataDiff,
  TableDataDiffSample,
  TableRowComparison,
  TableDiff
} from '../../shared/types'
import { dbService } from './db-service'
import type { DbDriver } from './drivers/types'

const TABLE_SCHEMA_DIFF_CONCURRENCY = 4
const DATA_DIFF_BATCH_SIZE = 200
const DATA_DIFF_SAMPLE_LIMIT = 5

export class DiffService {
  async diffTable(
    sourceConnectionId: string,
    sourceDatabase: string,
    targetConnectionId: string,
    targetDatabase: string,
    table: string,
    includeData = false
  ): Promise<{ tableDiff: TableDiff | null; rowComparison: TableRowComparison | null }> {
    const [sourceDriver, targetDriver] = await Promise.all([
      dbService.getDriver(sourceConnectionId),
      dbService.getDriver(targetConnectionId)
    ])

    return compareSharedTable({
      sourceDriver,
      sourceDatabase,
      targetDriver,
      targetDatabase,
      table,
      includeData
    })
  }

  async diffDatabases(
    sourceConnectionId: string,
    sourceDatabase: string,
    targetConnectionId: string,
    targetDatabase: string,
    includeData = false,
    tables?: string[]
  ): Promise<DatabaseDiff> {
    const [sDriver, tDriver] = await Promise.all([
      dbService.getDriver(sourceConnectionId),
      dbService.getDriver(targetConnectionId)
    ])
    const [sTables, tTables] = await Promise.all([
      sDriver.listTables(sourceDatabase),
      tDriver.listTables(targetDatabase)
    ])
    const all = (tables && tables.length > 0)
      ? Array.from(new Set(tables)).sort()
      : Array.from(new Set([...sTables, ...tTables])).sort()
    const sourceTableSet = new Set(sTables)
    const targetTableSet = new Set(tTables)
    const results = await mapWithConcurrencyLimit<
      string,
      { tableDiff: TableDiff | null; rowComparison: TableRowComparison | null }
    >(
      all,
      TABLE_SCHEMA_DIFF_CONCURRENCY,
      async (table) => {
        const inSource = sourceTableSet.has(table)
        const inTarget = targetTableSet.has(table)

        if (inSource && !inTarget) {
          return {
            tableDiff: { table, kind: 'only-in-source', columnDiffs: [], indexDiffs: [] } satisfies TableDiff,
            rowComparison: null
          }
        }

        if (!inSource && inTarget) {
          return {
            tableDiff: { table, kind: 'only-in-target', columnDiffs: [], indexDiffs: [] } satisfies TableDiff,
            rowComparison: null
          }
        }

        if (!inSource && !inTarget) {
          return {
            tableDiff: null,
            rowComparison: null
          }
        }

        return compareSharedTable({
          sourceDriver: sDriver,
          sourceDatabase,
          targetDriver: tDriver,
          targetDatabase,
          table,
          includeData
        })
      }
    )

    return {
      sourceDatabase,
      targetDatabase,
      tableDiffs: results.map((result) => result.tableDiff).filter(isTableDiff),
      rowComparisons: results.map((result) => result.rowComparison).filter(isRowComparison)
    }
  }
}

async function compareSharedTable(params: {
  sourceDriver: DbDriver
  sourceDatabase: string
  targetDriver: DbDriver
  targetDatabase: string
  table: string
  includeData: boolean
}): Promise<{ tableDiff: TableDiff | null; rowComparison: TableRowComparison | null }> {
  const [sourceSchema, targetSchema] = await Promise.all([
    params.sourceDriver.getTableSchema(params.sourceDatabase, params.table),
    params.targetDriver.getTableSchema(params.targetDatabase, params.table)
  ])
  const columnDiffs = diffColumns(
    sourceSchema.columns,
    targetSchema.columns,
    params.sourceDriver.engine,
    params.targetDriver.engine
  )
  const indexDiffs = diffIndexes(sourceSchema.indexes, targetSchema.indexes)
  const dataDiff = params.includeData
    ? await diffTableData({
        sourceDriver: params.sourceDriver,
        sourceDatabase: params.sourceDatabase,
        sourceSchema,
        targetDriver: params.targetDriver,
        targetDatabase: params.targetDatabase,
        targetSchema,
        table: params.table
      })
    : undefined

  const rowComparison = dataDiff
    ? ({ table: params.table, dataDiff } satisfies TableRowComparison)
    : null

  if (columnDiffs.length === 0 && indexDiffs.length === 0 && !hasMeaningfulDataDiff(dataDiff)) {
    return {
      tableDiff: null,
      rowComparison
    }
  }

  return {
    tableDiff: {
      table: params.table,
      kind: 'modified',
      columnDiffs,
      indexDiffs,
      dataDiff
    } satisfies TableDiff,
    rowComparison
  }
}

function isTableDiff(tableDiff: TableDiff | null): tableDiff is TableDiff {
  return tableDiff !== null
}

function isRowComparison(
  rowComparison: TableRowComparison | null
): rowComparison is TableRowComparison {
  return rowComparison !== null
}

function hasMeaningfulDataDiff(dataDiff?: TableDataDiff): boolean {
  if (!dataDiff?.comparable) return false
  return dataDiff.sourceOnly > 0 || dataDiff.targetOnly > 0 || dataDiff.modified > 0
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

function diffColumns(
  a: ColumnInfo[],
  b: ColumnInfo[],
  sourceEngine: DbEngine,
  targetEngine: DbEngine
): ColumnDiff[] {
  const diffs: ColumnDiff[] = []
  const aMap = new Map(a.map((c) => [c.name, c]))
  const bMap = new Map(b.map((c) => [c.name, c]))
  for (const [name, src] of aMap) {
    const tgt = bMap.get(name)
    if (!tgt) {
      diffs.push({ name, kind: 'only-in-source', source: src })
    } else if (!sameColumn(src, tgt, sourceEngine, targetEngine)) {
      diffs.push({ name, kind: 'modified', source: src, target: tgt })
    }
  }
  for (const [name, tgt] of bMap) {
    if (!aMap.has(name)) diffs.push({ name, kind: 'only-in-target', target: tgt })
  }
  return diffs
}

function sameColumn(
  a: ColumnInfo,
  b: ColumnInfo,
  sourceEngine: DbEngine,
  targetEngine: DbEngine
): boolean {
  return (
    sameColumnType(a.type, b.type, sourceEngine, targetEngine) &&
    a.nullable === b.nullable &&
    sameColumnDefault(a, b, sourceEngine, targetEngine) &&
    a.isPrimaryKey === b.isPrimaryKey &&
    a.isAutoIncrement === b.isAutoIncrement
  )
}

function sameColumnType(
  sourceType: string,
  targetType: string,
  sourceEngine: DbEngine,
  targetEngine: DbEngine
): boolean {
  if (sourceType === targetType) return true

  const normalizedSource = normalizeColumnType(sourceType, sourceEngine)
  const normalizedTarget = normalizeColumnType(targetType, targetEngine)
  if (normalizedSource === normalizedTarget) return true

  return isCompatibleCrossEngineType(
    sourceType,
    targetType,
    normalizedSource,
    normalizedTarget,
    sourceEngine,
    targetEngine
  )
}

function sameColumnDefault(
  source: ColumnInfo,
  target: ColumnInfo,
  sourceEngine: DbEngine,
  targetEngine: DbEngine
): boolean {
  const sourceDefault = normalizeDefaultValue(source, sourceEngine)
  const targetDefault = normalizeDefaultValue(target, targetEngine)
  return sourceDefault === targetDefault
}

function normalizeColumnType(type: string, engine: DbEngine): string {
  const normalized = type.trim().toLowerCase().replace(/\s+/g, ' ')

  const timestampWithoutTimeZoneMatch = normalized.match(
    /^(?:timestamp|datetime)(?:\((\d+)\))?(?: without time zone)?$/
  )
  if (timestampWithoutTimeZoneMatch) {
    const precision = timestampWithoutTimeZoneMatch[1]
    return precision ? `timestamp(${precision})` : 'timestamp'
  }

  const timestampWithTimeZoneMatch = normalized.match(
    /^(?:timestamp(?:\((\d+)\))? with time zone|timestamptz(?:\((\d+)\))?)$/
  )
  if (timestampWithTimeZoneMatch) {
    const precision = timestampWithTimeZoneMatch[1] ?? timestampWithTimeZoneMatch[2]
    return precision ? `timestamptz(${precision})` : 'timestamptz'
  }

  const timeWithoutTimeZoneMatch = normalized.match(
    /^time(?:\((\d+)\))?(?: without time zone)?$/
  )
  if (timeWithoutTimeZoneMatch) {
    const precision = timeWithoutTimeZoneMatch[1]
    return precision ? `time(${precision})` : 'time'
  }

  const dateTimeAliases = new Map<string, string>([
    ['date', 'date'],
    ['uuid', 'uuid'],
    ['json', 'json'],
    ['jsonb', 'jsonb']
  ])
  const exactAlias = dateTimeAliases.get(normalized)
  if (exactAlias) return exactAlias

  if (normalized === 'bool' || normalized === 'boolean' || normalized === 'tinyint(1)') {
    return 'boolean'
  }
  if (
    normalized === 'text' ||
    normalized === 'tinytext' ||
    normalized === 'mediumtext' ||
    normalized === 'longtext'
  ) {
    return 'text'
  }
  if (
    normalized === 'blob' ||
    normalized === 'tinyblob' ||
    normalized === 'mediumblob' ||
    normalized === 'longblob' ||
    normalized === 'bytea'
  ) {
    return 'bytea'
  }

  const varcharMatch = normalized.match(/^(?:varchar|character varying)\((\d+)\)$/)
  if (varcharMatch) {
    return `varchar(${varcharMatch[1]})`
  }

  const charMatch = normalized.match(/^(?:char|character)\((\d+)\)$/)
  if (charMatch) {
    return `char(${charMatch[1]})`
  }

  const decimalMatch = normalized.match(/^(?:decimal|numeric)(?:\((\d+)(?:,\s*(\d+))?\))?$/)
  if (decimalMatch) {
    const precision = decimalMatch[1]
    const scale = decimalMatch[2]
    if (!precision) return 'numeric'
    return scale ? `numeric(${precision},${scale})` : `numeric(${precision})`
  }

  if (
    normalized === 'bigint unsigned' ||
    normalized === 'bigint' ||
    normalized === 'bigserial'
  ) {
    return 'bigint'
  }
  if (
    normalized === 'int unsigned' ||
    normalized === 'integer unsigned' ||
    normalized === 'integer' ||
    normalized === 'int' ||
    normalized === 'serial'
  ) {
    return 'integer'
  }
  if (
    normalized === 'smallint unsigned' ||
    normalized === 'smallint' ||
    normalized === 'smallserial'
  ) {
    return 'smallint'
  }
  if (normalized === 'double precision' || normalized === 'double') {
    return 'double'
  }
  if (normalized === 'real' || normalized === 'float') {
    return 'float'
  }

  return normalized
}

function isCompatibleCrossEngineType(
  sourceType: string,
  targetType: string,
  normalizedSource: string,
  normalizedTarget: string,
  sourceEngine: DbEngine,
  targetEngine: DbEngine
): boolean {
  if (sourceEngine === targetEngine) return false

  if (
    (normalizedSource === 'json' && normalizedTarget === 'jsonb') ||
    (normalizedSource === 'jsonb' && normalizedTarget === 'json')
  ) {
    return true
  }

  const sourceIsEnum = isEnumType(sourceType)
  const targetIsEnum = isEnumType(targetType)
  if (sourceIsEnum && isStringLikeType(normalizedTarget)) return true
  if (targetIsEnum && isStringLikeType(normalizedSource)) return true

  return false
}

function normalizeDefaultValue(column: ColumnInfo, engine: DbEngine): string | null {
  if (column.isAutoIncrement) return '<auto>'
  if (column.defaultValue === null || column.defaultValue === undefined) return null

  let normalized = column.defaultValue.trim().toLowerCase()
  if (!normalized) return null

  normalized = stripWrappingParens(normalized)
  normalized = normalized.replace(/\s+/g, ' ')
  normalized = normalized.replace(/::[\w\s."[\]]+/g, '')
  normalized = stripWrappingParens(normalized)

  if (normalized === 'null') return null
  if (
    normalized === 'current_timestamp' ||
    normalized === 'current_timestamp()' ||
    normalized === 'now()' ||
    normalized === 'localtimestamp' ||
    normalized === 'localtimestamp()'
  ) {
    return 'current_timestamp'
  }

  const currentTimestampPrecision = normalized.match(
    /^(?:current_timestamp|localtimestamp)\((\d+)\)$/
  )
  if (currentTimestampPrecision) {
    return currentTimestampPrecision[1] === '0'
      ? 'current_timestamp'
      : `current_timestamp(${currentTimestampPrecision[1]})`
  }

  if (normalized === 'true' || normalized === '1') return 'true'
  if (normalized === 'false' || normalized === '0') return 'false'

  const quotedLiteralMatch = normalized.match(/^'(.*)'$/)
  if (quotedLiteralMatch) {
    normalized = quotedLiteralMatch[1]!.replace(/''/g, "'")
  } else if (engine === 'mysql') {
    normalized = normalized.replace(/^"(.*)"$/, '$1')
  }

  if (normalized === 'true' || normalized === '1') return 'true'
  if (normalized === 'false' || normalized === '0') return 'false'

  return normalized
}

function stripWrappingParens(value: string): string {
  let current = value.trim()
  while (current.startsWith('(') && current.endsWith(')')) {
    current = current.slice(1, -1).trim()
  }
  return current
}

function isEnumType(type: string): boolean {
  return /^enum\s*\(/i.test(type.trim())
}

function isStringLikeType(type: string): boolean {
  return (
    type === 'text' ||
    type.startsWith('varchar(') ||
    type.startsWith('char(')
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

async function diffTableData(params: {
  sourceDriver: DbDriver
  sourceDatabase: string
  sourceSchema: { columns: ColumnInfo[]; primaryKey: string[] }
  targetDriver: DbDriver
  targetDatabase: string
  targetSchema: { columns: ColumnInfo[]; primaryKey: string[] }
  table: string
}): Promise<TableDataDiff> {
  const compareColumns = params.sourceSchema.columns
    .map((column) => column.name)
    .filter((name) => params.targetSchema.columns.some((column) => column.name === name))
  if (compareColumns.length === 0) {
    return {
      comparable: false,
      reason: 'No shared columns available for row comparison',
      keyColumns: [],
      compareColumns: [],
      sourceRowCount: 0,
      targetRowCount: 0,
      sourceOnly: 0,
      targetOnly: 0,
      modified: 0,
      identical: 0,
      samples: []
    }
  }

  const { keyColumns, reason } = resolveKeyColumns(
    params.sourceSchema.primaryKey,
    params.targetSchema.primaryKey,
    compareColumns
  )

  const sourceRows = flattenRowBatches(
    params.sourceDriver.streamRows({
      database: params.sourceDatabase,
      table: params.table,
      columns: compareColumns,
      primaryKey: keyColumns,
      batchSize: DATA_DIFF_BATCH_SIZE
    })
  )
  const targetRows = flattenRowBatches(
    params.targetDriver.streamRows({
      database: params.targetDatabase,
      table: params.table,
      columns: compareColumns,
      primaryKey: keyColumns,
      batchSize: DATA_DIFF_BATCH_SIZE
    })
  )

  const samples: TableDataDiffSample[] = []
  let identical = 0
  let modified = 0
  let sourceOnly = 0
  let targetOnly = 0
  let sourceRowCount = 0
  let targetRowCount = 0

  let sourceNext = await sourceRows.next()
  let targetNext = await targetRows.next()

  while (!sourceNext.done || !targetNext.done) {
    if (sourceNext.done) {
      const row = createComparableRow(targetNext.value, keyColumns, compareColumns)
      targetOnly += 1
      targetRowCount += 1
      pushSample(samples, { kind: 'only-in-target', key: row.keyLabel, target: row.values })
      targetNext = await targetRows.next()
      continue
    }

    if (targetNext.done) {
      const row = createComparableRow(sourceNext.value, keyColumns, compareColumns)
      sourceOnly += 1
      sourceRowCount += 1
      pushSample(samples, { kind: 'only-in-source', key: row.keyLabel, source: row.values })
      sourceNext = await sourceRows.next()
      continue
    }

    const sourceRow = createComparableRow(sourceNext.value, keyColumns, compareColumns)
    const targetRow = createComparableRow(targetNext.value, keyColumns, compareColumns)
    const keyCompare = compareKeyParts(sourceRow.keyParts, targetRow.keyParts)

    if (keyCompare === 0) {
      sourceRowCount += 1
      targetRowCount += 1

      if (sourceRow.signature === targetRow.signature) {
        identical += 1
      } else {
        modified += 1
        pushSample(samples, {
          kind: 'modified',
          key: sourceRow.keyLabel,
          source: sourceRow.values,
          target: targetRow.values
        })
      }

      sourceNext = await sourceRows.next()
      targetNext = await targetRows.next()
      continue
    }

    if (keyCompare < 0) {
      sourceOnly += 1
      sourceRowCount += 1
      pushSample(samples, { kind: 'only-in-source', key: sourceRow.keyLabel, source: sourceRow.values })
      sourceNext = await sourceRows.next()
      continue
    }

    targetOnly += 1
    targetRowCount += 1
    pushSample(samples, { kind: 'only-in-target', key: targetRow.keyLabel, target: targetRow.values })
    targetNext = await targetRows.next()
  }

  return {
    comparable: true,
    reason,
    keyColumns,
    compareColumns,
    sourceRowCount,
    targetRowCount,
    sourceOnly,
    targetOnly,
    modified,
    identical,
    samples
  }
}

function resolveKeyColumns(
  sourcePrimaryKey: string[],
  targetPrimaryKey: string[],
  compareColumns: string[]
): { keyColumns: string[]; reason?: string } {
  const compareSet = new Set(compareColumns)
  const sourcePk = sourcePrimaryKey.filter((column) => compareSet.has(column))
  const targetPk = targetPrimaryKey.filter((column) => compareSet.has(column))

  if (sourcePk.length > 0 && sameColumnSet(sourcePk, targetPk)) {
    return { keyColumns: sourcePk }
  }

  if (sourcePk.length > 0) {
    return {
      keyColumns: sourcePk,
      reason: 'Target primary key differs, matched rows by source primary key columns'
    }
  }

  if (targetPk.length > 0) {
    return {
      keyColumns: targetPk,
      reason: 'Source primary key differs, matched rows by target primary key columns'
    }
  }

  return {
    keyColumns: compareColumns,
    reason: 'No shared primary key, matched rows by all shared columns'
  }
}

function sameColumnSet(source: string[], target: string[]): boolean {
  if (source.length !== target.length) return false
  const targetSet = new Set(target)
  return source.every((column) => targetSet.has(column))
}

async function* flattenRowBatches(
  batches: AsyncIterable<Record<string, unknown>[]>
): AsyncGenerator<Record<string, unknown>> {
  for await (const batch of batches) {
    for (const row of batch) {
      yield row
    }
  }
}

function createComparableRow(
  row: Record<string, unknown>,
  keyColumns: string[],
  compareColumns: string[]
): {
  keyParts: unknown[]
  keyLabel: string
  signature: string
  values: Record<string, unknown>
} {
  const values: Record<string, unknown> = {}
  for (const column of compareColumns) {
    values[column] = normalizeValue(row[column])
  }

  const keyParts = keyColumns.map((column) => values[column])
  const keyLabel = keyColumns.map((column) => `${column}=${formatPreviewValue(values[column])}`).join(', ')
  const signature = compareColumns
    .map((column) => `${column}:${serializeComparableValue(values[column])}`)
    .join('\u0001')

  return { keyParts, keyLabel, signature, values }
}

function pushSample(samples: TableDataDiffSample[], sample: TableDataDiffSample): void {
  if (samples.length >= DATA_DIFF_SAMPLE_LIMIT) return
  samples.push(sample)
}

function compareKeyParts(source: unknown[], target: unknown[]): number {
  const length = Math.min(source.length, target.length)
  for (let index = 0; index < length; index += 1) {
    const compared = compareComparableValues(source[index], target[index])
    if (compared !== 0) return compared
  }
  if (source.length === target.length) return 0
  return source.length < target.length ? -1 : 1
}

function compareComparableValues(source: unknown, target: unknown): number {
  if (source === target) return 0
  if (source === null) return -1
  if (target === null) return 1

  const sourceType = comparableTypeRank(source)
  const targetType = comparableTypeRank(target)
  if (sourceType !== targetType) {
    return sourceType < targetType ? -1 : 1
  }

  if (typeof source === 'number' && typeof target === 'number') {
    return source < target ? -1 : 1
  }

  if (typeof source === 'boolean' && typeof target === 'boolean') {
    return source ? 1 : -1
  }

  const sourceText = serializeComparableValue(source)
  const targetText = serializeComparableValue(target)
  if (sourceText === targetText) return 0
  return sourceText < targetText ? -1 : 1
}

function comparableTypeRank(value: unknown): number {
  if (value === null) return 0
  if (typeof value === 'number') return 1
  if (typeof value === 'boolean') return 2
  if (typeof value === 'string') return 3
  return 4
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return normalizeTemporalString(value)
  if (value instanceof Date) return formatDateTime(value)
  if (Buffer.isBuffer(value)) return { type: 'buffer', hex: value.toString('hex') }
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item))
  if (typeof value === 'object') return sortObjectKeys(value as Record<string, unknown>)
  return String(value)
}

function normalizeTemporalString(value: string): string {
  const trimmed = value.trim()
  const dateOnlyMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/)
  if (dateOnlyMatch) return dateOnlyMatch[1]!

  const dateTimeMatch = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:?\d{2})?$/
  )
  if (!dateTimeMatch) return trimmed

  const milliseconds = dateTimeMatch[3] ? `.${dateTimeMatch[3]!.slice(0, 3)}` : ''
  return `${dateTimeMatch[1]!} ${dateTimeMatch[2]!}${milliseconds}`
}

function formatDateTime(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  const hour = String(value.getHours()).padStart(2, '0')
  const minute = String(value.getMinutes()).padStart(2, '0')
  const second = String(value.getSeconds()).padStart(2, '0')
  const millisecond = value.getMilliseconds()
  const fraction = millisecond > 0 ? `.${String(millisecond).padStart(3, '0')}` : ''
  return `${year}-${month}-${day} ${hour}:${minute}:${second}${fraction}`
}

function sortObjectKeys(value: Record<string, unknown>): Record<string, unknown> {
  const sortedEntries = Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entryValue]) => [key, normalizeValue(entryValue)])
  return Object.fromEntries(sortedEntries)
}

function serializeComparableValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function formatPreviewValue(value: unknown): string {
  if (value === null) return 'NULL'
  const serialized = serializeComparableValue(value)
  return serialized.length > 80 ? `${serialized.slice(0, 77)}...` : serialized
}

export const diffService = new DiffService()
