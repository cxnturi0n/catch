import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { memberMessages } from '../db/schema/index.js'

// One human message from a platform member: daily counter + first/last
// timestamps. Shared by the Telegram webhook and the Discord poller.
export async function recordMemberMessage(workspaceId: string, platform: 'telegram' | 'discord', memberRef: string, displayName: string | null, at: Date) {
  const day = at.toISOString().slice(0, 10)
  await db
    .insert(memberMessages)
    .values({ workspaceId, platform, memberRef, displayName, day, messageCount: 1, firstMessageAt: at, lastMessageAt: at })
    .onConflictDoUpdate({
      target: [memberMessages.workspaceId, memberMessages.platform, memberMessages.memberRef, memberMessages.day],
      set: {
        messageCount: sql`${memberMessages.messageCount} + 1`,
        displayName: sql`coalesce(${displayName}, ${memberMessages.displayName})`,
        firstMessageAt: sql`least(coalesce(${memberMessages.firstMessageAt}, ${at}), ${at})`,
        lastMessageAt: sql`greatest(coalesce(${memberMessages.lastMessageAt}, ${at}), ${at})`,
        updatedAt: new Date(),
      },
    })
}
