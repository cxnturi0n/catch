import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Discovery form → email notification
 * -----------------------------------
 * Fires on every new discovery_responses row (complete OR partial) and emails
 * the founder "Persona X ha completato il formulario → vedi risultati".
 *
 * Trigger: a Supabase **Database Webhook** on INSERT of `discovery_responses`,
 * POSTing to this URL. Supabase sends `{ type, table, record, ... }`.
 *
 * Env vars (Vercel → Project → Settings → Environment Variables):
 *   - RESEND_API_KEY          : Resend API key (free tier is plenty). REQUIRED.
 *   - DISCOVERY_WEBHOOK_SECRET : shared secret; the webhook must send it in the
 *                               `x-webhook-secret` header (or `?secret=`). REQUIRED.
 * Optional:
 *   - NOTIFY_TO_EMAIL   : recipient (default cinicololuca@gmail.com)
 *   - NOTIFY_FROM_EMAIL : sender (default "Catch <onboarding@resend.dev>", which
 *                         Resend allows with no domain setup but ONLY delivers to
 *                         the Resend account owner's own address — perfect here).
 *   - APP_URL           : base URL for the "see results" link
 *                         (default https://catch-app-kohl.vercel.app)
 */

const RESEND_API = 'https://api.resend.com/emails'
const DEFAULT_TO = 'cinicololuca@gmail.com'
const DEFAULT_FROM = 'Catch <onboarding@resend.dev>'
const DEFAULT_APP_URL = 'https://catch-app-kohl.vercel.app'
const QUESTIONS_PER_FORM = 10

const VARIANT_LABELS: Record<string, string> = {
  freelance: 'Freelance community manager',
  fulltime: 'Full-time community manager',
  agency: 'Agency',
  founder: 'Founder / core team',
  investor: 'Investor / fund',
}

interface DiscoveryRecord {
  id?: string
  slug_snapshot?: string | null
  respondent_name?: string | null
  respondent_email?: string | null
  respondent_role?: string | null
  answers?: Record<string, string> | null
  submitted_at?: string | null
  completion_ms?: number | null
}

interface SupabaseWebhookBody {
  type?: string
  table?: string
  record?: DiscoveryRecord
  // Some setups post the row directly; support both shapes.
  [key: string]: unknown
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Count answered base questions (exclude reserved keys + note/platform companions). */
function answeredCount(answers: Record<string, string> | null | undefined): number {
  if (!answers) return 0
  let n = 0
  for (const [k, v] of Object.entries(answers)) {
    if (k === 'variant') continue
    if (k.endsWith('__note') || k.endsWith('__platforms')) continue
    if (typeof v === 'string' && v.trim()) n++
  }
  return Math.min(n, QUESTIONS_PER_FORM)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  // Shared-secret gate (prevents anyone from spamming the endpoint).
  const expectedSecret = process.env.DISCOVERY_WEBHOOK_SECRET
  if (!expectedSecret) return res.status(500).json({ error: 'Missing DISCOVERY_WEBHOOK_SECRET' })
  const provided =
    (req.headers['x-webhook-secret'] as string | undefined) ??
    (typeof req.query.secret === 'string' ? req.query.secret : undefined)
  if (provided !== expectedSecret) return res.status(401).json({ error: 'Invalid webhook secret' })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'Missing RESEND_API_KEY' })

  let body: SupabaseWebhookBody
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  // Only react to inserts; ignore updates/deletes if the webhook sends them.
  if (body.type && body.type !== 'INSERT') return res.status(200).json({ ok: true, skipped: body.type })

  const record: DiscoveryRecord = body.record ?? (body as DiscoveryRecord)
  const answers = record.answers ?? {}
  const variantId = (answers.variant ?? '').toString()
  const variantLabel = VARIANT_LABELS[variantId] ?? (record.slug_snapshot ?? 'discovery form')
  const answered = answeredCount(answers)
  const isComplete = answered >= QUESTIONS_PER_FORM
  const name = (record.respondent_name ?? '').trim() || 'Qualcuno'
  const email = (record.respondent_email ?? '').trim()
  const when = record.submitted_at ? new Date(record.submitted_at) : new Date()
  const appUrl = process.env.APP_URL ?? DEFAULT_APP_URL
  const resultsUrl = `${appUrl.replace(/\/$/, '')}/dashboard/discovery-responses`

  const verb = isComplete ? 'ha completato' : 'ha compilato'
  const subject = `${name} ${verb} il form · ${variantLabel} (${answered}/${QUESTIONS_PER_FORM})`

  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;background:#060812;padding:24px 12px;font-family:Inter,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#0c1424;border:1px solid #1c2b47;border-radius:16px;overflow:hidden;">
      <tr><td style="height:8px;background-image:linear-gradient(90deg,#1e3a8a,#2f7cf6,#8cc5ff);font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40px;height:40px;background-image:linear-gradient(135deg,#1e3a8a,#2f7cf6,#8cc5ff);border-radius:10px;text-align:center;vertical-align:middle;color:#fff;font-weight:800;font-size:18px;">C</td>
          <td style="padding-left:12px;"><div style="font-size:16px;font-weight:800;color:#fff;">Nuova risposta al Discovery form</div>
          <div style="font-size:13px;color:#9fb2d4;">${esc(when.toLocaleString('it-IT'))}</div></td>
        </tr></table>
        <p style="margin:20px 0 16px;padding:16px;background:rgba(255,255,255,0.03);border:1px solid #1c2b47;border-radius:12px;font-size:15px;line-height:1.6;color:#e2e8f0;">
          <strong style="color:#fff;">${esc(name)}</strong> ${esc(verb)} il formulario.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 20px;font-size:13px;color:#cbd5e1;">
          <tr><td style="color:#8cc5ff;width:130px;">Tipo di profilo</td><td style="color:#fff;">${esc(variantLabel)}</td></tr>
          <tr><td style="color:#8cc5ff;">Completamento</td><td style="color:#fff;">${answered}/${QUESTIONS_PER_FORM}${isComplete ? ' · completo ✅' : ' · parziale'}</td></tr>
          ${email ? `<tr><td style="color:#8cc5ff;">Email</td><td style="color:#fff;">${esc(email)}</td></tr>` : ''}
        </table>
        <a href="${esc(resultsUrl)}" style="display:inline-block;background-image:linear-gradient(180deg,#3f7bff,#2050e6);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:12px;">Vedi le risposte →</a>
        <div style="margin-top:18px;font-size:12px;color:#6b7ba0;">Notifica automatica di Catch · si attiva a ogni invio (completo o parziale).</div>
      </td></tr>
      <tr><td style="height:8px;background-image:linear-gradient(90deg,#8cc5ff,#2f7cf6,#1e3a8a);font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>
  </td></tr></table>
</body></html>`

  try {
    const r = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.NOTIFY_FROM_EMAIL ?? DEFAULT_FROM,
        to: [process.env.NOTIFY_TO_EMAIL ?? DEFAULT_TO],
        subject,
        html,
      }),
    })
    if (!r.ok) {
      const detail = await r.text()
      console.error('Resend error', r.status, detail)
      return res.status(502).json({ error: 'Resend API error', status: r.status, detail })
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('discovery-notify failed', err)
    return res.status(500).json({ error: 'Internal error' })
  }
}
