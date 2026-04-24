// 纯展示用的格式化工具，从 DiffPanel.tsx 抽出，便于复用与单元测试。
import type { TableDataDiff } from '../../../shared/types'

export type ComparePhase = 'idle' | 'loading-tables' | 'comparing' | 'done'

export function formatComparePhase(
  phase: ComparePhase,
  completedSharedTableCount: number,
  sharedTableCount: number,
  pendingSharedTable?: string
): string {
  if (phase === 'loading-tables') return 'Loading source and target table lists...'
  if (phase === 'comparing') {
    const base = `Comparing ${completedSharedTableCount}/${sharedTableCount} shared table(s)...`
    return pendingSharedTable ? `${base} Pending: ${pendingSharedTable}` : base
  }
  if (phase === 'done') {
    return sharedTableCount === 0
      ? 'Only source-only/target-only tables were found. Results are ready.'
      : `Compared ${completedSharedTableCount}/${sharedTableCount} shared table(s).`
  }
  return 'Ready to compare.'
}

export function formatCompareButtonLabel(
  phase: ComparePhase,
  completedSharedTableCount: number,
  sharedTableCount: number
): string {
  if (phase === 'loading-tables') return 'Loading tables...'
  if (phase === 'comparing') return `Comparing ${completedSharedTableCount}/${sharedTableCount}`
  return 'Compare'
}

export function formatCompareSetupSummary({
  sourceConnectionName,
  sourceDatabase,
  targetConnectionName,
  targetDatabase,
  compareData
}: {
  sourceConnectionName?: string
  sourceDatabase: string
  targetConnectionName?: string
  targetDatabase: string
  compareData: boolean
}): string {
  if (!sourceConnectionName && !targetConnectionName && !sourceDatabase && !targetDatabase) {
    return 'Choose source and target connections before running Compare.'
  }

  const sourceLabel = [sourceConnectionName, sourceDatabase].filter(Boolean).join(' / ') || 'Source pending'
  const targetLabel = [targetConnectionName, targetDatabase].filter(Boolean).join(' / ') || 'Target pending'

  return `${sourceLabel} -> ${targetLabel} · row comparison ${compareData ? 'on' : 'off'}`
}

export function formatEndpointSelectionSummary(
  connectionName: string | undefined,
  database: string,
  fallback: string
): string {
  const parts = [connectionName, database].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : fallback
}

export function buildDatabaseOptions(connectionId: string, databases: string[], loading: boolean) {
  if (!connectionId) {
    return [{ value: '', label: 'Select connection first' }]
  }
  if (loading) {
    return [{ value: '', label: 'Loading databases...' }]
  }
  return [
    { value: '', label: '— select —' },
    ...databases.map((database) => ({ value: database, label: database }))
  ]
}

export function formatColumnLine(
  c: { name: string; type: string; nullable: boolean } | undefined,
  kind: string,
  side: string
): string | null {
  if (!c) return null
  if (kind === 'only-in-source' && side === 'target') return null
  if (kind === 'only-in-target' && side === 'source') return null
  return `${c.name}  ${c.type}  ${c.nullable ? 'NULL' : 'NOT NULL'}`
}

export function formatIndexLine(
  i: { name: string; columns: string[]; unique: boolean } | undefined,
  kind: string,
  side: string
): string | null {
  if (!i) return null
  if (kind === 'only-in-source' && side === 'target') return null
  if (kind === 'only-in-target' && side === 'source') return null
  return `${i.unique ? 'UNIQUE ' : ''}${i.name} (${i.columns.join(', ')})`
}

export function formatDataSummary(dataDiff: TableDataDiff): string {
  if (!dataDiff.comparable) return 'row compare skipped'
  const totalDiffs = dataDiff.sourceOnly + dataDiff.targetOnly + dataDiff.modified
  return totalDiffs === 0 ? 'rows identical' : `${totalDiffs} row diff(s)`
}
