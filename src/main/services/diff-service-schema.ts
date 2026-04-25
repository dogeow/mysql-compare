import type {
  ColumnDiff,
  ColumnInfo,
  DbEngine,
  IndexDiff,
  IndexInfo
} from '../../shared/types'

export function diffColumns(
  sourceColumns: ColumnInfo[],
  targetColumns: ColumnInfo[],
  sourceEngine: DbEngine,
  targetEngine: DbEngine
): ColumnDiff[] {
  const diffs: ColumnDiff[] = []
  const sourceMap = new Map(sourceColumns.map((column) => [column.name, column]))
  const targetMap = new Map(targetColumns.map((column) => [column.name, column]))

  for (const [name, sourceColumn] of sourceMap) {
    const targetColumn = targetMap.get(name)
    if (!targetColumn) {
      diffs.push({ name, kind: 'only-in-source', source: sourceColumn })
    } else if (!sameColumn(sourceColumn, targetColumn, sourceEngine, targetEngine)) {
      diffs.push({ name, kind: 'modified', source: sourceColumn, target: targetColumn })
    }
  }

  for (const [name, targetColumn] of targetMap) {
    if (!sourceMap.has(name)) {
      diffs.push({ name, kind: 'only-in-target', target: targetColumn })
    }
  }

  return diffs
}

function sameColumn(
  sourceColumn: ColumnInfo,
  targetColumn: ColumnInfo,
  sourceEngine: DbEngine,
  targetEngine: DbEngine
): boolean {
  return (
    sameColumnType(sourceColumn.type, targetColumn.type, sourceEngine, targetEngine) &&
    sourceColumn.nullable === targetColumn.nullable &&
    sameColumnDefault(sourceColumn, targetColumn, sourceEngine, targetEngine) &&
    sourceColumn.isPrimaryKey === targetColumn.isPrimaryKey &&
    sourceColumn.isAutoIncrement === targetColumn.isAutoIncrement
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
  sourceColumn: ColumnInfo,
  targetColumn: ColumnInfo,
  sourceEngine: DbEngine,
  targetEngine: DbEngine
): boolean {
  const sourceDefault = normalizeDefaultValue(sourceColumn, sourceEngine)
  const targetDefault = normalizeDefaultValue(targetColumn, targetEngine)
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
  return type === 'text' || type.startsWith('varchar(') || type.startsWith('char(')
}

export function diffIndexes(sourceIndexes: IndexInfo[], targetIndexes: IndexInfo[]): IndexDiff[] {
  const diffs: IndexDiff[] = []
  const sourceMap = new Map(sourceIndexes.map((index) => [index.name, index]))
  const targetMap = new Map(targetIndexes.map((index) => [index.name, index]))

  for (const [name, sourceIndex] of sourceMap) {
    const targetIndex = targetMap.get(name)
    if (!targetIndex) {
      diffs.push({ name, kind: 'only-in-source', source: sourceIndex })
    } else if (!sameIndex(sourceIndex, targetIndex)) {
      diffs.push({ name, kind: 'modified', source: sourceIndex, target: targetIndex })
    }
  }

  for (const [name, targetIndex] of targetMap) {
    if (!sourceMap.has(name)) {
      diffs.push({ name, kind: 'only-in-target', target: targetIndex })
    }
  }

  return diffs
}

function sameIndex(sourceIndex: IndexInfo, targetIndex: IndexInfo): boolean {
  return (
    sourceIndex.unique === targetIndex.unique &&
    sourceIndex.type === targetIndex.type &&
    sourceIndex.columns.length === targetIndex.columns.length &&
    sourceIndex.columns.every((column, index) => column === targetIndex.columns[index])
  )
}