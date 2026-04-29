import Store from 'electron-store'

interface Schema {
  fingerprints: Record<string, string>
}

const store = new Store<Schema>({
  name: 'ssh-host-keys',
  defaults: { fingerprints: {} }
})

function getKey(connectionId: string, host: string, port: number): string {
  return `${connectionId}:${host}:${port}`
}

export const sshHostKeyStore = {
  get(connectionId: string, host: string, port: number): string | undefined {
    return store.get('fingerprints')[getKey(connectionId, host, port)]
  },

  set(connectionId: string, host: string, port: number, fingerprint: string): void {
    const fingerprints = store.get('fingerprints')
    store.set('fingerprints', {
      ...fingerprints,
      [getKey(connectionId, host, port)]: fingerprint
    })
  }
}