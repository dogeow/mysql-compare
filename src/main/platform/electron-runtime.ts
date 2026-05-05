import { createRequire } from 'node:module'
import type {
  MessageBoxOptions,
  MessageBoxReturnValue,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue
} from 'electron'

type ElectronModule = typeof import('electron')

const require = createRequire(import.meta.url)

let cachedElectronModule: ElectronModule | null | undefined

function getElectronModule(): ElectronModule | null {
  if (cachedElectronModule !== undefined) return cachedElectronModule
  if (!process.versions.electron) {
    cachedElectronModule = null
    return cachedElectronModule
  }

  cachedElectronModule = require('electron') as ElectronModule
  return cachedElectronModule
}

function getActiveBrowserWindow() {
  const electron = getElectronModule()
  if (!electron) return undefined
  return electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0]
}

export function isElectronRuntime(): boolean {
  return getElectronModule() !== null
}

export function getSafeStorage() {
  return getElectronModule()?.safeStorage ?? null
}

export async function showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
  const electron = getElectronModule()
  if (!electron) throw new Error('Native file dialogs are unavailable outside Electron')
  const win = getActiveBrowserWindow()
  return win ? electron.dialog.showOpenDialog(win, options) : electron.dialog.showOpenDialog(options)
}

export async function showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
  const electron = getElectronModule()
  if (!electron) throw new Error('Native file dialogs are unavailable outside Electron')
  const win = getActiveBrowserWindow()
  return win ? electron.dialog.showSaveDialog(win, options) : electron.dialog.showSaveDialog(options)
}

export async function showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
  const electron = getElectronModule()
  if (!electron) throw new Error('Native dialogs are unavailable outside Electron')
  const win = getActiveBrowserWindow()
  return win ? electron.dialog.showMessageBox(win, options) : electron.dialog.showMessageBox(options)
}
