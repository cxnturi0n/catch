// Creates a fully populated demo workspace for an existing user so every
// section has something to show. Deterministic, idempotent (re-running
// replaces the demo workspace). Never part of migrations.
//   DEMO_USER_EMAIL=you@example.com npm run seed:demo
import { and, eq } from 'drizzle-orm'
import { db, closeDatabase } from '../src/db/client.js'
import * as s from '../src/db/schema/index.js'
import { logger } from '../src/logger.js'

const email = process.env.DEMO_USER_EMAIL
if (!email) throw new Error('DEMO_USER_EMAIL is required')
const owner = await db.query.user.findFirst({ where: eq(s.user.email, email) })
if (!owner) throw new Error(`no user with email ${email}`)

const NAME = 'Demo Workspace'
const DAYS = 30
const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)
const at = (ago: number, h: number, m = 0) => {
  const d = new Date(Date.now() - ago * 86_400_000)
  d.setUTCHours(h, m, 0, 0)
  return d
}
// Small deterministic PRNG so re-runs produce identical numbers.
let seed = 42
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const ri = (min: number, max: number) => Math.floor(min + rnd() * (max - min + 1))

await db.transaction(async (tx) => {
  const existing = await tx.select({ id: s.workspaces.id }).from(s.workspaces).where(and(eq(s.workspaces.ownerId, owner.id), eq(s.workspaces.name, NAME)))
  for (const e of existing) await tx.delete(s.workspaces).where(eq(s.workspaces.id, e.id))

  const [ws] = await tx.insert(s.workspaces).values({ ownerId: owner.id, name: NAME, projectType: 'DeFi', communitySize: '10k-50k', platforms: ['discord', 'telegram'] }).returning()
  const W = ws!.id
  await tx.insert(s.workspaceMembers).values({ workspaceId: W, userId: owner.id, role: 'owner' })

  // Integrations marked connected with demo metadata but NO credentials: the
  // worker skips them (getCredentials → null) and nothing real is called.
  await tx.insert(s.integrations).values([
    { workspaceId: W, platform: 'discord', status: 'connected', credentialsEnc: null, metadata: { server_name: 'Demo Server', member_count: 12_840, demo: true }, lastSync: new Date() },
    { workspaceId: W, platform: 'telegram', status: 'connected', credentialsEnc: null, metadata: { group_name: 'Demo Community', member_count: 8_312, demo: true }, lastSync: new Date() },
  ])

  // Daily rollups + hourly snapshots for the last 30 days.
  const metrics: (typeof s.platformMetrics.$inferInsert)[] = []
  const snaps: (typeof s.platformMetricSnapshots.$inferInsert)[] = []
  let dMembers = 12_400
  let tMembers = 8_100
  for (let ago = DAYS - 1; ago >= 0; ago--) {
    dMembers += ri(5, 40)
    tMembers += ri(2, 20)
    metrics.push({ workspaceId: W, platform: 'discord', date: day(ago), metrics: { members: dMembers, bans_7d: ri(0, 4) } })
    metrics.push({ workspaceId: W, platform: 'telegram', date: day(ago), metrics: { members: tMembers } })
    if (ago < 2) for (let h = 0; h < 24; h += 1) snaps.push({ workspaceId: W, platform: 'discord', capturedAt: at(ago, h), metrics: { members: dMembers - ri(0, 12), bans_7d: 2 } }, { workspaceId: W, platform: 'telegram', capturedAt: at(ago, h), metrics: { members: tMembers - ri(0, 6) } })
  }
  await tx.insert(s.platformMetrics).values(metrics)
  await tx.insert(s.platformMetricSnapshots).values(snaps)

  // Moderators with handles that match the demo members below.
  const modRows = [
    { fullName: 'Lena Ortiz', discordHandle: 'lena_ortiz', telegramHandle: '@lena_ortiz', country: 'ES', shiftStartUtc: 6, shiftEndUtc: 14, contractType: 'Paid', status: 'On Duty', skills: ['Onboarding', 'Escalations'], languages: ['en', 'es'] },
    { fullName: 'Kai Tanaka', discordHandle: 'kai.t', telegramHandle: '@kai_t', country: 'JP', shiftStartUtc: 14, shiftEndUtc: 22, contractType: 'Paid', status: 'Off Duty', skills: ['Scam detection'], languages: ['en', 'ja'] },
    { fullName: 'Marco Bianchi', discordHandle: 'marcob', telegramHandle: '@marco_b', country: 'IT', shiftStartUtc: 22, shiftEndUtc: 6, contractType: 'Volunteer', status: 'Off Duty', skills: ['Events'], languages: ['en', 'it'] },
  ]
  const mods = await tx.insert(s.moderators).values(modRows.map((m) => ({ workspaceId: W, platforms: ['Discord', 'Telegram'], shiftDays: [1, 2, 3, 4, 5], warnings: [], ...m }))).returning()

  // Member activity: 40 community members + the moderators, 30 days.
  const members = [
    ...mods.map((m) => ({ tg: { ref: `t-${m.id.slice(0, 8)}`, name: m.telegramHandle! }, dc: { ref: `d-${m.id.slice(0, 8)}`, name: m.discordHandle! }, weight: 6 })),
    ...Array.from({ length: 40 }, (_, i) => ({ tg: { ref: `t-${1000 + i}`, name: `@member_${i + 1}` }, dc: { ref: `d-${2000 + i}`, name: `member_${i + 1}` }, weight: ri(1, 4) })),
  ]
  const mm: (typeof s.memberMessages.$inferInsert)[] = []
  const act = new Map<string, number>()
  for (let ago = DAYS - 1; ago >= 0; ago--) {
    for (const m of members) {
      for (const [platform, who] of [['telegram', m.tg], ['discord', m.dc]] as const) {
        if (rnd() < 0.35) continue
        const n = ri(1, 5 * m.weight)
        const firstH = ri(6, 20)
        const first = at(ago, firstH, ri(0, 59))
        const last = at(ago, Math.min(23, firstH + ri(0, 6)), ri(0, 59))
        mm.push({ workspaceId: W, platform, memberRef: who.ref, displayName: who.name, day: day(ago), messageCount: n, firstMessageAt: first, lastMessageAt: last })
        for (let k = 0; k < n; k++) {
          const b = at(ago, ri(firstH, Math.min(23, firstH + 6))).toISOString()
          act.set(`${platform}|${b}`, (act.get(`${platform}|${b}`) ?? 0) + 1)
        }
      }
    }
  }
  await tx.insert(s.memberMessages).values(mm)
  await tx.insert(s.messageActivity).values([...act.entries()].map(([k, c]) => ({ workspaceId: W, platform: k.split('|')[0] as 'telegram' | 'discord', bucketStart: new Date(k.split('|')[1]!), messageCount: c })))

  // Telegram joins/leaves, Discord tenure + membership snapshots.
  await tx.insert(s.telegramMembershipEvents).values(Array.from({ length: 60 }, (_, i) => ({ workspaceId: W, chatId: '-1001', userRef: `t-${3000 + i}`, displayName: `@newcomer_${i}`, eventType: (i % 5 === 0 ? 'leave' : 'join') as 'join' | 'leave', occurredAt: at(ri(0, 6), ri(0, 23), ri(0, 59)) })))
  await tx.insert(s.discordMemberTenure).values(Array.from({ length: 300 }, (_, i) => ({ workspaceId: W, memberRef: `d-${5000 + i}`, joinedAt: at(ri(1, 400), 12), firstSeen: at(29, 0), lastSeen: at(i % 9 === 0 ? ri(2, 20) : 0, 0) })))
  await tx.insert(s.discordMembershipSnapshots).values(Array.from({ length: 12 }, (_, i) => ({ workspaceId: W, capturedAt: at(11 - i, 1), totalMembers: 11_900 + i * 70, newMembers: ri(20, 90), leftMembers: ri(5, 30) })))

  // Compensation, payments.
  await tx.insert(s.pointsConfig).values([
    { workspaceId: W, metricKey: 'messages', label: 'Messages handled', points: '0.5' },
    { workspaceId: W, metricKey: 'incidents_resolved', label: 'Incidents resolved', points: '10' },
    { workspaceId: W, metricKey: 'events_hosted', label: 'Events hosted', points: '25' },
  ])
  await tx.insert(s.conversionConfig).values({ workspaceId: W, rate: '0.02', currency: 'USD' })
  await tx.insert(s.moderatorMetrics).values(mods.flatMap((m) => [{ workspaceId: W, moderatorId: m.id, metricKey: 'incidents_resolved', value: String(ri(2, 12)) }, { workspaceId: W, moderatorId: m.id, metricKey: 'events_hosted', value: String(ri(0, 3)) }]))
  await tx.insert(s.compensationConfigs).values(mods.map((m, i) => ({ workspaceId: W, moderatorId: m.id, kind: (i === 2 ? 'variable' : 'both') as 'both' | 'variable', fixedAmount: i === 2 ? null : '400.00', fixedCurrency: i === 2 ? null : ('USDT' as const), fixedPeriod: i === 2 ? null : ('monthly' as const) })))
  await tx.insert(s.payments).values(mods.flatMap((m, i) => (i === 2 ? [] : [{ workspaceId: W, moderatorId: m.id, amount: '400.00', currency: 'USDT', period: day(35).slice(0, 7), paidAt: at(32, 10) }, { workspaceId: W, moderatorId: m.id, amount: '400.00', currency: 'USDT', period: day(5).slice(0, 7), paidAt: at(2, 10) }])))

  // Operations.
  await tx.insert(s.tasks).values([
    { workspaceId: W, title: 'Publish weekly recap', assignee: 'Lena Ortiz', priority: 'High', status: 'In Progress', area: 'Content', startDate: day(2), dueDate: day(-1) },
    { workspaceId: W, title: 'Review moderator applications', assignee: 'Kai Tanaka', priority: 'Medium', status: 'To Do', area: 'Team', dueDate: day(-3) },
    { workspaceId: W, title: 'Update scam-warning pinned message', assignee: 'Marco Bianchi', priority: 'High', status: 'Done', area: 'Safety', dueDate: day(1) },
    { workspaceId: W, title: 'AMA with core team', priority: 'Medium', status: 'To Do', area: 'Events', dueDate: day(-7) },
  ])
  await tx.insert(s.incidents).values(Array.from({ length: 9 }, (_, i) => ({ workspaceId: W, date: day(ri(0, 20)), type: ['Fake Link', 'Impersonation', 'Phishing', 'Rugpull Warning'][i % 4]!, channel: i % 2 ? 'Telegram' : 'Discord', actionTaken: 'User banned, message removed', status: (i % 3 === 0 ? 'Open' : 'Resolved') as 'Open' | 'Resolved' })))
  await tx.insert(s.kols).values([
    { workspaceId: W, name: 'CryptoNadia', handle: '@cryptonadia', channel: 'Twitter', reach: 84_000, status: 'Active', lastActivity: day(1) },
    { workspaceId: W, name: 'DeFi Dan', handle: '@defidan', channel: 'YouTube', reach: 41_000, status: 'Pending', lastActivity: day(9) },
  ])
  await tx.insert(s.meetings).values([{ workspaceId: W, title: 'Weekly mod sync', startsAt: at(-2, 15), endsAt: at(-2, 16), attendeeModeratorIds: mods.map((m) => m.id), createdBy: owner.id }])
  await tx.insert(s.contentSchedule).values([
    { workspaceId: W, title: 'Thread: August roadmap', platform: 'x', scheduledAt: at(-1, 14), status: 'scheduled', ownerUserId: owner.id },
    { workspaceId: W, title: 'Community call recording', platform: 'youtube', scheduledAt: at(3, 18), publishedAt: at(3, 18), status: 'published', ownerUserId: owner.id },
  ])
  const [folder] = await tx.insert(s.resourceFolders).values({ workspaceId: W, name: 'Playbooks', sectionType: 'Playbook', pinned: true, createdBy: owner.id }).returning()
  await tx.insert(s.resources).values([
    { workspaceId: W, folderId: folder!.id, kind: 'external_link', title: 'Moderation SOP', externalUrl: 'https://www.notion.so/demo/moderation-sop', createdBy: owner.id },
    { workspaceId: W, folderId: folder!.id, kind: 'external_link', title: 'Brand kit', externalUrl: 'https://drive.google.com/drive/folders/demo-brand', createdBy: owner.id },
    { workspaceId: W, kind: 'external_link', title: 'Scam report form', externalUrl: 'https://forms.gle/demo-scam', createdBy: owner.id },
  ])

  logger.info({ workspaceId: W, moderators: mods.length, memberRows: mm.length }, 'demo workspace created')
})

// Punctuality events for the last 7 days, derived from the seeded activity.
const { recordShiftEvents } = await import('../src/jobs/moderatorPerformance.js')
const demo = await db.query.workspaces.findFirst({ where: and(eq(s.workspaces.ownerId, owner.id), eq(s.workspaces.name, NAME)) })
for (let i = 1; i <= 7; i++) await recordShiftEvents(demo!.id, day(i))

await closeDatabase()
