import { describe, expect, it } from 'vitest'
import { CLOSE, CLOSE_RESUMABLE, DiscordGatewayConnection, FULL_INTENTS, INTENTS, OP, type GatewayStatePatch, type SocketLike } from '../src/integrations/discord/gateway.js'

// Protocol tests against a fake socket: no network, no database.

class FakeSocket implements SocketLike {
  sent: Array<{ op: number; d?: unknown }> = []
  closed: { code?: number } | null = null
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number) {
    this.closed = { code }
  }
  // Server side helpers
  hello(interval = 60_000) {
    this.onmessage?.({ data: JSON.stringify({ op: OP.HELLO, d: { heartbeat_interval: interval } }) })
  }
  dispatch(t: string, d: unknown, s: number) {
    this.onmessage?.({ data: JSON.stringify({ op: OP.DISPATCH, t, d, s }) })
  }
  op(op: number, d?: unknown) {
    this.onmessage?.({ data: JSON.stringify({ op, d }) })
  }
  serverClose(code: number) {
    this.onclose?.({ code, reason: '' })
  }
  last(op: number) {
    return [...this.sent].reverse().find((p) => p.op === op)
  }
}

const settle = () => new Promise((r) => setTimeout(r, 15))

function harness(opts: { resume?: { sessionId: string; resumeUrl: string; seq: number }; ladderIndex?: number } = {}) {
  const sockets: FakeSocket[] = []
  const states: GatewayStatePatch[] = []
  const dispatched: Array<{ t: string; d: unknown }> = []
  const conn = new DiscordGatewayConnection({
    token: 'tok',
    guildId: 'g1',
    resume: opts.resume ?? null,
    ladderIndex: opts.ladderIndex,
    sockets: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s
    },
    gatewayUrl: async () => 'wss://gateway.test',
    identifyGate: async () => undefined,
    random: () => 0.5,
    hooks: { onDispatch: (t, d) => void dispatched.push({ t, d }), onState: (p) => void states.push(p) },
  })
  return { conn, sockets, states, dispatched }
}

describe('discord gateway connection', () => {
  it('identifies with the full intent set and records the session on READY', async () => {
    const h = harness()
    await h.conn.start()
    const s = h.sockets[0]!
    expect(s.url).toBe('wss://gateway.test/?v=10&encoding=json')
    s.hello()
    await settle()
    const identify = s.last(OP.IDENTIFY)!.d as { token: string; intents: number; properties: { browser: string } }
    expect(identify.token).toBe('tok')
    expect(identify.intents).toBe(FULL_INTENTS)
    expect(FULL_INTENTS).toBe(33287)
    expect(identify.properties.browser).toBe('catch')
    s.dispatch('READY', { session_id: 'sess', resume_gateway_url: 'wss://resume.test' }, 1)
    await settle()
    expect(h.conn.status).toBe('connected')
    expect(h.conn.session).toEqual({ sessionId: 'sess', resumeUrl: 'wss://resume.test', seq: 1 })
    const ready = h.states.find((p) => p.status === 'connected')!
    expect(ready.sessionId).toBe('sess')
    expect(ready.missingIntents).toEqual([])
    await h.conn.stop()
    expect(s.closed?.code).toBe(CLOSE_RESUMABLE)
  })

  it('heartbeats with the last seq, answers server heartbeats, acks update liveness', async () => {
    const h = harness()
    await h.conn.start()
    const s = h.sockets[0]!
    s.hello(30)
    await settle()
    s.dispatch('READY', { session_id: 'x', resume_gateway_url: 'wss://r' }, 7)
    s.op(OP.HEARTBEAT)
    expect(s.last(OP.HEARTBEAT)!.d).toBe(7)
    s.op(OP.HEARTBEAT_ACK)
    expect(h.states.some((p) => p.lastAckAt instanceof Date)).toBe(true)
    await h.conn.stop()
  })

  it('reconnects with RESUME after a missed heartbeat ack', async () => {
    const h = harness()
    await h.conn.start()
    const s = h.sockets[0]!
    s.hello(20)
    await settle()
    s.dispatch('READY', { session_id: 'sess', resume_gateway_url: 'wss://resume.test' }, 3)
    await new Promise((r) => setTimeout(r, 80)) // two beats without ack
    expect(s.closed?.code).toBe(CLOSE_RESUMABLE)
    await settle()
    const s2 = h.sockets[1]!
    expect(s2.url.startsWith('wss://resume.test')).toBe(true)
    s2.hello()
    await settle()
    expect(s2.last(OP.RESUME)!.d).toEqual({ token: 'tok', session_id: 'sess', seq: 3 })
    s2.dispatch('RESUMED', {}, 4)
    expect(h.conn.status).toBe('connected')
    await h.conn.stop()
  })

  it('walks the intent ladder on close 4014 and reports the missing intents', async () => {
    const h = harness()
    await h.conn.start()
    h.sockets[0]!.hello()
    await settle()
    h.sockets[0]!.serverClose(CLOSE.DISALLOWED_INTENTS)
    await settle()
    const s2 = h.sockets[1]!
    s2.hello()
    await settle()
    expect((s2.last(OP.IDENTIFY)!.d as { intents: number }).intents).toBe(FULL_INTENTS & ~INTENTS.MESSAGE_CONTENT)
    expect(h.conn.missingIntents).toEqual(['message_content'])
    s2.serverClose(CLOSE.DISALLOWED_INTENTS)
    await settle()
    const s3 = h.sockets[2]!
    s3.hello()
    await settle()
    expect((s3.last(OP.IDENTIFY)!.d as { intents: number }).intents).toBe(FULL_INTENTS & ~INTENTS.GUILD_MEMBERS)
    expect(h.conn.missingIntents).toEqual(['guild_members'])
    s3.dispatch('READY', { session_id: 's', resume_gateway_url: 'wss://r' }, 1)
    expect(h.states.find((p) => p.status === 'connected')!.missingIntents).toEqual(['guild_members'])
    await h.conn.stop()
  })

  it('op 7 closes resumable and resumes; op 9 (not resumable) identifies again', async () => {
    const h = harness()
    await h.conn.start()
    const s = h.sockets[0]!
    s.hello()
    await settle()
    s.dispatch('READY', { session_id: 'sess', resume_gateway_url: 'wss://resume.test' }, 9)
    s.op(OP.RECONNECT)
    expect(s.closed?.code).toBe(CLOSE_RESUMABLE)
    await settle()
    const s2 = h.sockets[1]!
    s2.hello()
    await settle()
    expect(s2.last(OP.RESUME)).toBeTruthy()
    s2.op(OP.INVALID_SESSION, false)
    await new Promise((r) => setTimeout(r, 3_100)) // 1 + 0.5 * 4 s wait
    const s3 = h.sockets[2]!
    expect(s3.url.startsWith('wss://gateway.test')).toBe(true)
    s3.hello()
    await settle()
    expect(s3.last(OP.IDENTIFY)).toBeTruthy()
    expect(s3.last(OP.RESUME)).toBeUndefined()
    await h.conn.stop()
  }, 10_000)

  it('4004 is terminal: error state, no reconnect', async () => {
    const h = harness()
    await h.conn.start()
    h.sockets[0]!.hello()
    await settle()
    h.sockets[0]!.serverClose(CLOSE.AUTH_FAILED)
    await settle()
    expect(h.conn.status).toBe('error')
    expect(h.states.at(-1)!.lastError).toMatch(/^AUTH_FAILED/)
    expect(h.sockets).toHaveLength(1)
  })

  it('dispatches only events of the connected guild', async () => {
    const h = harness()
    await h.conn.start()
    const s = h.sockets[0]!
    s.hello()
    await settle()
    s.dispatch('READY', { session_id: 's', resume_gateway_url: 'wss://r' }, 1)
    s.dispatch('MESSAGE_CREATE', { id: '1', guild_id: 'other' }, 2)
    s.dispatch('MESSAGE_CREATE', { id: '2', guild_id: 'g1' }, 3)
    s.dispatch('GUILD_CREATE', { id: 'other' }, 4)
    s.dispatch('GUILD_CREATE', { id: 'g1' }, 5)
    await settle()
    expect(h.dispatched.map((x) => x.t)).toEqual(['READY', 'MESSAGE_CREATE', 'GUILD_CREATE'])
    expect(h.conn.session?.seq).toBe(5)
    await h.conn.stop()
  })
})
