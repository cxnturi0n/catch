import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { config } from '../../config.js'

// File storage behind a tiny interface so the driver can move from local disk
// (MVP, a Docker volume) to S3 without touching the modules. Keys always start
// with the workspace id: `${workspaceId}/…`, which is also the authorization
// unit for downloads.

export interface StoredFile {
  key: string
  size: number
  contentType: string
}

export interface StorageDriver {
  put(key: string, data: Buffer, contentType: string): Promise<StoredFile>
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>
  delete(key: string): Promise<void>
}

function safeKey(key: string): string {
  const n = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '')
  if (n.includes('..') || n.startsWith('/') || n.startsWith('\\')) throw new Error('invalid storage key')
  return n
}

class LocalDriver implements StorageDriver {
  constructor(private root: string) {}
  private path(key: string) {
    return join(this.root, safeKey(key))
  }
  async put(key: string, data: Buffer, contentType: string): Promise<StoredFile> {
    const p = this.path(key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, data)
    await writeFile(`${p}.meta.json`, JSON.stringify({ contentType }))
    return { key, size: data.length, contentType }
  }
  async get(key: string) {
    const p = this.path(key)
    try {
      await stat(p)
    } catch {
      return null
    }
    const data = await readFile(p)
    let contentType = 'application/octet-stream'
    try {
      contentType = (JSON.parse(await readFile(`${p}.meta.json`, 'utf8')) as { contentType: string }).contentType
    } catch {
      /* keep default */
    }
    return { data, contentType }
  }
  async delete(key: string) {
    const p = this.path(key)
    await rm(p, { force: true })
    await rm(`${p}.meta.json`, { force: true })
  }
}

export const storage: StorageDriver = new LocalDriver(config.STORAGE_LOCAL_ROOT)

// Short-lived download tokens: HMAC over key + expiry, verified by GET /files.
export function signDownload(key: string, ttlSeconds = 300): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = `${key}|${exp}`
  const sig = createHmac('sha256', config.AUTH_SECRET).update(payload).digest('base64url')
  return Buffer.from(`${payload}|${sig}`).toString('base64url')
}

export function verifyDownload(token: string): string | null {
  let decoded: string
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const i = decoded.lastIndexOf('|')
  if (i < 0) return null
  const payload = decoded.slice(0, i)
  const sig = decoded.slice(i + 1)
  const expected = createHmac('sha256', config.AUTH_SECRET).update(payload).digest('base64url')
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  const [key, expStr] = payload.split('|')
  if (!key || !expStr || Number(expStr) < Math.floor(Date.now() / 1000)) return null
  return key
}

export function downloadUrl(key: string, ttlSeconds = 300): string {
  return `${config.API_URL.replace(/\/$/, '')}/files/${signDownload(key, ttlSeconds)}`
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'file'
}
