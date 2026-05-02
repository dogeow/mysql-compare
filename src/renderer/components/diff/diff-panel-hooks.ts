import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { api, unwrap } from '@renderer/lib/api'
import type { Translator } from '@renderer/i18n'
import type { TableComparisonResult } from '../../../shared/types'
import type { ComparePhase } from './diff-panel-formatters'
import {
  buildInitialComparisonEntries,
  DIFF_PANEL_PREFERENCES_KEY,
  parseDiffPanelPreferences,
  runWithConcurrencyLimit,
  updateTableEntry,
  type DiffPanelPreferences,
  type TableCompareEntry
} from './diff-panel-utils'
import { requestTableComparison, supportsIncrementalTableDiff } from './table-diff-request'

type ToastLevel = 'info' | 'error' | 'success'
type ShowToast = (message: string, level?: ToastLevel) => void

export interface CompareContext {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  compareData: boolean
}

interface UseDiffComparisonArgs {
  sourceConnectionId: string
  sourceDatabase: string
  targetConnectionId: string
  targetDatabase: string
  compareData: boolean
  tableCompareConcurrency: number
  showToast: ShowToast
  t: Translator
  onBeforeCompare?: () => void
}

interface UseDiffComparisonResult {
  comparePhase: ComparePhase
  compareContext: CompareContext | null
  sourceTables: string[]
  targetTables: string[]
  comparisonEntries: TableCompareEntry[]
  showSync: boolean
  setShowSync: Dispatch<SetStateAction<boolean>>
  showAllRowComparisons: boolean
  setShowAllRowComparisons: Dispatch<SetStateAction<boolean>>
  runCompare: () => Promise<void>
  removeComparedTable: (event: {
    connectionId: string
    database: string
    table: string
  }) => void
}

export function useStoredDiffPanelPreferences(): [
  DiffPanelPreferences,
  Dispatch<SetStateAction<DiffPanelPreferences>>
] {
  const [preferences, setPreferences] = useState<DiffPanelPreferences>(() =>
    loadStoredDiffPanelPreferences()
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    window.localStorage.setItem(DIFF_PANEL_PREFERENCES_KEY, JSON.stringify(preferences))
  }, [preferences])

  return [preferences, setPreferences]
}

export function useDatabaseList(
  connectionId: string,
  showToast: ShowToast
): { databases: string[]; loading: boolean } {
  const [databases, setDatabases] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setDatabases([])
    if (!connectionId) {
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    void unwrap(api.db.listDatabases(connectionId))
      .then((list) => {
        if (active) setDatabases(list)
      })
      .catch((err) => {
        if (active) showToast((err as Error).message, 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [connectionId, showToast])

  return { databases, loading }
}

export function useDiffComparison({
  sourceConnectionId,
  sourceDatabase,
  targetConnectionId,
  targetDatabase,
  compareData,
  tableCompareConcurrency,
  showToast,
  t,
  onBeforeCompare
}: UseDiffComparisonArgs): UseDiffComparisonResult {
  const [comparePhase, setComparePhase] = useState<ComparePhase>('idle')
  const [compareContext, setCompareContext] = useState<CompareContext | null>(null)
  const [sourceTables, setSourceTables] = useState<string[]>([])
  const [targetTables, setTargetTables] = useState<string[]>([])
  const [comparisonEntries, setComparisonEntries] = useState<TableCompareEntry[]>([])
  const [showSync, setShowSync] = useState(false)
  const [showAllRowComparisons, setShowAllRowComparisons] = useState(false)
  const compareRunIdRef = useRef(0)

  const removeComparedTable = useCallback((event: {
    connectionId: string
    database: string
    table: string
  }) => {
    if (!compareContext) return

    const matchesSource =
      event.connectionId === compareContext.sourceConnectionId &&
      event.database === compareContext.sourceDatabase
    const matchesTarget =
      event.connectionId === compareContext.targetConnectionId &&
      event.database === compareContext.targetDatabase

    if (!matchesSource && !matchesTarget) return

    if (matchesSource) {
      setSourceTables((tables) => tables.filter((table) => table !== event.table))
    }
    if (matchesTarget) {
      setTargetTables((tables) => tables.filter((table) => table !== event.table))
    }
    setComparisonEntries((entries) => entries.filter((entry) => entry.table !== event.table))
  }, [compareContext])

  const runCompare = async () => {
    if (!sourceConnectionId || !targetConnectionId || !sourceDatabase || !targetDatabase) {
      showToast(t('diff.toast.selectEndpoints'), 'error')
      return
    }

    const runId = compareRunIdRef.current + 1
    compareRunIdRef.current = runId
    const nextContext: CompareContext = {
      sourceConnectionId,
      sourceDatabase,
      targetConnectionId,
      targetDatabase,
      compareData
    }

    setShowSync(false)
    setShowAllRowComparisons(false)
    onBeforeCompare?.()
    setCompareContext(nextContext)
    setComparePhase('loading-tables')
    setSourceTables([])
    setTargetTables([])
    setComparisonEntries([])

    try {
      const [nextSourceTables, nextTargetTables] = await Promise.all([
        unwrap(api.db.listTables(sourceConnectionId, sourceDatabase)),
        unwrap(api.db.listTables(targetConnectionId, targetDatabase))
      ])
      if (compareRunIdRef.current !== runId) return

      const initialEntries = buildInitialComparisonEntries(nextSourceTables, nextTargetTables)
      const sharedTables = initialEntries
        .filter((entry) => entry.sourceExists && entry.targetExists)
        .map((entry) => entry.table)

      setSourceTables(nextSourceTables)
      setTargetTables(nextTargetTables)
      setComparisonEntries(initialEntries)

      if (sharedTables.length === 0) {
        setComparePhase('done')
        return
      }

      setComparePhase('comparing')

      const diffRouter: {
        databases: typeof api.diff.databases
        table?: typeof api.diff.table
      } = api.diff
      const usingCompatibilityMode = !supportsIncrementalTableDiff(diffRouter)

      let failedTables = 0

      await runWithConcurrencyLimit(sharedTables, tableCompareConcurrency, async (table) => {
        if (compareRunIdRef.current !== runId) return

        setComparisonEntries((entries) =>
          updateTableEntry(entries, table, (entry) => ({
            ...entry,
            status: 'comparing',
            error: undefined
          }))
        )

        try {
          const result = await unwrap<TableComparisonResult>(
            requestTableComparison(diffRouter, {
              sourceConnectionId: nextContext.sourceConnectionId,
              sourceDatabase: nextContext.sourceDatabase,
              targetConnectionId: nextContext.targetConnectionId,
              targetDatabase: nextContext.targetDatabase,
              table,
              includeData: nextContext.compareData
            })
          )
          if (compareRunIdRef.current !== runId) return

          setComparisonEntries((entries) =>
            updateTableEntry(entries, table, (entry) => ({
              ...entry,
              status: 'done',
              tableDiff: result.tableDiff,
              rowComparison: result.rowComparison,
              error: undefined
            }))
          )
        } catch (err) {
          failedTables += 1
          if (compareRunIdRef.current !== runId) return

          setComparisonEntries((entries) =>
            updateTableEntry(entries, table, (entry) => ({
              ...entry,
              status: 'error',
              tableDiff: null,
              rowComparison: null,
              error: (err as Error).message
            }))
          )
        }
      })

      if (compareRunIdRef.current !== runId) return

      setComparePhase('done')
      if (usingCompatibilityMode) {
        showToast(
          t('diff.toast.compatibilityMode'),
          'info'
        )
      }
      if (failedTables > 0) {
        showToast(t('diff.toast.failedTables', { count: failedTables }), 'error')
      }
    } catch (err) {
      if (compareRunIdRef.current !== runId) return
      setCompareContext(null)
      setComparePhase('idle')
      setSourceTables([])
      setTargetTables([])
      setComparisonEntries([])
      showToast((err as Error).message, 'error')
    }
  }

  return {
    comparePhase,
    compareContext,
    sourceTables,
    targetTables,
    comparisonEntries,
    showSync,
    setShowSync,
    showAllRowComparisons,
    setShowAllRowComparisons,
    runCompare,
    removeComparedTable
  }
}

function loadStoredDiffPanelPreferences(): DiffPanelPreferences {
  if (typeof window === 'undefined') return parseDiffPanelPreferences(null)

  return parseDiffPanelPreferences(window.localStorage.getItem(DIFF_PANEL_PREFERENCES_KEY))
}
