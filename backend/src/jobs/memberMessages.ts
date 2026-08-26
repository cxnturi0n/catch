import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { memberMessages } from '../db/schema/index.js'

// Control characters: NUL is refused by Postgres in text, the rest confuse
// terminals and logs. Built from code points so the source stays printable.
const C = String.fromCharCode
export const CONTROL_CHARS = new RegExp('[' + C(0) + '-' + C(31) + C(127) + ']', 'g')

// Display names are attacker-controlled: strip control characters, cap the length.
export function sanitizeName(raw: string | null | undefined): string | null {
  return raw ? raw.replace(CONTROL_CHARS, '').slice(0, 120) || null : null
}

// Human messages from a platform member: daily counter + first/last
// timestamps. `delta` messages, the earliest at `at`, the latest at `lastAt`.
// Shared by every collector through jobs/ingest.ts.
export async function recordMemberMessage(workspaceId: string, platform: 'telegram' | 'discord', memberRef: string, rawDisplayName: string | null, at: Date, delta = 1, lastAt: Date = at) {
  const day = at.toISOString().slice(0, 10)
  const displayName = sanitizeName(rawDisplayName)
  await db
    .insert(memberMessages)
    .values({ workspaceId, platform, memberRef, displayName, day, messageCount: delta, firstMessageAt: at, lastMessageAt: lastAt })
    .onConflictDoUpdate({
      target: [memberMessages.workspaceId, memberMessages.platform, memberMessages.memberRef, memberMessages.day],
      set: {
        messageCount: sql`${memberMessages.messageCount} + ${delta}`,
        displayName: sql`coalesce(${displayName}, ${memberMessages.displayName})`,
        firstMessageAt: sql`least(coalesce(${memberMessages.firstMessageAt}, ${at}), ${at})`,
        lastMessageAt: sql`greatest(coalesce(${memberMessages.lastMessageAt}, ${lastAt}), ${lastAt})`,
        updatedAt: new Date(),
      },
    })
}
