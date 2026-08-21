// Creates a demo workspace with coherent sample data for a given user.
// Never runs as part of migrations. Usage:
//   DEMO_USER_EMAIL=you@example.com npm run seed:demo
import { eq } from 'drizzle-orm'
import { db, closeDatabase } from '../src/db/client.js'
import * as s from '../src/db/schema/index.js'
import { logger } from '../src/logger.js'

const email = process.env.DEMO_USER_EMAIL
if (!email) throw new Error('DEMO_USER_EMAIL is required')

const owner = await db.query.user.findFirst({ where: eq(s.user.email, email) })
if (!owner) throw new Error(`no user with email ${email}`)

await db.transaction(async (tx) => {
  const [ws] = await tx
    .insert(s.workspaces)
    .values({ ownerId: owner.id, name: 'Aurelia Protocol (Demo)', projectType: 'DeFi', communitySize: '10k-50k', platforms: ['discord', 'telegram'] })
    .returning()
  await tx.insert(s.workspaceMembers).values({ workspaceId: ws!.id, userId: owner.id, role: 'owner' })

  const mods = await tx
    .insert(s.moderators)
    .values(
      ['Lena Ortiz', 'Kai Tanaka', 'Marco Bianchi'].map((fullName, i) => ({
        workspaceId: ws!.id,
        fullName,
        discordHandle: fullName.toLowerCase().replace(' ', '.'),
        platforms: ['discord'],
        contractType: i === 0 ? 'Part-time' : 'Volunteer',
        status: 'On Duty',
        shiftStartUtc: (i * 8) % 24,
        shiftEndUtc: (i * 8 + 8) % 24,
        country: ['ES', 'JP', 'IT'][i]!,
      })),
    )
    .returning()

  await tx.insert(s.pointsConfig).values([
    { workspaceId: ws!.id, metricKey: 'messages', label: 'Messages handled', points: '0.5' },
    { workspaceId: ws!.id, metricKey: 'incidents_resolved', label: 'Incidents resolved', points: '10' },
  ])
  await tx.insert(s.conversionConfig).values({ workspaceId: ws!.id, rate: '0.02', currency: 'USD' })

  const today = new Date()
  const days = Array.from({ length: 14 }, (_, i) => new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10))
  await tx.insert(s.platformMetrics).values(
    days.flatMap((date, i) => [
      { workspaceId: ws!.id, platform: 'discord', date, metrics: { members: 12_400 + i * 35, bans_7d: 2 } },
      { workspaceId: ws!.id, platform: 'telegram', date, metrics: { members: 8_100 + i * 12 } },
    ]),
  )
  await tx.insert(s.tasks).values([
    { workspaceId: ws!.id, title: 'Publish weekly recap', assignee: mods[0]!.fullName, priority: 'High', status: 'In Progress', area: 'Content' },
    { workspaceId: ws!.id, title: 'Review moderator applications', priority: 'Medium', status: 'To Do', area: 'Team' },
  ])
  logger.info({ workspaceId: ws!.id, moderators: mods.length }, 'demo workspace created')
})

await closeDatabase()
