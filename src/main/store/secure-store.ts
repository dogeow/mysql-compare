// Electron 桌面端优先使用 safeStorage；Web 服务端则回退到对称加密。
// 为避免混用密文格式，新的密文会带前缀；旧版纯 base64 仍然兼容读取。
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { getSafeStorage, isElectronRuntime } from '../platform/electron-runtime'

const ELECTRON_CIPHER_PREFIX = 'electron:'
const NODE_CIPHER_PREFIX = 'node:'
const NODE_SECRET_SALT = 'mysql-compare-web'

let warnedAboutNodeSecret = false

function getNodeSecret(): string {
  const configured = process.env['MYSQL_COMPARE_SECRET']?.trim() || process.env['WEB_SECRET_KEY']?.trim()
  if (configured) return configured

  if (!warnedAboutNodeSecret) {
    warnedAboutNodeSecret = true
    console.warn('[secure-store] MYSQL_COMPARE_SECRET is not set; using the built-in development secret for web runtime.')
  }

  return 'mysql-compare-dev-secret'
}

function encryptForNodeRuntime(plain: string): string {
  const key = scryptSync(getNodeSecret(), NODE_SECRET_SALT, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${NODE_CIPHER_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

function decryptForNodeRuntime(payload: string): string | null {
  const [ivBase64, tagBase64, encryptedBase64] = payload.split(':')
  if (!ivBase64 || !tagBase64 || !encryptedBase64) return null

  try {
    const key = scryptSync(getNodeSecret(), NODE_SECRET_SALT, 32)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagBase64, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64')),
      decipher.final()
    ])
    return decrypted.toString('utf8')
  } catch (err) {
    console.error('[secure-store] node decrypt failed', err)
    return null
  }
}

function decryptElectronCipher(payload: string): string | null {
  const safeStorage = getSafeStorage()
  if (!safeStorage?.isEncryptionAvailable()) {
    console.error('[secure-store] electron cipher is not readable outside Electron safeStorage runtime')
    return null
  }

  try {
    return safeStorage.decryptString(Buffer.from(payload, 'base64'))
  } catch (err) {
    console.error('[secure-store] electron decrypt failed', err)
    return null
  }
}

function decryptLegacyCipher(cipher: string): string | null {
  const safeStorage = getSafeStorage()
  if (safeStorage?.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
    } catch {
      // 旧降级格式直接当普通 base64 字符串处理。
    }
  }

  try {
    return Buffer.from(cipher, 'base64').toString('utf-8')
  } catch (err) {
    console.error('[secure-store] legacy decrypt failed', err)
    return null
  }
}

/** 把明文加密成 base64；如系统不可用则降级为 base64（仍提示警告） */
export function encryptSecret(plain: string | undefined | null): string | null {
  if (plain == null || plain === '') return null
  const safeStorage = getSafeStorage()
  if (safeStorage?.isEncryptionAvailable()) {
    return `${ELECTRON_CIPHER_PREFIX}${safeStorage.encryptString(plain).toString('base64')}`
  }

  if (!isElectronRuntime()) {
    return encryptForNodeRuntime(plain)
  }

  console.warn('[secure-store] safeStorage unavailable, falling back to base64 only.')
  return Buffer.from(plain, 'utf-8').toString('base64')
}

export function decryptSecret(cipher: string | null | undefined): string | null {
  if (cipher == null || cipher === '') return null
  if (cipher.startsWith(ELECTRON_CIPHER_PREFIX)) {
    return decryptElectronCipher(cipher.slice(ELECTRON_CIPHER_PREFIX.length))
  }
  if (cipher.startsWith(NODE_CIPHER_PREFIX)) {
    return decryptForNodeRuntime(cipher.slice(NODE_CIPHER_PREFIX.length))
  }
  return decryptLegacyCipher(cipher)
}
