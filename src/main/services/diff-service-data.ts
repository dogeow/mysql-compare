import type {
  ColumnInfo,
  TableDataDiff,
  TableDataDiffSample
} from '../../shared/types'
import type { DbDriver } from './drivers/types'

const DATA_DIFF_BATCH_SIZE = 200
const DATA_DIFF_SAMPLE_LIMIT = 5

export async function diffTableData(params: {
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