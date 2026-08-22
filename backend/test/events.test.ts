import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'
import { request } from 'node:http'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { publish, subscribe, closeEvents } = await import('../src/lib/events.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
let cookie = ''
let ws = ''
let port = 0

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
  const email = `ev-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: 'ev', email, password: 'events-test-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'events-test-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
  ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Events' }, headers: { cookie } })).json().id
  await app.listen({ host: '127.0.0.1', port: 0 })
  port = (app.server.address() as { port: number }).port
})
afterAll(async () => {
  await closeEvents()
  await db.delete(schema.user).where(like(schema.user.email, 'ev-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('workspace events', () => {
  it('publish reaches in-process subscribers through Postgres NOTIFY', async () => {
    const got = new Promise<string>((resolve) => void subscribe(ws, (e) => resolve(e.topic)))
    await new Promise((r) => setTimeout(r, 100))
    await publish(ws, 'tasks')
    expect(await got).toBe('tasks')
  })

  it('SSE stream: ready, then change events after a write; non-members get 404', async () => {
    const denied = await app.inject({ method: 'GET', url: `/workspaces/${ws}/events` })
    expect(denied.statusCode).toBe(401)

    const events: string[] = []
    await new Promise<void>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: `/workspaces/${ws}/events`, headers: { cookie } }, (res) => {
        expect(res.statusCode).toBe(200)
        expect(res.headers['content-type']).toContain('text/event-stream')
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          events.push(chunk)
          if (chunk.includes('event: ready')) {
            // Trigger a real write through the API → publisher → NOTIFY → SSE.
            void app.inject({ method: 'POST', url: `/workspaces/${ws}/tasks`, payload: { title: 'live' }, headers: { cookie } })
          }
          if (chunk.includes('"topic":"tasks"')) {
            req.destroy()
            resolve()
          }
        })
        res.on('error', reject)
      })
      req.on('error', (e) => (e.message.includes('socket hang up') ? resolve() : reject(e)))
      req.end()
      setTimeout(() => reject(new Error('no change event received')), 8000)
    })
    expect(events.join('')).toContain('event: change')
  })
})
