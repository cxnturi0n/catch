import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

// Admin discovery forms: create a link, public form resolves it, responses
// count per form, close/reopen, delete guard.
const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
let admin = ''
let member = ''
const slug = `t-${stamp}`

async function makeUser(tag: string, role: 'user' | 'admin') {
  const email = `df-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: 'discovery-forms-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true, role }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'discovery-forms-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  return (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
}

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
  admin = await makeUser('admin', 'admin')
  member = await makeUser('member', 'user')
})
afterAll(async () => {
  await db.delete(schema.discoveryResponses).where(eq(schema.discoveryResponses.slugSnapshot, slug))
  await db.delete(schema.discoveryForms).where(like(schema.discoveryForms.slug, `t-${stamp}%`))
  await db.delete(schema.user).where(like(schema.user.email, 'df-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('discovery forms (admin)', () => {
  it('non admins get 404, admins can create, the public link resolves', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/discovery/forms', headers: { cookie: member } })).statusCode).toBe(404)
    const c = await app.inject({ method: 'POST', url: '/admin/discovery/forms', payload: { slug, contactName: 'Heather', contactEmail: 'h@example.test', source: 'linkedin' }, headers: { cookie: admin } })
    expect(c.statusCode, c.body).toBe(201)
    expect(c.json().form).toMatchObject({ slug, contactName: 'Heather', isActive: true, responses: 0 })
    expect((await app.inject({ method: 'POST', url: '/admin/discovery/forms', payload: { slug }, headers: { cookie: admin } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: '/admin/discovery/forms', payload: { slug: 'Bad Slug!' }, headers: { cookie: admin } })).statusCode).toBe(400)
    const pub = await app.inject({ method: 'GET', url: `/public/discovery/${slug}` })
    expect(pub.json().form).toMatchObject({ slug, contactName: 'Heather' })
    expect(pub.body).not.toContain('h@example.test')
  })
  it('counts responses, close hides the public form, delete is refused with responses', async () => {
    const r = await app.inject({ method: 'POST', url: `/public/discovery/${slug}/responses`, payload: { respondentName: 'Ann', answers: { variant: 'freelance', q1: 'a real answer here' } } })
    expect(r.statusCode).toBe(201)
    const list = await app.inject({ method: 'GET', url: '/admin/discovery/forms', headers: { cookie: admin } })
    const f = list.json().forms.find((x: { slug: string }) => x.slug === slug)
    expect(f.responses).toBe(1)
    const closed = await app.inject({ method: 'PATCH', url: `/admin/discovery/forms/${f.id}`, payload: { isActive: false }, headers: { cookie: admin } })
    expect(closed.json().form.isActive).toBe(false)
    expect((await app.inject({ method: 'GET', url: `/public/discovery/${slug}` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/admin/discovery/forms/${f.id}`, headers: { cookie: admin } })).statusCode).toBe(409)
    const empty = await app.inject({ method: 'POST', url: '/admin/discovery/forms', payload: { slug: `${slug}-2` }, headers: { cookie: admin } })
    expect((await app.inject({ method: 'DELETE', url: `/admin/discovery/forms/${empty.json().form.id}`, headers: { cookie: admin } })).statusCode).toBe(204)
  })
})
