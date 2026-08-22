import { describe, expect, it, vi } from 'vitest'

// Boot the app without a database: readiness must report 503, liveness 200,
// unknown routes the uniform error envelope.
vi.mock('../src/db/client.js', () => ({
  db: {},
  pool: {},
  pingDatabase: async () => false,
  closeDatabase: async () => {},
}))
process.env.APP_URL ??= 'http://localhost:5173'
process.env.API_URL ??= 'http://localhost:3000'
process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-1234'
process.env.DATABASE_URL ??= 'postgres://x:x@localhost:5432/x'

const { buildApp } = await import('../src/app.js')

describe('health routes', () => {
  it('GET /healthz → 200', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })

  it('GET /readyz → 503 when the database is unreachable', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('unknown route → error envelope', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
    await app.close()
  })
})
