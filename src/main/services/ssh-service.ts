// SSH Tunnel 管理：为每个 connectionId 维护一个本地端口转发到远端 MySQL 的隧道。
// mysql2 实际连接的是 127.0.0.1:<localPort>。
import { Client, ConnectConfig } from 'ssh2'
import { createServer, AddressInfo, Server } from 'node:net'
import type { ConnectionConfig } from '../../shared/types'

interface ActiveTunnel {
  client: Client
  server: Server
  localPort: number
}

class SSHService {
  private tunnels = new Map<string, ActiveTunnel>()
  private pendingTunnels = new Map<string, Promise<number>>()
  private closeListeners = new Set<(connectionId: string) => void>()

  /** 注册隧道关闭回调，便于 mysql 连接池失效。返回反注册函数。 */
  onTunnelClosed(listener: (connectionId: string) => void): () => void {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  getActiveLocalPort(connectionId: string): number | undefined {
    return this.tunnels.get(connectionId)?.localPort
  }

  /** 为给定连接打开一个隧道；如果已存在则复用。返回本地端口。 */
  async ensureTunnel(conn: ConnectionConfig): Promise<number> {
    if (!conn.useSSH) throw new Error('Connection does not use SSH')
    const existing = this.tunnels.get(conn.id)
    if (existing) return existing.localPort
    const pending = this.pendingTunnels.get(conn.id)
    if (pending) return pending

    const creation = this.createTunnel(conn)
    this.pendingTunnels.set(conn.id, creation)
    try {
      return await creation
    } finally {
      this.pendingTunnels.delete(conn.id)
    }
  }

  private async createTunnel(conn: ConnectionConfig): Promise<number> {
    const sshConfig: ConnectConfig = {
      host: conn.sshHost,
      port: conn.sshPort || 22,
      username: conn.sshUsername,
      readyTimeout: 15000,
      keepaliveInterval: 30000
    }
    if (conn.sshPrivateKey) {
      sshConfig.privateKey = conn.sshPrivateKey
      if (conn.sshPassphrase) sshConfig.passphrase = conn.sshPassphrase
    } else if (conn.sshPassword) {
      sshConfig.password = conn.sshPassword
    } else {
      throw new Error('SSH requires either privateKey or password')
    }

    const client = await this.connectSSH(sshConfig)
    try {
      const { server, port } = await this.startLocalForwardingServer(client, conn.host, conn.port)

      this.tunnels.set(conn.id, { client, server, localPort: port })

      // 任一侧异常都清掉缓存，下次重新建立
      const cleanup = () => this.close(conn.id).catch(() => undefined)
      client.on('error', cleanup)
      client.on('close', cleanup)
      server.on('error', cleanup)

      return port
    } catch (error) {
      try {
        client.end()
      } catch {
        // noop
      }
      throw error
    }
  }

  private connectSSH(cfg: ConnectConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const c = new Client()
      c.once('ready', () => resolve(c))
      c.once('error', (err) => reject(err))
      c.connect(cfg)
    })
  }

  private startLocalForwardingServer(
    client: Client,
    remoteHost: string,
    remotePort: number
  ): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        client.forwardOut(
          socket.remoteAddress || '127.0.0.1',
          socket.remotePort || 0,
          remoteHost,
          remotePort,
          (err, stream) => {
            if (err) {
              socket.destroy()
              return
            }
            socket.pipe(stream).pipe(socket)
          }
        )
      })
      server.on('error', reject)
      // listen on random local port
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo
        resolve({ server, port: addr.port })
      })
    })
  }

  async close(connectionId: string): Promise<void> {
    this.pendingTunnels.delete(connectionId)
    const t = this.tunnels.get(connectionId)
    if (!t) return
    this.tunnels.delete(connectionId)
    try { t.server.close() } catch { /* noop */ }
    try { t.client.end() } catch { /* noop */ }
    for (const listener of this.closeListeners) {
      try { listener(connectionId) } catch { /* noop */ }
    }
  }

  async closeAll(): Promise<void> {
    const ids = Array.from(this.tunnels.keys())
    await Promise.all(ids.map((id) => this.close(id)))
  }
}

export const sshService = new SSHService()
