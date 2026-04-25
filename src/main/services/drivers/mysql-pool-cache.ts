import mysql, { Pool, PoolOptions } from 'mysql2/promise'
import type { ConnectionConfig } from '../../../shared/types'

const MAX_CACHED_DATABASE_POOLS = 8

interface PoolEntry {
  pool: Pool
  activeUsers: number
}

interface PoolDebugStats {
  createdPools: number
  reusedPools: number
  evictedPools: number
  skippedEvictions: number
}

export interface MySQLDriverPoolDebugSnapshot {
  connectionId: string
  cachedPools: number
  maxCachedPools: number
  stats: PoolDebugStats
  entries: Array<{
    database: string
    activeUsers: number
  }>
}

export class MySQLPoolCache {
  private pools = new Map<string, PoolEntry>()
  private poolMutation: Promise<void> = Promise.resolve()
  private readonly poolDebugStats: PoolDebugStats = {
    createdPools: 0,
    reusedPools: 0,
    evictedPools: 0,
    skippedEvictions: 0
  }

  constructor(
    private readonly connectionId: string,
    private readonly connection: ConnectionConfig,
    private readonly localPort?: number
  ) {}

  buildPoolOptions(database?: string): PoolOptions {
    const host = this.localPort !== undefined ? '127.0.0.1' : this.connection.host
    const port = this.localPort ?? this.connection.port

    return {
      host,
      port,
      user: this.connection.username,
      password: this.connection.password,
      database: database || this.connection.database,
      connectionLimit: 5,
      waitForConnections: true,
      multipleStatements: false,
      dateStrings: true
    }
  }

  async withPool<T>(database: string | undefined, run: (pool: Pool) => Promise<T>): Promise<T> {
    const lease = await this.acquirePool(database)
    try {
      return await run(lease.pool)
    } finally {
      lease.release()
    }
  }

  async acquirePool(database?: string): Promise<{ pool: Pool; release: () => void }> {
    const key = database ?? this.connection.database ?? '__default__'
    const cached = this.pools.get(key)
    if (cached) {
      this.poolDebugStats.reusedPools += 1
      this.touchPool(key, cached)
      cached.activeUsers += 1
      return this.createLease(cached)
    }

    return this.runPoolMutation(async () => {
      const cachedAfterLock = this.pools.get(key)
      if (cachedAfterLock) {
        this.poolDebugStats.reusedPools += 1
        this.touchPool(key, cachedAfterLock)
        cachedAfterLock.activeUsers += 1
        return this.createLease(cachedAfterLock)
      }

      await this.evictIdlePoolsIfNeeded()

      const entry: PoolEntry = {
        pool: mysql.createPool(this.buildPoolOptions(database)),
        activeUsers: 1
      }
      this.poolDebugStats.createdPools += 1
      this.pools.set(key, entry)
      return this.createLease(entry)
    })
  }

  getDebugSnapshot(): MySQLDriverPoolDebugSnapshot {
    return {
      connectionId: this.connectionId,
      cachedPools: this.pools.size,
      maxCachedPools: MAX_CACHED_DATABASE_POOLS,
      stats: { ...this.poolDebugStats },
      entries: Array.from(this.pools.entries(), ([database, entry]) => ({
        database,
        activeUsers: entry.activeUsers
      }))
    }
  }

  async close(): Promise<void> {
    if (this.pools.size === 0) return

    const pools = Array.from(this.pools.values(), (entry) => entry.pool)
    this.pools.clear()
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)))
  }

  private createLease(entry: PoolEntry): { pool: Pool; release: () => void } {
    let released = false

    return {
      pool: entry.pool,
      release: () => {
        if (released) return
        released = true
        entry.activeUsers = Math.max(0, entry.activeUsers - 1)
      }
    }
  }

  private touchPool(key: string, entry: PoolEntry): void {
    this.pools.delete(key)
    this.pools.set(key, entry)
  }

  private async evictIdlePoolsIfNeeded(): Promise<void> {
    while (this.pools.size >= MAX_CACHED_DATABASE_POOLS) {
      const oldestIdle = Array.from(this.pools.entries()).find(([, entry]) => entry.activeUsers === 0)
      if (!oldestIdle) {
        this.poolDebugStats.skippedEvictions += 1
        return
      }

      const [oldestKey, oldestEntry] = oldestIdle
      this.pools.delete(oldestKey)
      this.poolDebugStats.evictedPools += 1
      await oldestEntry.pool.end().catch(() => undefined)
    }
  }

  private async runPoolMutation<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.poolMutation
    let release: (() => void) | undefined
    this.poolMutation = new Promise<void>((resolve) => {
      release = resolve
    })

    await previous
    try {
      return await run()
    } finally {
      release?.()
    }
  }
}