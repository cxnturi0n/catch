import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '../config.js'

// AES-256-GCM for secrets at rest (integration credentials, webhook URLs,
// third-party tokens). Ciphertext format: `v1:<keyId>:<iv>:<tag>:<data>` in
// base64url, so keys can be rotated by adding a new id and re-encrypting
// lazily: decrypt with the id embedded in the value, encrypt with the current.

const VERSION = 'v1'

function keys(): Map<string, Buffer> {
  // CREDENTIALS_ENCRYPTION_KEYS = "<id>:<base64 32 bytes>[,<id>:<base64>...]";
  // first entry is the active key.
  const map = new Map<string, Buffer>()
  for (const entry of config.CREDENTIALS_ENCRYPTION_KEYS.split(',')) {
    const [id, b64] = entry.trim().split(':')
    if (!id || !b64) throw new Error('CREDENTIALS_ENCRYPTION_KEYS entry must be <id>:<base64>')
    const key = Buffer.from(b64, 'base64')
    if (key.length !== 32) throw new Error(`encryption key "${id}" must decode to 32 bytes`)
    map.set(id, key)
  }
  return map
}

let cache: { active: string; keys: Map<string, Buffer> } | null = null
function load() {
  if (!cache) {
    const k = keys()
    cache = { active: k.keys().next().value as string, keys: k }
  }
  return cache
}

export function encryptSecret(plaintext: string): string {
  const { active, keys } = load()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keys.get(active)!, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, active, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join(':')
}

export function decryptSecret(blob: string): string {
  const [version, keyId, ivB64, tagB64, dataB64] = blob.split(':')
  if (version !== VERSION || !keyId || !ivB64 || !tagB64 || !dataB64) throw new Error('malformed encrypted value')
  const key = load().keys.get(keyId)
  if (!key) throw new Error(`unknown encryption key id "${keyId}"`)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8')
}

export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value))
}

export function decryptJson<T>(blob: string): T {
  return JSON.parse(decryptSecret(blob)) as T
}

/** True when the value was encrypted with a key that is no longer active. */
export function needsReencrypt(blob: string): boolean {
  return blob.split(':')[1] !== load().active
}
