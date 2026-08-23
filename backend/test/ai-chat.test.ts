import './setup-env.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, like } from 'drizzle-orm'

const { buildApp } = await import('../src/app.js')
const { db, closeDatabase } = await import('../src/db/client.js')
const schema = await import('../src/db/schema/index.js')
const { chatTurn } = await import('../src/modules/ai/chat/run.js')
const { runTool, toolDefinitions } = await import('../src/modules/ai/chat/tools.js')
const { loadHelpDocs, searchHelp } = await import('../src/modules/ai/chat/help.js')

type App = Awaited<ReturnType<typeof buildApp>>
let app: App
const stamp = Date.now()
let cookie = ''
let ws = ''
let userId = ''
let otherWs = ''

beforeAll(async () => {
  app = await buildApp()
  await db.delete(schema.rateLimit)
  const email = `aichat-${stamp}@example.test`
  await app.inject({ method: 'POST', url: '/auth/sign-up/email', payload: { name: 'c', email, password: 'ai-chat-pw-123' }, headers: { origin: process.env.APP_URL! } })
  await db.update(schema.user).set({ emailVerified: true, plan: 'pro' }).where(eq(schema.user.email, email))
  userId = (await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)))[0]!.id
  const si = await app.inject({ method: 'POST', url: '/auth/sign-in/email', payload: { email, password: 'ai-chat-pw-123' }, headers: { origin: process.env.APP_URL! } })
  const raw = si.headers['set-cookie']
  cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((c) => c.split(';')[0]).join('; ')
  ws = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Chat WS' }, headers: { cookie } })).json().id
  otherWs = (await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Other WS' }, headers: { cookie } })).json().id
  await db.insert(schema.incidents).values([
    { workspaceId: ws, type: 'Scam', channel: '#general', status: 'Open' },
    { workspaceId: otherWs, type: 'SECRET-OTHER-WS', channel: '#x', status: 'Open' },
  ])
  await loadHelpDocs()
})
afterAll(async () => {
  await db.delete(schema.user).where(like(schema.user.email, 'aichat-%@example.test'))
  await app.close()
  await closeDatabase()
})

describe('tools', () => {
  it('are all read-only, have JSON schemas and stable order', () => {
    const defs = toolDefinitions()
    expect(defs.map((d) => d.name)).toEqual(['get_overview', 'get_section', 'get_metric_series', 'get_moderators', 'list_incidents', 'list_kols', 'list_tasks', 'get_latest_report', 'search_help'])
    for (const d of defs) expect(d.input_schema.type).toBe('object')
  })

  it('are bound to the context workspace and validate arguments', async () => {
    const ctx = { workspace: { id: ws, name: 'Chat WS' }, now: new Date() }
    const mine = await runTool('list_incidents', {}, ctx)
    expect(mine.record.ok).toBe(true)
    expect(mine.content).toContain('Scam')
    expect(mine.content).not.toContain('SECRET-OTHER-WS')
    const bad = await runTool('list_incidents', { status: 'Nope', limit: 999 }, ctx)
    expect(bad.record.ok).toBe(false)
    expect(bad.content).toContain('invalid arguments')
    const unknown = await runTool('drop_table', {}, ctx)
    expect(unknown.content).toContain('unknown tool')
  })

  it('search_help finds metric definitions', async () => {
    const hits = await searchHelp('engagement rate')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.slug === 'metrics-definitions')).toBe(true)
  })
})

describe('chat turn with a fake model', () => {
  it('runs requested tools, persists both messages, records usage, enforces the tool cap', async () => {
    let calls = 0
    const fake = {
      create: async (params: { messages: unknown[]; tools?: unknown[] }) => {
        calls++
        const base = { id: 'm', type: 'message', role: 'assistant', model: 'fake', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_sequence: null }
        if (calls === 1) return { ...base, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'list_incidents', input: { status: 'Open' } }] }
        return { ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: `There is 1 open incident (Scam). Tools offered: ${params.tools?.length ?? 0}` }] }
      },
    }
    const r = await chatTurn({ workspace: { id: ws, name: 'Chat WS', platforms: [] }, user: { id: userId, plan: 'pro' }, conversationId: null, message: 'open incidents?', client: fake as never })
    expect(calls).toBe(2)
    expect(r.tools.map((t) => t.name)).toEqual(['list_incidents'])
    expect(r.content).toContain('open incident')
    const msgs = await db.select().from(schema.aiMessages).where(eq(schema.aiMessages.conversationId, r.conversationId))
    expect(msgs.map((m) => m.role).sort()).toEqual(['assistant', 'user'])
    const ev = await db.select().from(schema.usageEvents).where(eq(schema.usageEvents.workspaceId, ws))
    expect(ev.some((e) => e.eventType === 'ai_chat_message')).toBe(true)

    // Second turn in the same conversation sees history; tool cap stops a greedy model.
    let greedy = 0
    const greedyClient = {
      create: async () => {
        greedy++
        const base = { id: 'm', type: 'message', role: 'assistant', model: 'fake', usage: { input_tokens: 1, output_tokens: 1 }, stop_sequence: null }
        if (greedy <= 10) return { ...base, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${greedy}`, name: 'list_kols', input: {} }] }
        return { ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] }
      },
    }
    const r2 = await chatTurn({ workspace: { id: ws, name: 'Chat WS', platforms: [] }, user: { id: userId, plan: 'starter' }, conversationId: r.conversationId, message: 'more', client: greedyClient as never })
    expect(r2.conversationId).toBe(r.conversationId)
    expect(r2.tools.length).toBeLessThanOrEqual(4)
  })

  it('conversation endpoints are scoped to the user and workspace', async () => {
    const list = await app.inject({ method: 'GET', url: `/workspaces/${ws}/ai/conversations`, headers: { cookie } })
    expect(list.statusCode).toBe(200)
    const id = list.json().conversations[0].id
    const one = await app.inject({ method: 'GET', url: `/workspaces/${ws}/ai/conversations/${id}`, headers: { cookie } })
    expect(one.json().messages.length).toBeGreaterThan(0)
    const cross = await app.inject({ method: 'GET', url: `/workspaces/${otherWs}/ai/conversations/${id}`, headers: { cookie } })
    expect(cross.statusCode).toBe(404)
    const del = await app.inject({ method: 'DELETE', url: `/workspaces/${ws}/ai/conversations/${id}`, headers: { cookie } })
    expect(del.statusCode).toBe(204)
  })

  it('chat route refuses when AI is not configured', async () => {
    const { config } = await import('../src/config.js')
    const prev = config.ANTHROPIC_API_KEY
    ;(config as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY = undefined
    try {
      const res = await app.inject({ method: 'POST', url: `/workspaces/${ws}/ai/chat`, payload: { message: 'hi' }, headers: { cookie } })
      expect(res.statusCode).toBe(503)
    } finally {
      ;(config as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY = prev
    }
  })
})
