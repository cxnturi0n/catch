import { createServiceClient } from '../_shared/supabaseAdmin.ts'

// Telegram ingestion. This function handles TWO kinds of update:
//
//   • `message`     — messages-per-member (#1). Telegram delivers every NEW group
//                     message here (bot must have privacy mode OFF and be in the
//                     group). We attribute each message to its sender, bump a
//                     per-member daily counter and the hourly activity heatmap.
//   • `chat_member` — exact joins & leaves (#26). Telegram reports every member
//                     status transition in real time. Without this, membership is
//                     only observable as the NET delta of getChatMemberCount polled
//                     hourly by cron-sync: 60 joins + 20 leaves shows up as "+40"
//                     and the churn is invisible. Here each join and each leave is
//                     recorded individually, so gross numbers are exact and instant.
//
// NO HISTORY, FOR EITHER. Telegram never replays past messages or past membership
// changes. Both counters accrue strictly from the moment the webhook is registered
// (and, for joins/leaves, from the moment `chat_member` is in allowed_updates).
// Periods before activation are UNKNOWN — never present them as zero.
//
// Set up (bot owner):
//   1. Deploy: npx supabase functions deploy telegram-webhook --no-verify-jwt
//   2. Secrets: npx supabase secrets set TELEGRAM_WEBHOOK_SECRET=<random>
//               npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
//   3. Register the webhook with Telegram (per bot):
//      curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
//        -d url="https://mklxvnusaqcmzbnrklgs.supabase.co/functions/v1/telegram-webhook" \
//        -d secret_token="<same TELEGRAM_WEBHOOK_SECRET>" \
//        -d allowed_updates='["message","chat_member"]'
//   4. In @BotFather: /setprivacy → Disable (so the bot sees all group messages).
//   5. Run migration 026_telegram_membership_events.sql in the SQL editor.
//
// ⚠️ `chat_member` IS OPT-IN. Telegram deliberately excludes it from the default
// update set: if `allowed_updates` does not list it EXPLICITLY, Telegram simply
// never sends it and join/leave tracking silently records nothing — no error, no
// warning, just an empty table. Any bot whose webhook was registered before this
// feature MUST re-run the setWebhook call above with the two-value allowed_updates.
// (Verify with: curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo" and
//  check that allowed_updates contains "chat_member".)

interface TgUser {
  id: number
  is_bot?: boolean
  username?: string
  first_name?: string
}

interface TgMessage {
  chat?: { id: number }
  from?: TgUser
  /** UNIX timestamp in SECONDS (Telegram never sends milliseconds). */
  date?: number
}

// Truncate a Date to the start of its UTC hour — the heatmap bucket key.
function hourBucket(date: Date): string {
  const d = new Date(date)
  d.setUTCMinutes(0, 0, 0)
  return d.toISOString()
}

/** One side of a `chat_member` transition. `status` is Telegram's ChatMember type. */
interface TgChatMember {
  user?: TgUser
  status?: string
  /** Only sent for status 'restricted': whether the muted user is still in the chat. */
  is_member?: boolean
}

interface TgChatMemberUpdated {
  chat?: { id: number }
  from?: TgUser
  /** UNIX timestamp in SECONDS of the transition. */
  date?: number
  old_chat_member?: TgChatMember
  new_chat_member?: TgChatMember
}

interface TgUpdate {
  message?: TgMessage
  chat_member?: TgChatMemberUpdated
}

// Telegram's ChatMember statuses collapse to a single question: is the user IN
// the chat or OUT of it? 'restricted' (muted) is the only status that can be
// either — Telegram disambiguates it with `is_member`, so a mute is never
// miscounted as a leave, and unmuting a present member is never a join.
const IN_STATUSES = new Set(['member', 'administrator', 'creator'])
const OUT_STATUSES = new Set(['left', 'kicked'])

/** true = in the chat, false = out of it, null = status we don't recognise. */
function presence(member?: TgChatMember): boolean | null {
  const status = member?.status
  if (!status) return null
  if (IN_STATUSES.has(status)) return true
  if (OUT_STATUSES.has(status)) return false
  if (status === 'restricted') return member?.is_member === true
  return null
}

/**
 * Reduce an old→new transition to an actual membership event, or null.
 *
 * ONLY a crossing of the in/out boundary counts:
 *   out → in  = join    (e.g. 'left' → 'member')
 *   in  → out = leave   (e.g. 'member' → 'kicked')
 *
 * Everything else is a no-op and MUST be ignored, otherwise the numbers inflate:
 * member → administrator (promotion), administrator → member (demotion),
 * left → kicked (banning someone who already left), member → restricted with
 * is_member (a mute), and any status → itself. An unrecognised status on either
 * side yields null rather than a guess — under-reporting beats a fabricated event.
 */
function classifyTransition(oldMember?: TgChatMember, newMember?: TgChatMember): 'join' | 'leave' | null {
  const was = presence(oldMember)
  const now = presence(newMember)
  if (was === null || now === null || was === now) return null
  return now ? 'join' : 'leave'
}

// Always ack 200 so Telegram doesn't retry — we never surface internal errors.
function ok() {
  return new Response('ok', { status: 200 })
}

// A member is identified by @username when they have one, else first name, else
// the raw id — usernames are nicer but optional and mutable, the id is the key.
function displayNameOf(user: TgUser): string {
  return user.username ? `@${user.username}` : user.first_name ?? `id:${user.id}`
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return ok()

  // Verify the secret token Telegram echoes back on every delivery.
  const expected = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
  if (!expected || req.headers.get('x-telegram-bot-api-secret-token') !== expected) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    const update = (await req.json()) as TgUpdate
    const msg = update.message
    const membership = update.chat_member

    // Both branches need the originating chat; bail early on updates we don't handle.
    const chatId = msg?.chat?.id ?? membership?.chat?.id
    if (chatId === undefined) return ok()

    const supabase = createServiceClient()

    // Match the chat to a connected workspace (credentials.chat_id is a string).
    const { data: integrations } = await supabase
      .from('integrations')
      .select('workspace_id, credentials')
      .eq('platform', 'telegram')
      .eq('status', 'connected')

    const chatStr = String(chatId)
    const match = (integrations ?? []).find((row) => String((row.credentials as { chat_id?: string } | null)?.chat_id ?? '') === chatStr)
    if (!match) return ok()

    // ── message → messages-per-member + activity heatmap ──
    const from = msg?.from
    // Ignore bot messages and anything without a sender.
    if (msg && from && !from.is_bot) {
      await supabase.rpc('bump_member_message', {
        p_workspace: match.workspace_id,
        p_platform: 'telegram',
        p_member_ref: String(from.id),
        p_display_name: displayNameOf(from),
      })

      // Activity heatmap (hour × weekday): tally the same message into its UTC hour
      // bucket so the CM can see when the community talks. `date` is in SECONDS;
      // fall back to now() for the rare update that omits it.
      const sentAt = typeof msg.date === 'number' ? new Date(msg.date * 1000) : new Date()
      await supabase.rpc('bump_message_activity', {
        p_workspace: match.workspace_id,
        p_platform: 'telegram',
        p_bucket: hourBucket(sentAt),
        p_delta: 1,
      })
    }

    // ── chat_member → exact joins & leaves ──
    if (membership) {
      // The SUBJECT of the event is new_chat_member.user, NOT `from` — `from` is
      // whoever caused it (an admin banning someone, or the user themselves).
      const subject = membership.new_chat_member?.user ?? membership.old_chat_member?.user
      const eventType = classifyTransition(membership.old_chat_member, membership.new_chat_member)

      // Bots joining/leaving are plumbing, not community growth — skip them.
      if (subject && !subject.is_bot && eventType) {
        // `date` is in SECONDS. Falling back to now() would be wrong-ish but is
        // close enough (the webhook fires within a second) and keeps the row.
        const occurredAt = typeof membership.date === 'number' ? new Date(membership.date * 1000) : new Date()
        // If migration 026 has not been run the RPC does not exist; supabase-js
        // returns the error rather than throwing, so we ignore it deliberately —
        // the message ingestion above is already committed and Telegram must
        // still get its 200 or it will retry the whole update forever.
        await supabase.rpc('record_telegram_membership_event', {
          p_workspace: match.workspace_id,
          p_chat_id: chatStr,
          p_user_ref: String(subject.id),
          p_display_name: displayNameOf(subject),
          p_event_type: eventType,
          p_old_status: membership.old_chat_member?.status ?? null,
          p_new_status: membership.new_chat_member?.status ?? null,
          p_occurred_at: occurredAt.toISOString(),
        })
      }
    }

    return ok()
  } catch {
    return ok()
  }
})
