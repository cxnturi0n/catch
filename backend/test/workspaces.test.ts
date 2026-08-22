import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { upsertConnected } = await import('../src/modules/integrations/repo.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const PASSWORD = 'workspace-test-pw'
const stamp = Date.now()

async function makeUser(tag: string, plan: 'starter' | 'pro' = 'starter') {
  const email = `ws-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: PASSWORD }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true, plan }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: PASSWORD }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  const cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
  return { email, cookie }
}

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'ws-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('workspaces', () => {
  let alice: { email: string; cookie: string }
  let bob: { email: string; cookie: string }
  let wsId = ''

  it('sign-up cannot set role or plan', async () => {
    const email = `ws-sneaky-${stamp}@example.test`
    await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: 'S', email, password: PASSWORD, role: 'admin', plan: 'enterprise' }, headers: { origin: process.env.APP_URL! } })
    const u = await db.query.user.findFirst({ where: eq(schema.user.email, email) })
    expect(u?.role).toBe('user')
    expect(u?.plan).toBe('starter')
  })

  it('owner creates a workspace and becomes a member', async () => {
    alice = await makeUser('alice')
    bob = await makeUser('bob')
    const r = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Alice DAO', platforms: ['discord'] }, headers: { cookie: alice.cookie } })
    expect(r.statusCode).toBe(201)
    wsId = r.json().id
    expect(r.json().role).toBe('owner')

    const list = await app.inject({ method: 'GET', url: '/workspaces', headers: { cookie: alice.cookie } })
    expect(list.json().workspaces).toHaveLength(1)
    expect(list.json().quota).toMatchObject({ used: 1, limit: 1, reached: true })
  })

  it('enforces the plan quota server-side', async () => {
    const r = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Second' }, headers: { cookie: alice.cookie } })
    expect(r.statusCode, r.body).toBe(403)
    expect(r.body).toContain('QUOTA_EXCEEDED')
  })

  it('validates input', async () => {
    const r = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: '' }, headers: { cookie: bob.cookie } })
    expect(r.statusCode, r.body).toBe(400)
    expect(r.body).toContain('VALIDATION_ERROR')
  })

  it("a non-member gets 404 on every route of someone else's workspace", async () => {
    const attempts = [
      app.inject({ method: 'GET', url: `/workspaces/${wsId}`, headers: { cookie: bob.cookie } }),
      app.inject({ method: 'PATCH', url: `/workspaces/${wsId}`, payload: { name: 'pwned' }, headers: { cookie: bob.cookie } }),
      app.inject({ method: 'DELETE', url: `/workspaces/${wsId}`, headers: { cookie: bob.cookie } }),
      app.inject({ method: 'GET', url: `/workspaces/${wsId}/integrations`, headers: { cookie: bob.cookie } }),
      app.inject({ method: 'DELETE', url: `/workspaces/${wsId}/integrations/discord`, headers: { cookie: bob.cookie } }),
    ]
    for (const r of await Promise.all(attempts)) expect(r.statusCode).toBe(404)
    const still = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, wsId) })
    expect(still?.name).toBe('Alice DAO')
  })

  it('anonymous gets 401', async () => {
    const r = await app.inject({ method: 'GET', url: `/workspaces/${wsId}` })
    expect(r.statusCode).toBe(401)
  })

  it('integration listing never exposes credentials', async () => {
    await upsertConnected(wsId, 'telegram', { bot_token: '123:SECRET', chat_id: '-100' }, { group_name: 'Alice chat' })
    const r = await app.inject({ method: 'GET', url: `/workspaces/${wsId}/integrations`, headers: { cookie: alice.cookie } })
    expect(r.statusCode).toBe(200)
    expect(r.body).not.toContain('SECRET')
    expect(r.body).not.toContain('credentials')
    const tg = r.json().integrations.find((i: { platform: string }) => i.platform === 'telegram')
    expect(tg).toMatchObject({ status: 'connected', metadata: { group_name: 'Alice chat' } })

    const row = await db.query.integrations.findFirst({ where: eq(schema.integrations.workspaceId, wsId) })
    expect(row?.credentialsEnc).toMatch(/^v1:/)
    expect(row?.credentialsEnc).not.toContain('SECRET')
  })

  it('disconnect wipes the secret', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/workspaces/${wsId}/integrations/telegram`, headers: { cookie: alice.cookie } })
    expect(r.statusCode).toBe(204)
    const row = await db.query.integrations.findFirst({ where: eq(schema.integrations.workspaceId, wsId) })
    expect(row?.status).toBe('disconnected')
    expect(row?.credentialsEnc).toBeNull()
  })

  it('admin routes are invisible to normal users and visible to admins', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/overview', headers: { cookie: alice.cookie } })
    expect(r.statusCode).toBe(404)
    await db.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.email, alice.email))
    const r2 = await app.inject({ method: 'GET', url: '/admin/overview', headers: { cookie: alice.cookie } })
    expect(r2.statusCode).toBe(200)
    expect(r2.json().workspaces.total).toBeGreaterThan(0)
  })

  it('owner can delete; cascade removes members and integrations', async () => {
    const r = await app.inject({ method: 'DELETE', url: `/workspaces/${wsId}`, headers: { cookie: alice.cookie } })
    expect(r.statusCode).toBe(204)
    expect(await db.query.workspaceMembers.findFirst({ where: eq(schema.workspaceMembers.workspaceId, wsId) })).toBeUndefined()
    expect(await db.query.integrations.findFirst({ where: eq(schema.integrations.workspaceId, wsId) })).toBeUndefined()
  })
})
