import { eq } from 'drizzle-orm'
import { closeDatabase, db } from '../db/client.js'
import { workspaces } from '../db/schema/index.js'
import { buildReport } from '../modules/ai/report/build.js'
const [ws] = await db.select().from(workspaces).where(eq(workspaces.name, process.env.WS ?? 'Demo Workspace')).limit(1)
if (!ws) throw new Error('no workspace')
const r = await buildReport({ workspace: { id: ws.id, name: ws.name }, period: '30d', userId: null, plan: 'pro', reuse: false })
console.log(JSON.stringify(r, null, 1))
await closeDatabase()
