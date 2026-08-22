import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, like } from 'drizzle-orm'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { emailOutbox } = await import('../src/email/sender.js')
const { isDue, dispatchDueReports } = await import('../src/modules/reports/dispatch.js')
const { isSlackWebhookUrl } = await import('../src/modules/reports/report.js')
const { encryptSecret } = await import('../src/lib/crypto.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
const slackCalls: string[] = []
const realFetch = globalThis.fetch
function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input)
  if (url.startsWith('https://hooks.slack.com/')) {
    slackCalls.push(url)
    return Promise.resolve(new Response('ok', { status: 200 }))
  }
  return realFetch(input, init)
}

async function makeUser(tag: string, role: 'user' | 'admin' = 'user') {
  const email = `s6-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: 'slice6-test-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true, role }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'slice6-test-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  return { email, cookie: (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ') }
}

let ws = ''
let owner: { email: string; cookie: string }
let admin: { email: string; cookie: string }
beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch)
  app = await buildApp()
  await db.delete(schema.rateLimit)
  owner = await makeUser('owner')
  admin = await makeUser('admin', 'admin')
  ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Reports' }, headers: { cookie: owner.cookie } })).json().id
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await db.delete(schema.user).where(like(schema.user.email, 's6-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('reports', () => {
  it('schedule: recipients limited to members, Slack host allow-listed, secrets never returned', async () => {
    const bad = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/reports/schedule`, payload: { cadence: 'daily', enabled: true, recipientEmails: ['stranger@example.test'] }, headers: { cookie: owner.cookie } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error.code).toBe('RECIPIENT_NOT_ALLOWED')

    const ssrf = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/reports/schedule`, payload: { cadence: 'daily', enabled: true, slackWebhookUrl: 'http://169.254.169.254/latest/meta-data' }, headers: { cookie: owner.cookie } })
    expect(ssrf.statusCode).toBe(400)
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/T0/B0/x')).toBe(true)
    expect(isSlackWebhookUrl('https://hooks.slack.com.evil.com/services/x')).toBe(false)

    const ok = await app.inject({ method: 'PUT', url: `/workspaces/${ws}/reports/schedule`, payload: { reportType: 'general', cadence: 'daily', time: '09:00', timezone: 'Europe/Rome', enabled: true, recipientEmails: [owner.email], slackWebhookUrl: 'https://hooks.slack.com/services/T0/B0/abc', notionToken: 'secret_notion', notionPageId: '0'.repeat(32) }, headers: { cookie: owner.cookie } })
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.json().schedule).toMatchObject({ enabled: true, hasSlackWebhook: true, hasNotionToken: true, recipientEmails: [owner.email] })
    expect(ok.body).not.toContain('secret_notion')
    expect(ok.body).not.toContain('hooks.slack.com')
    const row = await db.query.reportSchedules.findFirst({ where: eq(schema.reportSchedules.workspaceId, ws) })
    expect(row?.slackWebhookUrlEnc).toMatch(/^v1:/)
  })

  it('send-now delivers email + slack from real data; isDue honours local hour and once-per-day', async () => {
    await app.inject({ method: 'POST', url: `/workspaces/${ws}/incidents`, payload: { type: 'Spam', channel: 'general', status: 'Resolved' }, headers: { cookie: owner.cookie } })
    const before = emailOutbox.length
    const r = await app.inject({ method: 'POST', url: `/workspaces/${ws}/reports/schedule/send-now`, headers: { cookie: owner.cookie } })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json()).toMatchObject({ email: 1, slack: true })
    expect(r.json().notion).toBe(false) // notion call goes to the real network → fails gracefully
    expect(emailOutbox.length).toBe(before + 1)
    expect(emailOutbox.at(-1)!.subject).toContain('General Report')
    expect(emailOutbox.at(-1)!.text).toContain('Incidents: 1 (resolved 1)')
    expect(slackCalls.length).toBe(1)

    const s = (await db.query.reportSchedules.findFirst({ where: eq(schema.reportSchedules.workspaceId, ws) }))!
    const nineRome = new Date('2026-08-22T07:00:00Z') // 09:00 Europe/Rome (CEST)
    expect(isDue(s, nineRome)).toBe(true)
    expect(isDue(s, new Date('2026-08-22T08:00:00Z'))).toBe(false)
    expect(isDue({ ...s, lastSentAt: new Date('2026-08-22T07:05:00Z') }, nineRome)).toBe(false)
    expect(isDue({ ...s, cadence: 'weekly', weekday: 6 }, nineRome)).toBe(true) // 2026-08-22 is a Saturday
    expect(isDue({ ...s, cadence: 'weekly', weekday: 1 }, nineRome)).toBe(false)
    const d = await dispatchDueReports(nineRome)
    expect(d.sent).toBeGreaterThanOrEqual(1)
  })

  it('report runs persist server-side', async () => {
    const c = await app.inject({ method: 'POST', url: `/workspaces/${ws}/reports/runs`, payload: { reportType: 'general', periodStart: '2026-08-01', periodEnd: '2026-08-21', data: { members: 10 } }, headers: { cookie: owner.cookie } })
    expect(c.statusCode, c.body).toBe(201)
    const l = await app.inject({ method: 'GET', url: `/workspaces/${ws}/reports/runs`, headers: { cookie: owner.cookie } })
    expect(l.json().runs).toHaveLength(1)
  })
})

describe('feedback, discovery, kols, ai', () => {
  it('feedback: submit, roadmap shows only public statuses, admin triages', async () => {
    const c = await app.inject({ method: 'POST', url: '/feedback', payload: { category: 'feature', title: 'Dark mode', description: 'Please', rating: 5 }, headers: { cookie: owner.cookie } })
    expect(c.statusCode, c.body).toBe(201)
    const id = c.json().feedback.id
    expect((await app.inject({ method: 'GET', url: '/feedback/roadmap', headers: { cookie: owner.cookie } })).json().items.find((x: { id: string }) => x.id === id)).toBeUndefined()
    expect((await app.inject({ method: 'GET', url: '/admin/feedback', headers: { cookie: owner.cookie } })).statusCode).toBe(404)
    const t = await app.inject({ method: 'PATCH', url: `/admin/feedback/${id}`, payload: { status: 'planned' }, headers: { cookie: admin.cookie } })
    expect(t.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/feedback/roadmap', headers: { cookie: owner.cookie } })).json().items.find((x: { id: string }) => x.id === id)).toBeTruthy()
  })

  it('discovery: public form hides contact email, responses validated and visible to admin only', async () => {
    await db.insert(schema.discoveryForms).values({ slug: `s6-${stamp}`, contactName: 'Owner', contactEmail: 'private@example.test', isActive: true })
    const f = await app.inject({ method: 'GET', url: `/public/discovery/s6-${stamp}` })
    expect(f.statusCode).toBe(200)
    expect(f.body).not.toContain('private@example.test')
    expect((await app.inject({ method: 'GET', url: '/public/discovery/NOPE!' })).statusCode).toBe(400)

    const big = await app.inject({ method: 'POST', url: `/public/discovery/s6-${stamp}/responses`, payload: { answers: { q1: 'x'.repeat(5000) } } })
    expect(big.statusCode).toBe(400)
    const ok = await app.inject({ method: 'POST', url: `/public/discovery/s6-${stamp}/responses`, payload: { respondentName: 'Lena', respondentEmail: 'lena@example.test', answers: { variant: 'agency', q1: 'yes', q2: 'no' }, completionMs: 1200 } })
    expect(ok.statusCode, ok.body).toBe(201)
    expect((await app.inject({ method: 'GET', url: '/admin/discovery/responses', headers: { cookie: owner.cookie } })).statusCode).toBe(404)
    const a = await app.inject({ method: 'GET', url: '/admin/discovery/responses', headers: { cookie: admin.cookie } })
    expect(a.json().rows.some((r: { respondentName: string }) => r.respondentName === 'Lena')).toBe(true)
    await db.delete(schema.discoveryForms).where(eq(schema.discoveryForms.slug, `s6-${stamp}`))
  })

  it('kols + incidents CRUD', async () => {
    const k = await app.inject({ method: 'POST', url: `/workspaces/${ws}/kols`, payload: { name: 'Alice', channel: 'Twitter', reach: 5000 }, headers: { cookie: owner.cookie } })
    expect(k.statusCode, k.body).toBe(201)
    expect((await app.inject({ method: 'GET', url: `/workspaces/${ws}/kols`, headers: { cookie: owner.cookie } })).json().kols).toHaveLength(1)
    expect((await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/kols/${k.json().kol.id}`, headers: { cookie: owner.cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/workspaces/${ws}/incidents`, headers: { cookie: owner.cookie } })).json().incidents).toHaveLength(1)
  })

  it('ai: quota endpoint, 503 without key, snapshot size cap', async () => {
    const q = await app.inject({ method: 'GET', url: `/workspaces/${ws}/ai/quota`, headers: { cookie: owner.cookie } })
    expect(q.json()).toMatchObject({ used: 0, limit: 10 })
    const r = await app.inject({ method: 'POST', url: `/workspaces/${ws}/ai/status-update`, payload: { snapshot: { members: 1 } }, headers: { cookie: owner.cookie } })
    expect([503, 413]).toContain(r.statusCode)
  })

  it('admin overview has the full shape', async () => {
    const o = await app.inject({ method: 'GET', url: '/admin/overview', headers: { cookie: admin.cookie } })
    expect(o.statusCode, o.body).toBe(200)
    expect(o.json()).toMatchObject({ users: { total: expect.any(Number) }, integrations: { totalConnected: expect.any(Number) }, adoption: { total: expect.any(Number) }, feedback: { total: expect.any(Number) } })
  })
})

export const _enc = encryptSecret
