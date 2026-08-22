// Dev helper: build a report for a workspace and print it. Not shipped in docs.
import { eq } from 'drizzle-orm'
import { closeDatabase, db } from '../db/client.js'
import { workspaces } from '../db/schema/index.js'
import { buildReport } from '../modules/ai/report/build.js'
const name = process.env.WS ?? 'Demo Workspace'
const [ws] = await db.select().from(workspaces).where(eq(workspaces.name, name)).limit(1)
if (!ws) throw new Error('no workspace ' + name)
const r = await buildReport({ workspace: { id: ws.id, name: ws.name }, period: (process.env.PERIOD as '7d' | '30d' | '90d') ?? '30d', userId: null, reuse: process.env.REUSE !== '0' })
console.log(JSON.stringify(r, null, 1))
await closeDatabase()
