import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { createHmac } from 'node:crypto'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { emailOutbox } = await import('../src/email/sender.js')

type App = Awaited<ReturnType<typeof buildApp>>

const EMAIL = `it-${Date.now()}@example.test`
const PASSWORD = 'correct-horse-battery'

// RFC 6238 TOTP for the test authenticator (base32 secret from the server).
function totp(secretB32: string, step = 30): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secretB32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / step)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
  return code
}

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : []
  return list.map((c) => c.split(';')[0]!).join('; ')
}

let app: App
let cookie = ''

async function post(url: string, body: unknown, extraCookie = cookie) {
  return app.inject({ method: 'POST', url, payload: body as object, headers: { cookie: extraCookie, origin: process.env.APP_URL! } })
}

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
})

afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'it-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('email + password', () => {
  it('signs up and refuses sign-in until the email is verified', async () => {
    const su = await post('/auth/sign-up/email', { name: 'Test User', email: EMAIL, password: PASSWORD })
    expect(su.statusCode).toBe(200)

    const si = await post('/auth/sign-in/email', { email: EMAIL, password: PASSWORD })
    expect(si.statusCode).toBe(403) // EMAIL_NOT_VERIFIED
  })

  it('verifies the email by following the link from the verification email', async () => {
    const mail = emailOutbox.find((m) => m.to === EMAIL && /verify/i.test(m.subject))
    expect(mail).toBeTruthy()
    const url = new URL(mail!.text.match(/https?:\/\/\S+/)![0])
    const r = await app.inject({ method: 'GET', url: url.pathname + url.search })
    expect([200, 302]).toContain(r.statusCode)
    const u = await db.query.user.findFirst({ where: eq(schema.user.email, EMAIL) })
    expect(u?.emailVerified).toBe(true)
  })

  it('signs in once verified and reaches /me', async () => {
    const si = await post('/auth/sign-in/email', { email: EMAIL, password: PASSWORD })
    expect(si.statusCode).toBe(200)
    cookie = cookiesOf(si)
    expect(cookie).toContain('better-auth.session_token')

    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie } })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.email).toBe(EMAIL)
    expect(me.json().user.twoFactorEnabled).toBe(false)

    const events = await db.query.securityEvents.findMany({ where: eq(schema.securityEvents.type, 'login_success') })
    expect(events.length).toBeGreaterThan(0)
  })

  it('rejects /me without a session', async () => {
    const me = await app.inject({ method: 'GET', url: '/me' })
    expect(me.statusCode).toBe(401)
    expect(me.json().error.code).toBe('UNAUTHENTICATED')
  })

  it('rejects a wrong password and rate-limits after repeated failures', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 7; i++) {
      const r = await post('/auth/sign-in/email', { email: EMAIL, password: 'wrong-password-xx' }, '')
      statuses.push(r.statusCode)
    }
    expect(statuses[0]).toBe(401)
    expect(statuses.at(-1)).toBe(429)
    // Reset the limiter so later tests are not throttled by this one.
    await db.delete(schema.rateLimit)
  })
})

describe('two-factor (TOTP + backup codes)', () => {
  let totpSecret = ''
  let backupCodes: string[] = []

  it('enable requires the password and returns an otpauth URI + backup codes', async () => {
    const r = await post('/auth/two-factor/enable', { password: PASSWORD })
    expect(r.statusCode).toBe(200)
    const body = r.json() as { totpURI: string; backupCodes: string[] }
    expect(body.totpURI).toMatch(/^otpauth:\/\/totp\//)
    totpSecret = new URL(body.totpURI).searchParams.get('secret')!
    backupCodes = body.backupCodes
    expect(backupCodes).toHaveLength(10)

    // Not active until the first code is verified.
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie } })
    expect(me.json().user.twoFactorEnabled).toBe(false)
  })

  it('activates after a valid TOTP code', async () => {
    const r = await post('/auth/two-factor/verify-totp', { code: totp(totpSecret) })
    expect(r.statusCode).toBe(200)
    // Verification rotates the session cookie.
    cookie = cookiesOf(r) || cookie
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie } })
    expect(me.json().user.twoFactorEnabled).toBe(true)
  })

  it('sign-in now yields a pending state that cannot reach /me until the second factor', async () => {
    const si = await post('/auth/sign-in/email', { email: EMAIL, password: PASSWORD }, '')
    expect(si.statusCode).toBe(200)
    expect(si.json().twoFactorRedirect).toBe(true)
    const pending = cookiesOf(si)
    expect(pending).toContain('two_factor')

    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: pending } })
    expect(me.statusCode).toBe(401)

    const wrong = await post('/auth/two-factor/verify-totp', { code: '000000' }, pending)
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400)

    const ok = await post('/auth/two-factor/verify-totp', { code: totp(totpSecret) }, pending)
    expect(ok.statusCode).toBe(200)
    const full = cookiesOf(ok)
    const me2 = await app.inject({ method: 'GET', url: '/me', headers: { cookie: full } })
    expect(me2.statusCode).toBe(200)
  })

  it('a backup code completes sign-in once', async () => {
    const si = await post('/auth/sign-in/email', { email: EMAIL, password: PASSWORD }, '')
    const pending = cookiesOf(si)
    const code = backupCodes[0]!
    const ok = await post('/auth/two-factor/verify-backup-code', { code }, pending)
    expect(ok.statusCode).toBe(200)
    await db.delete(schema.rateLimit)

    const si2 = await post('/auth/sign-in/email', { email: EMAIL, password: PASSWORD }, '')
    const again = await post('/auth/two-factor/verify-backup-code', { code }, cookiesOf(si2))
    expect(again.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('disable requires the password and sign-in is direct again', async () => {
    const r = await post('/auth/two-factor/disable', { password: PASSWORD })
    expect(r.statusCode).toBe(200)
    const si = await post('/auth/sign-in/email', { email: EMAIL, password: PASSWORD }, '')
    expect(si.json().twoFactorRedirect).toBeFalsy()
  })
})

describe('sessions', () => {
  it('lists sessions and sign-out revokes the current one', async () => {
    const si = await post('/auth/sign-in/email', { email: EMAIL, password: PASSWORD }, '')
    const c = cookiesOf(si)
    const list = await app.inject({ method: 'GET', url: '/auth/list-sessions', headers: { cookie: c } })
    expect(list.statusCode).toBe(200)
    expect((list.json() as unknown[]).length).toBeGreaterThan(0)

    const out = await post('/auth/sign-out', {}, c)
    expect(out.statusCode).toBe(200)
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie: c } })
    expect(me.statusCode).toBe(401)

    const types = (await db.query.securityEvents.findMany()).map((e) => e.type)
    for (const t of ['login_success', 'mfa_enabled', 'mfa_disabled', 'logout']) expect(types).toContain(t)
  })
})
