import { app, BrowserWindow } from 'electron'
import { createMainWindow, resolveAppIconPath } from './window'
import { registerIPC } from './ipc'
import { dbService } from './services/db-service'
import { sshService } from './services/ssh-service'

let shutdownPromise: Promise<void> | null = null

function shutdownServices(): Promise<void> {
  if (!shutdownPromise) {
    shutdownPromise = Promise.all([
      dbService.closeAll(),
      sshService.closeAll()
    ]).then(() => undefined)
  }
  return shutdownPromise
}

// 单实例锁
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.whenReady().then(async () => {
  const icon = resolveAppIconPath()
  if (process.platform === 'darwin' && icon) app.dock?.setIcon(icon)

  registerIPC()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', async () => {
  // 优雅关闭：断开所有 mysql 连接池 + ssh tunnel
  await shutdownServices()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await shutdownServices()
})
