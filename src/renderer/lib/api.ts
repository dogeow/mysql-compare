// 渲染端 IPC 入口：从 preload 暴露的 window.api 读取强类型方法。
import type { AppAPI } from '../../preload'
import type { IPCResult } from '../../shared/types'

declare global {
  interface Window {
    api: AppAPI
  }
}

export const api: AppAPI = window.api

/** 解包 IPCResult，错误时抛出 */
export async function unwrap<T>(p: Promise<IPCResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error || 'IPC error')
  return r.data as T
}
