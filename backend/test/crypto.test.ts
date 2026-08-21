import './setup-env.js'
import { describe, expect, it } from 'vitest'

process.env.CREDENTIALS_ENCRYPTION_KEYS ??= 'k1:' + Buffer.alloc(32, 7).toString('base64')
const { encryptJson, decryptJson, encryptSecret, decryptSecret } = await import('../src/lib/crypto.js')

describe('crypto', () => {
  it('round-trips secrets and JSON, with a fresh IV each time', () => {
    const a = encryptSecret('bot-token-123')
    const b = encryptSecret('bot-token-123')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('bot-token-123')
    expect(decryptJson(encryptJson({ token: 'x', chat: 1 }))).toEqual({ token: 'x', chat: 1 })
  })

  it('rejects tampered ciphertext', () => {
    const blob = encryptSecret('secret')
    const parts = blob.split(':')
    parts[4] = parts[4]!.slice(0, -2) + 'AA'
    expect(() => decryptSecret(parts.join(':'))).toThrow()
  })
})
