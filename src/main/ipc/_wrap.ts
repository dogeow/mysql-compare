// 统一的 handler 包装：把 Service 错误转换为 IPCResult，避免抛异常跨进程。
import { ipcMain } from 'electron'
import type { IPCResult } from '../../shared/types'

export function handle<T>(channel: string, fn: (payload: any) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_evt, payload): Promise<IPCResult<T>> => {
    try {
      const data = await fn(payload)
      return { ok: true, data }
    } catch (err) {
      console.error(`[ipc:${channel}]`, err)
      return { ok: false, error: (err as Error).message || 'Unknown error' }
    }
  })
}
