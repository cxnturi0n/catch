// ── status-update ───────────────────────────────────────────────────────────
// Writes the prose for the "Status Update" panel.
//
// The client assembles the snapshot (it already owns the honest-metrics
// pipeline: buildRecap + coverage + shift events) and posts it here as JSON.
// This function only turns those REAL numbers into prose — it never fetches or
// derives a metric itself, so there is exactly one place where numbers are
// computed and no second source that could drift.
//
// Why an edge function at all: the Anthropic key must never reach the browser.
// Deployed WITH JWT verification (the default) so only signed-in users can
// spend the key.
//
// Failure is not fatal: on any error — refusal, quota, outage — this returns
// a 200 with `{ ok: false }` and the client falls back to the deterministic
// narrative from buildRecapInsights. The panel always renders.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   npx supabase functions deploy status-update
// Optional: STATUS_UPDATE_MODEL to override the model (e.g. claude-haiku-4-5).

import Anthropic from 'npm:@anthropic-ai/sdk'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Opus 5 by default. Cost is dominated by the model choice, not the token
// count — this call is ~1.5k in / ~300 out — so the override exists to let an
// operator trade quality for spend without a redeploy of the client.
const MODEL = Deno.env.get('STATUS_UPDATE_MODEL') ?? 'claude-opus-5'

const SYSTEM = `You write the "Status Update" briefing for a Web3 community manager who is about to walk into a call. They need to sound informed in fifteen seconds.

You receive a JSON snapshot of REAL measurements from their connected platforms. Your only job is to turn those numbers into prose.

Hard rules — these matter more than style:
- Use ONLY numbers present in the snapshot. Never estimate, extrapolate, or invent a figure.
- Never assert a cause. "Retention fell and the evening shift was uncovered" is allowed; "retention fell BECAUSE the shift was uncovered" is not — you cannot see causation in this data.
- If the snapshot is thin or a metric is missing, say so plainly. "Telegram has no history yet" is a useful sentence; a confident summary built on one data point is not.
- Never mention a platform that is not in the snapshot.

Style: direct, specific, no filler. Lead with what changed or what needs attention, not with a greeting. No emoji. Name the platform when you cite a number.`

interface Body {
  snapshot?: unknown
  lang?: string
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return json({ ok: false, error: 'ANTHROPIC_API_KEY is not set' })

    const { snapshot, lang }: Body = await req.json()
    if (!snapshot) return json({ ok: false, error: 'snapshot is required' })

    const language = lang === 'pt' ? 'Brazilian Portuguese' : 'English'
    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      // Low effort: this is short prose over structured input, not a reasoning
      // task, and the whole point of the feature is that it feels instant.
      // Thinking stays on (Opus 5 default) — disabling it can leak <thinking>
      // tags into the visible text.
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              headline: {
                type: 'string',
                description: 'One line, max ~70 characters. The single most important thing right now.',
              },
              body: {
                type: 'string',
                description: 'Two to four sentences covering scale, the notable movers, and anything that needs attention.',
              },
              watch: {
                type: 'array',
                description: 'Zero to three short bullets, each one specific thing to keep an eye on. Empty when nothing warrants it.',
                items: { type: 'string' },
              },
            },
            required: ['headline', 'body', 'watch'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: `Write the status update in ${language}.\n\nSnapshot:\n${JSON.stringify(snapshot, null, 1)}`,
        },
      ],
    })

    // Opus 5 can decline a request outright — a 200 with no usable content.
    // Check before reading content, or this throws on an empty array.
    if (response.stop_reason === 'refusal') {
      return json({ ok: false, error: 'The model declined to write this update.' })
    }

    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return json({ ok: false, error: 'Empty response from the model.' })

    const parsed = JSON.parse(text.text) as { headline: string; body: string; watch: string[] }
    return json({
      ok: true,
      update: parsed,
      model: response.model,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    })
  } catch (err) {
    // Never 500: the client has a deterministic narrative to fall back on, and
    // a failed briefing should degrade rather than break the panel.
    return json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' })
  }
})
