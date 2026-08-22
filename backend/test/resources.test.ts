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

async function makeUser(tag: string) {
  const email = `res-${tag}-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: tag, email, password: 'resources-test-pw' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email))
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'resources-test-pw' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  return (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
}

function multipart(fields: Record<string, string>, file?: { name: string; type: string; content: string }) {
  const b = 'xxRESxx'
  const parts: string[] = []
  for (const [k, v] of Object.entries(fields)) parts.push(`--${b}`, `Content-Disposition: form-data; name="${k}"`, '', v)
  if (file) parts.push(`--${b}`, `Content-Disposition: form-data; name="file"; filename="${file.name}"`, `Content-Type: ${file.type}`, '', file.content)
  parts.push(`--${b}--`, '')
  return { payload: parts.join('\r\n'), type: `multipart/form-data; boundary=${b}` }
}

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'res-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('resources', () => {
  let cookie = ''
  let other = ''
  let ws = ''
  let folderId = ''
  let fileId = ''
  const base = () => `/workspaces/${ws}/resources`

  it('setup', async () => {
    cookie = await makeUser('a')
    other = await makeUser('b')
    ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Drive' }, headers: { cookie } })).json().id
  })

  it('folders: create, list with stats, pin, delete keeps files', async () => {
    const c = await app.inject({ method: 'POST', url: `${base()}/folders`, payload: { name: 'Playbooks', sectionType: 'Playbook' }, headers: { cookie } })
    expect(c.statusCode, c.body).toBe(201)
    folderId = c.json().folder.id

    const link = await app.inject({ method: 'POST', url: `${base()}/links`, payload: { folderId, title: 'Notion SOP', externalUrl: 'https://notion.so/x' }, headers: { cookie } })
    expect(link.statusCode, link.body).toBe(201)
    const js = await app.inject({ method: 'POST', url: `${base()}/links`, payload: { folderId, title: 'bad', externalUrl: 'javascript:alert(1)' }, headers: { cookie } })
    expect(js.statusCode).toBe(400)

    const list = await app.inject({ method: 'GET', url: `${base()}/folders`, headers: { cookie } })
    expect(list.json().folders[0]).toMatchObject({ name: 'Playbooks', fileCount: 1 })
    expect(list.json().folders[0].filePreview[0].title).toBe('Notion SOP')
    expect(list.json().unfiled.count).toBe(0)

    const pin = await app.inject({ method: 'PATCH', url: `${base()}/folders/${folderId}`, payload: { pinned: true }, headers: { cookie } })
    expect(pin.json().folder.pinned).toBe(true)
  })

  it('upload: stores the file, blocks executables, serves a signed url, logs views', async () => {
    const exe = multipart({ folderId, title: 'evil' }, { name: 'run.exe', type: 'application/octet-stream', content: 'MZ' })
    const blocked = await app.inject({ method: 'POST', url: `${base()}/upload`, payload: exe.payload, headers: { cookie, 'content-type': exe.type } })
    expect(blocked.statusCode).toBe(400)

    const ok = multipart({ folderId, title: 'Brand kit' }, { name: 'brand kit.pdf', type: 'application/pdf', content: '%PDF-1.4 brand' })
    const up = await app.inject({ method: 'POST', url: `${base()}/upload`, payload: ok.payload, headers: { cookie, 'content-type': ok.type } })
    expect(up.statusCode, up.body).toBe(201)
    fileId = up.json().resource.id
    expect(up.json().resource).toMatchObject({ kind: 'file', hasFile: true, sizeBytes: 14, mimeType: 'application/pdf' })
    expect(up.body).not.toContain('storagePath')

    const files = await app.inject({ method: 'GET', url: `${base()}?folderId=${folderId}`, headers: { cookie } })
    expect(files.json().resources).toHaveLength(2)

    const url = await app.inject({ method: 'GET', url: `${base()}/${fileId}/url`, headers: { cookie } })
    const path = new URL(url.json().url).pathname
    const dl = await app.inject({ method: 'GET', url: path })
    expect(dl.statusCode).toBe(200)
    expect(dl.body).toBe('%PDF-1.4 brand')

    expect((await app.inject({ method: 'POST', url: `${base()}/${fileId}/view`, payload: {}, headers: { cookie } })).statusCode).toBe(204)
    const stats = await app.inject({ method: 'GET', url: `${base()}/stats`, headers: { cookie } })
    expect(stats.json().stats[0]).toMatchObject({ resourceId: fileId, viewCount: 1, uniqueViewers: 1 })
  })

  it('non-members get 404 everywhere', async () => {
    for (const r of await Promise.all([
      app.inject({ method: 'GET', url: `${base()}/folders`, headers: { cookie: other } }),
      app.inject({ method: 'GET', url: `${base()}/${fileId}/url`, headers: { cookie: other } }),
      app.inject({ method: 'DELETE', url: `${base()}/${fileId}`, headers: { cookie: other } }),
    ]))
      expect(r.statusCode).toBe(404)
  })

  it('deleting a folder unfiles its resources; deleting a file removes the object', async () => {
    expect((await app.inject({ method: 'DELETE', url: `${base()}/folders/${folderId}`, headers: { cookie } })).statusCode).toBe(204)
    const list = await app.inject({ method: 'GET', url: `${base()}/folders`, headers: { cookie } })
    expect(list.json().unfiled.count).toBe(2)

    const url = (await app.inject({ method: 'GET', url: `${base()}/${fileId}/url`, headers: { cookie } })).json().url
    expect((await app.inject({ method: 'DELETE', url: `${base()}/${fileId}`, headers: { cookie } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: new URL(url).pathname })).statusCode).toBe(404)
  })
})
