import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()

async function makeUser(tag: string) {
  const email = `ops-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: 'ops-test-password' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'ops-test-password' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  return (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
}

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'ops-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('tasks, meetings, content', () => {
  let cookie = ''
  let other = ''
  let ws = ''

  it('setup', async () => {
    cookie = await makeUser('a')
    other = await makeUser('b')
    ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Ops' }, headers: { cookie } })).json().id
  })

  it('tasks CRUD with area/startDate and validation', async () => {
    const c = await app.inject({ method: 'POST', url: `/workspaces/${ws}/tasks`, payload: { title: 'Ship recap', priority: 'High', area: 'Content', startDate: '2026-08-20', dueDate: '2026-08-25' }, headers: { cookie } })
    expect(c.statusCode, c.body).toBe(201)
    const id = c.json().task.id
    expect(c.json().task).toMatchObject({ status: 'To Do', area: 'Content', startDate: '2026-08-20' })

    const bad = await app.inject({ method: 'POST', url: `/workspaces/${ws}/tasks`, payload: { title: 'x', dueDate: '25/08/2026' }, headers: { cookie } })
    expect(bad.statusCode).toBe(400)

    const u = await app.inject({ method: 'PATCH', url: `/workspaces/${ws}/tasks/${id}`, payload: { status: 'Done', assignee: 'Lena' }, headers: { cookie } })
    expect(u.json().task).toMatchObject({ status: 'Done', assignee: 'Lena' })

    expect((await app.inject({ method: 'GET', url: `/workspaces/${ws}/tasks`, headers: { cookie: other } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url: `/workspaces/${ws}/tasks/${id}`, payload: { title: 'pwn' }, headers: { cookie: other } })).statusCode).toBe(404)

    expect((await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/tasks/${id}`, headers: { cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/workspaces/${ws}/tasks`, headers: { cookie } })).json().tasks).toHaveLength(0)
  })

  it('meetings: range validation, moderator check, list window', async () => {
    const bad = await app.inject({ method: 'POST', url: `/workspaces/${ws}/meetings`, payload: { title: 'Sync', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T09:00:00Z' }, headers: { cookie } })
    expect(bad.statusCode).toBe(400)
    const foreignMod = await app.inject({ method: 'POST', url: `/workspaces/${ws}/meetings`, payload: { title: 'Sync', startsAt: '2026-09-01T10:00:00Z', endsAt: '2026-09-01T11:00:00Z', attendeeModeratorIds: ['00000000-0000-4000-8000-000000000000'] }, headers: { cookie } })
    expect(foreignMod.statusCode).toBe(400)
    const ok = await app.inject({ method: 'POST', url: `/workspaces/${ws}/meetings`, payload: { title: 'Sync', startsAt: new Date(Date.now() + 86_400_000).toISOString(), endsAt: new Date(Date.now() + 90_000_000).toISOString(), attendeeEmails: ['a@example.test'] }, headers: { cookie } })
    expect(ok.statusCode, ok.body).toBe(201)
    const list = await app.inject({ method: 'GET', url: `/workspaces/${ws}/meetings`, headers: { cookie } })
    expect(list.json().meetings).toHaveLength(1)
    expect(list.json().meetings[0].createdBy).toBeTruthy()
    expect((await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/meetings/${ok.json().meeting.id}`, headers: { cookie } })).statusCode).toBe(204)
  })

  it('content schedule CRUD', async () => {
    const c = await app.inject({ method: 'POST', url: `/workspaces/${ws}/content`, payload: { title: 'Thread', platform: 'x', scheduledAt: new Date(Date.now() + 3600_000).toISOString(), attachments: [{ url: 'https://example.com/a.png' }] }, headers: { cookie } })
    expect(c.statusCode, c.body).toBe(201)
    const id = c.json().item.id
    const u = await app.inject({ method: 'PATCH', url: `/workspaces/${ws}/content/${id}`, payload: { status: 'published', publishedAt: new Date().toISOString() }, headers: { cookie } })
    expect(u.json().item.status).toBe('published')
    expect((await app.inject({ method: 'GET', url: `/workspaces/${ws}/content`, headers: { cookie } })).json().items).toHaveLength(1)
    expect((await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/content/${id}`, headers: { cookie } })).statusCode).toBe(204)
  })
})
