// 用于在右侧主区域切换显示什么：表数据 / 表结构 / diff
import { create } from 'zustand'

let toastTimer: ReturnType<typeof setTimeout> | null = null

export type RightView =
  | { kind: 'empty' }
  | { kind: 'table'; connectionId: string; database: string; table: string }
  | {
      kind: 'table-compare'
      sourceConnectionId: string
      sourceDatabase: string
      targetConnectionId: string
      targetDatabase: string
      table: string
    }
  | { kind: 'sql'; connectionId: string; connectionName?: string; database: string }
  | { kind: 'diff' }

export type WorkspaceView = Exclude<RightView, { kind: 'empty' }>

export interface WorkspaceTab {
  id: string
  title: string
  view: WorkspaceView
}

interface UIState {
  rightView: RightView
  workspaceTabs: WorkspaceTab[]
  activeTabId: string | null
  setRightView: (v: RightView) => void
  setActiveTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  renameTableTabs: (connectionId: string, database: string, oldTable: string, newTable: string) => void
  closeTableTabs: (connectionId: string, database: string, table: string) => void
  toast: { message: string; level: 'info' | 'error' | 'success' } | null
  showToast: (message: string, level?: 'info' | 'error' | 'success') => void
}

type ActiveState = Pick<UIState, 'activeTabId' | 'rightView'>

function getTabId(view: WorkspaceView): string {
  if (view.kind === 'diff') return 'diff'
  if (view.kind === 'sql') return `sql:${view.connectionId}:${view.database}`
  if (view.kind === 'table-compare') {
    return `table-compare:${view.sourceConnectionId}:${view.sourceDatabase}:${view.targetConnectionId}:${view.targetDatabase}:${view.table}`
  }
  return `table:${view.connectionId}:${view.database}:${view.table}`
}

function getTabTitle(view: WorkspaceView): string {
  if (view.kind === 'diff') return 'Diff & Sync'
  if (view.kind === 'sql') {
    return view.connectionName
      ? `SQL · ${view.database} @ ${view.connectionName}`
      : `SQL · ${view.database}`
  }
  if (view.kind === 'table-compare') return `Compare · ${view.table}`
  return view.table
}

function createTab(view: WorkspaceView): WorkspaceTab {
  return {
    id: getTabId(view),
    title: getTabTitle(view),
    view
  }
}

function pickActiveState(tabs: WorkspaceTab[], preferredIndex: number): ActiveState {
  if (tabs.length === 0) {
    return {
      activeTabId: null,
      rightView: { kind: 'empty' }
    }
  }
  const nextIndex = Math.max(0, Math.min(preferredIndex, tabs.length - 1))
  const nextTab = tabs[nextIndex]!
  return {
    activeTabId: nextTab.id,
    rightView: nextTab.view
  }
}

export const useUIStore = create<UIState>((set) => ({
  rightView: { kind: 'empty' },
  workspaceTabs: [],
  activeTabId: null,
  setRightView: (view) =>
    set((state) => {
      if (view.kind === 'empty') {
        return { ...state, activeTabId: null, rightView: view }
      }
      const tabId = getTabId(view)
      const existing = state.workspaceTabs.find((tab) => tab.id === tabId)
      const workspaceTabs = existing
        ? state.workspaceTabs.map((tab) => {
            if (tab.id !== tabId) return tab
            if (tab.view.kind !== 'sql' || view.kind !== 'sql') return tab
            if (tab.view.connectionName === view.connectionName) return tab
            return createTab(view)
          })
        : [...state.workspaceTabs, createTab(view)]
      const nextTab = workspaceTabs.find((tab) => tab.id === tabId) ?? createTab(view)
      return {
        ...state,
        workspaceTabs,
        activeTabId: tabId,
        rightView: nextTab.view
      }
    }),
  setActiveTab: (tabId) =>
    set((state) => {
      const tab = state.workspaceTabs.find((item) => item.id === tabId)
      if (!tab) return state
      return { ...state, activeTabId: tab.id, rightView: tab.view }
    }),
  closeTab: (tabId) =>
    set((state) => {
      const index = state.workspaceTabs.findIndex((tab) => tab.id === tabId)
      if (index < 0) return state
      const workspaceTabs = state.workspaceTabs.filter((tab) => tab.id !== tabId)
      if (state.activeTabId !== tabId) {
        return { ...state, workspaceTabs }
      }
      return { ...state, workspaceTabs, ...pickActiveState(workspaceTabs, index - 1) }
    }),
  renameTableTabs: (connectionId, database, oldTable, newTable) =>
    set((state) => {
      const oldTabId = getTabId({ kind: 'table', connectionId, database, table: oldTable })
      const nextView: WorkspaceView = { kind: 'table', connectionId, database, table: newTable }
      const nextTabId = getTabId(nextView)
      let changed = false
      const workspaceTabs = state.workspaceTabs.map((tab) => {
        if (tab.id !== oldTabId) return tab
        changed = true
        return createTab(nextView)
      })
      if (!changed) return state
      const activeTabId = state.activeTabId === oldTabId ? nextTabId : state.activeTabId
      const rightView =
        state.rightView.kind === 'table' &&
        state.rightView.connectionId === connectionId &&
        state.rightView.database === database &&
        state.rightView.table === oldTable
          ? nextView
          : state.rightView
      return { ...state, workspaceTabs, activeTabId, rightView }
    }),
  closeTableTabs: (connectionId, database, table) =>
    set((state) => {
      const tabId = getTabId({ kind: 'table', connectionId, database, table })
      const index = state.workspaceTabs.findIndex((tab) => tab.id === tabId)
      if (index < 0) return state
      const workspaceTabs = state.workspaceTabs.filter((tab) => tab.id !== tabId)
      if (state.activeTabId !== tabId) {
        return { ...state, workspaceTabs }
      }
      return { ...state, workspaceTabs, ...pickActiveState(workspaceTabs, index - 1) }
    }),
  toast: null,
  showToast: (message, level = 'info') => {
    if (toastTimer) {
      clearTimeout(toastTimer)
    }
    set({ toast: { message, level } })
    toastTimer = setTimeout(() => {
      set({ toast: null })
      toastTimer = null
    }, 3000)
  }
}))
