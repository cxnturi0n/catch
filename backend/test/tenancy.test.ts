import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

// Tenancy sweep: every route under /workspaces/:workspaceId must answer 404
// to a signed-in user who is not a member, for every method, regardless of
// body. The guard runs before validation, so even a garbage body cannot turn
// the answer into a 400 that would reveal the workspace exists.
const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
let cookieA = ''
let wsB = ''

async function signIn(tag: string) {
  const email = `tenancy-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: 'tenancy-pw-12345' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true, plan: 'pro' }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'tenancy-pw-12345' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  return (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
}

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
  cookieA = await signIn('a')
  const cookieB = await signIn('b')
  wsB = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'B only' }, headers: { cookie: cookieB } })).json().id
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'tenancy-%@example.test'))
  await app.close()
  await closeDatabase()
})

const UUID = '11111111-1111-4111-8111-111111111111'

describe('workspace routes deny non-members', () => {
  it('covers every registered :workspaceId route', async () => {
    const routes = app.routeList.filter((r) => r.url.includes(':workspaceId') && !['HEAD', 'OPTIONS'].includes(r.method))
    expect(routes.length).toBeGreaterThan(60)
    const failures: string[] = []
    for (const r of routes) {
      const url = r.url.replace(':workspaceId', wsB).replace(/:[a-zA-Z]+/g, UUID).replace(/\*$/, 'x')
      const hasBody = ['POST', 'PUT', 'PATCH'].includes(r.method)
      const res = await app.inject({ method: r.method as 'GET', url, headers: hasBody ? { cookie: cookieA, 'content-type': 'application/json' } : { cookie: cookieA }, payload: hasBody ? {} : undefined })
      if (res.statusCode !== 404 || !res.body.includes('Workspace not found')) failures.push(`${r.method} ${r.url} → ${res.statusCode} ${res.body.slice(0, 80)}`)
      // Anonymous: 401, never a hint about the workspace.
      const anon = await app.inject({ method: r.method as 'GET', url, headers: hasBody ? { 'content-type': 'application/json' } : {}, payload: hasBody ? {} : undefined })
      if (anon.statusCode !== 401) failures.push(`anon ${r.method} ${r.url} → ${anon.statusCode}`)
    }
    expect(failures).toEqual([])
  })

  it('a random workspace id and a malformed id both read as not found', async () => {
    for (const id of [UUID, 'not-a-uuid', '../../etc']) {
      const res = await app.inject({ method: 'GET', url: `/workspaces/${encodeURIComponent(id)}/moderators`, headers: { cookie: cookieA } })
      expect(res.statusCode).toBe(404)
    }
  })
})
