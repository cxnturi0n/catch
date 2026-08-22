import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { emailOutbox } = await import('../src/email/sender.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()

async function makeUser(tag: string) {
  const email = `mem-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: 'members-test-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'members-test-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  return { email, cookie: (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ') }
}

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'mem-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('workspace members and invites', () => {
  let owner: { email: string; cookie: string }
  let guest: { email: string; cookie: string }
  let stranger: { email: string; cookie: string }
  let ws = ''
  let token = ''

  it('owner invites by e-mail; link masks the address; wrong account cannot accept', async () => {
    owner = await makeUser('owner')
    guest = await makeUser('guest')
    stranger = await makeUser('stranger')
    ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Team' }, headers: { cookie: owner.cookie } })).json().id

    const inv = await app.inject({ method: 'POST', url: `/workspaces/${ws}/members/invites`, payload: { email: guest.email.toUpperCase(), role: 'admin' }, headers: { cookie: owner.cookie } })
    expect(inv.statusCode, inv.body).toBe(201)
    const mail = emailOutbox.findLast((m) => m.to === guest.email)!
    token = mail.text.match(/\/invite\/(\S+)/)![1]!
    expect(mail.subject).toContain('Team')

    const info = await app.inject({ method: 'GET', url: `/invites/${token}` })
    expect(info.statusCode).toBe(200)
    expect(info.json()).toMatchObject({ workspace: 'Team', role: 'admin' })
    expect(info.body).not.toContain(guest.email)

    const wrong = await app.inject({ method: 'POST', url: `/invites/${token}/accept`, headers: { cookie: stranger.cookie } })
    expect(wrong.statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/invites/${token}/accept` })).statusCode).toBe(401)
  })

  it('invited user accepts, gains access with the role, link is single-use', async () => {
    expect((await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators`, headers: { cookie: guest.cookie } })).statusCode).toBe(404)
    const ok = await app.inject({ method: 'POST', url: `/invites/${token}/accept`, headers: { cookie: guest.cookie } })
    expect(ok.statusCode, ok.body).toBe(200)
    expect(ok.json()).toEqual({ workspaceId: ws, role: 'admin' })
    expect((await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators`, headers: { cookie: guest.cookie } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/invites/${token}` })).statusCode).toBe(404)

    const list = await app.inject({ method: 'GET', url: `/workspaces/${ws}/members`, headers: { cookie: guest.cookie } })
    expect(list.json().members).toHaveLength(2)
    expect(list.json().invites).toHaveLength(0)
    expect(list.json().me.role).toBe('admin')
  })

  it('roles: admin can manage data but not change roles; owner locked; member can leave', async () => {
    const guestId = (await db.query.user.findFirst({ where: eq(schema.user.email, guest.email) }))!.id
    const ownerId = (await db.query.user.findFirst({ where: eq(schema.user.email, owner.email) }))!.id
    // admin may add moderators
    expect((await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators`, payload: { fullName: 'By admin' }, headers: { cookie: guest.cookie } })).statusCode).toBe(201)
    // admin may not change roles (owner only)
    expect((await app.inject({ method: 'PATCH', url: `/workspaces/${ws}/members/${guestId}`, payload: { role: 'member' }, headers: { cookie: guest.cookie } })).statusCode).toBe(403)
    // owner demotes admin → member
    expect((await app.inject({ method: 'PATCH', url: `/workspaces/${ws}/members/${guestId}`, payload: { role: 'member' }, headers: { cookie: owner.cookie } })).json().member.role).toBe('member')
    // member may not add moderators any more
    expect((await app.inject({ method: 'POST', url: `/workspaces/${ws}/moderators`, payload: { fullName: 'By member' }, headers: { cookie: guest.cookie } })).statusCode).toBe(403)
    // nobody removes the owner
    expect((await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/members/${ownerId}`, headers: { cookie: owner.cookie } })).statusCode).toBe(400)
    // member leaves
    expect((await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/members/${guestId}`, headers: { cookie: guest.cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/workspaces/${ws}/moderators`, headers: { cookie: guest.cookie } })).statusCode).toBe(404)
  })
})
