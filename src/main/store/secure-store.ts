// 使用 Electron safeStorage 把敏感字符串加密。
// safeStorage 在 macOS 用 Keychain，Windows 用 DPAPI，Linux 走 libsecret/kwallet。
// 落盘时存的是 base64 后的密文。
import { safeStorage } from 'electron'

/** 把明文加密成 base64；如系统不可用则降级为 base64（仍提示警告） */
export function encryptSecret(plain: string | undefined | null): string | null {
  if (plain == null || plain === '') return null
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64')
  }
  // 降级：避免某些 Linux 缺乏 keychain 时整个 app 不可用，但发出明显告警
  console.warn('[secure-store] safeStorage unavailable, falling back to base64 only.')
  return Buffer.from(plain, 'utf-8').toString('base64')
}

export function decryptSecret(cipher: string | null | undefined): string | null {
  if (cipher == null || cipher === '') return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
    }
    return Buffer.from(cipher, 'base64').toString('utf-8')
  } catch (err) {
    console.error('[secure-store] decrypt failed', err)
    return null
  }
}
