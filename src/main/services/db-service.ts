// 驱动管理层：按 connectionId 复用 DbDriver，处理 SSH tunnel 生命周期。
import type { ConnectionConfig } from '../../shared/types'
import { connectionStore } from '../store/connection-store'
import { createDriver } from './drivers/registry'
import type { DbDriver } from './drivers/types'
import { sshService } from './ssh-service'

interface DriverEntry {
  driver: DbDriver
  localPort?: number
}

class DbService {
  private drivers = new Map<string, DriverEntry>()
  private pending = new Map<string, Promise<DriverEntry>>()

  constructor() {
    sshService.onTunnelClosed((connectionId) => {
      const entry = this.drivers.get(connectionId)
      if (!entry || entry.localPort === undefined) return
      this.drivers.delete(connectionId)
      entry.driver.close().catch(() => undefined)
    })
  }

  async getDriver(connectionId: string): Promise<DbDriver> {
    const conn = connectionStore.getFull(connectionId)
    if (!conn) throw new Error(`Connection ${connectionId} not found`)

    const localPort = conn.useSSH ? await sshService.ensureTunnel(conn) : undefined

    const cached = this.drivers.get(connectionId)
    if (cached && cached.localPort === localPort) return cached.driver

    const pending = this.pending.get(connectionId)
    if (pending) {
      const entry = await pending
      if (entry.localPort === localPort) return entry.driver
    }

    if (cached) {
      this.drivers.delete(connectionId)
      await cached.driver.close().catch(() => undefined)
    }

    const creation = (async (): Promise<DriverEntry> => {
      const driver = createDriver({ connection: conn, localPort })
      const entry: DriverEntry = { driver, localPort }
      this.drivers.set(connectionId, entry)
      return entry
    })()
    this.pending.set(connectionId, creation)
    try {
      const entry = await creation
      return entry.driver
    } finally {
      this.pending.delete(connectionId)
    }
  }

  /** 直接基于一个临时 ConnectionConfig 测试连接（不入缓存） */
  async testConnection(conn: ConnectionConfig): Promise<string> {
    const testId = `${conn.id || 'connection'}::test::${Date.now()}`
    const testConn: ConnectionConfig = { ...conn, id: testId }
    const localPort = testConn.useSSH ? await sshService.ensureTunnel(testConn) : undefined
    const driver = createDriver({ connection: testConn, localPort })
    try {
      return await driver.testConnection()
    } finally {
      await driver.close()
      if (testConn.useSSH) await sshService.close(testConn.id)
    }
  }

  async closeConnection(connectionId: string): Promise<void> {
    this.pending.delete(connectionId)
    const entry = this.drivers.get(connectionId)
    if (entry) {
      this.drivers.delete(connectionId)
      await entry.driver.close().catch(() => undefined)
    }
    await sshService.close(connectionId)
  }

  async closeAll(): Promise<void> {
    const entries = Array.from(this.drivers.values())
    this.drivers.clear()
    this.pending.clear()
    await Promise.all(entries.map((e) => e.driver.close().catch(() => undefined)))
  }
}

export const dbService = new DbService()
