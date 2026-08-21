import { and, count, eq } from 'drizzle-orm'
import { db, type DbOrTx } from '../../db/client.js'
import { workspaceMembers, workspaces, type Workspace } from '../../db/schema/index.js'

// Every function takes the caller's user id or a workspace id that has
// already passed requireWorkspace. No query here is unscoped.

export async function listForUser(userId: string): Promise<Array<Workspace & { role: string }>> {
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt)
  return rows.map((r) => ({ ...r.workspace, role: r.role }))
}

export async function countOwnedBy(userId: string, tx: DbOrTx = db): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(workspaces).where(eq(workspaces.ownerId, userId))
  return row?.n ?? 0
}

export interface NewWorkspace {
  name: string
  projectType?: string | null
  communitySize?: string | null
  platforms?: string[]
}

export async function create(ownerId: string, input: NewWorkspace, tx: DbOrTx = db): Promise<Workspace> {
  const [ws] = await tx
    .insert(workspaces)
    .values({
      ownerId,
      name: input.name,
      projectType: input.projectType ?? null,
      communitySize: input.communitySize ?? null,
      platforms: input.platforms ?? [],
    })
    .returning()
  await tx.insert(workspaceMembers).values({ workspaceId: ws!.id, userId: ownerId, role: 'owner' })
  return ws!
}

export async function update(workspaceId: string, patch: Partial<NewWorkspace>): Promise<Workspace | undefined> {
  const [ws] = await db
    .update(workspaces)
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.projectType !== undefined && { projectType: patch.projectType }),
      ...(patch.communitySize !== undefined && { communitySize: patch.communitySize }),
      ...(patch.platforms !== undefined && { platforms: patch.platforms }),
    })
    .where(eq(workspaces.id, workspaceId))
    .returning()
  return ws
}

export async function remove(workspaceId: string, ownerId: string): Promise<boolean> {
  const deleted = await db
    .delete(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerId, ownerId)))
    .returning({ id: workspaces.id })
  return deleted.length > 0
}
