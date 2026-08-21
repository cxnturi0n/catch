import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

process.env.STORAGE_LOCAL_ROOT = '/tmp/claude-1000/-home-centuri0n-projects-catch/598b8de4-dde3-4945-b4d3-f71614bfb701/scratchpad/test-storage'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
const PASSWORD = 'moderators-test-pw'

async function makeUser(tag: string, plan: 'starter' | 'pro' = 'pro') {
  const email = `mod-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: PASSWORD }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true, plan }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  return (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
}

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'mod-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('moderators + compensation', () => {
  let cookie = ''
  let other = ''
  let ws = ''
  let modId = ''

  it('setup', async () => {
    cookie = await makeUser('owner')
    other = await makeUser('other')
    const r = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Mods' }, headers: { cookie } })
    ws = r.json().id
  })

  it('creates, lists, updates a moderator (validation + warnings)', async () => {
    const bad = await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators`, payload: { fullName: '', shiftStartUtc: 25 }, headers: { cookie } })
    expect(bad.statusCode).toBe(400)

    const c = await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators`, payload: { fullName: 'Lena Ortiz', discordHandle: 'lena', platforms: ['Discord'], shiftStartUtc: 6, shiftEndUtc: 14 }, headers: { cookie } })
    expect(c.statusCode, c.body).toBe(201)
    modId = c.json().id
    expect(c.json()).toMatchObject({ fullName: 'Lena Ortiz', hasCv: false, warnings: [], shiftDays: [1, 2, 3, 4, 5] })

    const u = await app.inject({ method: 'PATCH', url: `/workspaces/${ws}/moderators/${modId}`, payload: { warnings: [{ id: 'w1', date: '2026-08-01', reason: 'Late', severity: 'Low', issuedBy: 'Owner' }], status: 'On Duty' }, headers: { cookie } })
    expect(u.statusCode, u.body).toBe(200)
    expect(u.json().warnings).toHaveLength(1)

    const l = await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators`, headers: { cookie } })
    expect(l.json().moderators).toHaveLength(1)
    expect(l.json().quota).toMatchObject({ used: 1, limit: 10 })
  })

  it('is invisible to non-members', async () => {
    const r = await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators`, headers: { cookie: other } })
    expect(r.statusCode).toBe(404)
    const p = await app.inject({ method: 'PATCH', url: `/workspaces/${ws}/moderators/${modId}`, payload: { fullName: 'x' }, headers: { cookie: other } })
    expect(p.statusCode).toBe(404)
  })

  it('uploads, serves and deletes a CV (PDF only, signed download)', async () => {
    const boundary = 'xxBOUNDARYxx'
    const body = (filename: string, type: string, content: string) =>
      [`--${boundary}`, `Content-Disposition: form-data; name="extractedText"`, '', 'Hello CV', `--${boundary}`, `Content-Disposition: form-data; name="file"; filename="${filename}"`, `Content-Type: ${type}`, '', content, `--${boundary}--`, ''].join('\r\n')
    const headers = { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }

    const notPdf = await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators/${modId}/cv`, payload: body('cv.pdf', 'application/pdf', 'not a pdf'), headers })
    expect(notPdf.statusCode).toBe(400)

    const ok = await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators/${modId}/cv`, payload: body('Lena CV.pdf', 'application/pdf', '%PDF-1.4 fake'), headers })
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.json()).toMatchObject({ hasCv: true, cvFilename: 'Lena CV.pdf', cvExtractedText: 'Hello CV' })

    const link = await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators/${modId}/cv`, headers: { cookie } })
    expect(link.statusCode).toBe(200)
    const path = new URL(link.json().url).pathname.replace(/^\/api/, '')
    const dl = await app.inject({ method: 'GET', url: path })
    expect(dl.statusCode).toBe(200)
    expect(dl.headers['content-type']).toBe('application/pdf')
    expect(dl.body.startsWith('%PDF-')).toBe(true)

    const tampered = await app.inject({ method: 'GET', url: path.slice(0, -4) + 'AAAA' })
    expect(tampered.statusCode).toBe(404)

    const del = await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/moderators/${modId}/cv`, headers: { cookie } })
    expect(del.json().hasCv).toBe(false)
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(404)
  })

  it('compensation: points, conversion, metrics, configs, payments', async () => {
    const pts = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/compensation/points`, payload: { metrics: [{ metricKey: 'messages', label: 'Messages', points: 0.5 }, { metricKey: 'bans', label: 'Bans', points: 5 }] }, headers: { cookie } })
    expect(pts.statusCode, pts.body).toBe(200)
    expect(pts.json().metrics).toHaveLength(2)
    const again = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/compensation/points`, payload: { metrics: [{ metricKey: 'messages', label: 'Messages handled', points: 1 }] }, headers: { cookie } })
    expect(again.json().metrics[0]).toMatchObject({ label: 'Messages handled', points: 1 })
    const list = await app.inject({ method: 'GET', url: `/workspaces/${ws}/compensation/points`, headers: { cookie } })
    expect(list.json().metrics).toHaveLength(2)

    const conv = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/compensation/conversion`, payload: { rate: 0.02, currency: 'USD' }, headers: { cookie } })
    expect(conv.json().conversion).toEqual({ rate: 0.02, currency: 'USD' })

    const met = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/compensation/metrics`, payload: { moderatorId: modId, metricKey: 'messages', value: 120 }, headers: { cookie } })
    expect(met.statusCode, met.body).toBe(200)
    const metList = await app.inject({ method: 'GET', url: `/workspaces/${ws}/compensation/metrics`, headers: { cookie } })
    expect(metList.json().metrics).toEqual([{ moderatorId: modId, metricKey: 'messages', value: 120, period: 'current' }])

    const foreign = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/compensation/metrics`, payload: { moderatorId: '00000000-0000-4000-8000-000000000000', metricKey: 'messages', value: 1 }, headers: { cookie } })
    expect(foreign.statusCode).toBe(400)

    const cfg = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/compensation/configs/${modId}`, payload: { kind: 'both', fixedAmount: 300, fixedCurrency: 'USDT', fixedPeriod: 'monthly' }, headers: { cookie } })
    expect(cfg.statusCode, cfg.body).toBe(200)
    expect(cfg.json().config).toMatchObject({ kind: 'both', fixedAmount: 300 })

    const pay = await app.inject({ method: 'POST', url: `/workspaces/${ws}/compensation/payments`, payload: { moderatorId: modId, amount: 300, currency: 'USDT', period: '2026-08' }, headers: { cookie } })
    expect(pay.statusCode, pay.body).toBe(201)
    const pays = await app.inject({ method: 'GET', url: `/workspaces/${ws}/compensation/payments`, headers: { cookie } })
    expect(pays.json().payments).toHaveLength(1)
  })

  it('deleting the moderator cascades metrics, configs and payments', async () => {
    const d = await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/moderators/${modId}`, headers: { cookie } })
    expect(d.statusCode).toBe(204)
    expect(await db.query.payments.findFirst({ where: eq(schema.payments.moderatorId, modId) })).toBeUndefined()
    expect(await db.query.compensationConfigs.findFirst({ where: eq(schema.compensationConfigs.moderatorId, modId) })).toBeUndefined()
  })

  it('enforces the moderator quota (starter = 3)', async () => {
    const starter = await makeUser('starter', 'starter')
    const w = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Small' }, headers: { cookie: starter } })
    const wid = w.json().id
    const codes: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = await app.inject({ method: 'POST', url: `/workspaces/${wid}/moderators`, payload: { fullName: `M${i}` }, headers: { cookie: starter } })
      codes.push(r.statusCode)
    }
    expect(codes).toEqual([201, 201, 201, 403])
  })
})
