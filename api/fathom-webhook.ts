import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Fathom → Notion webhook
 * -----------------------
 * Riceve un webhook da Fathom quando una registrazione/meeting è pronta e
 * crea una pagina nel database Notion configurato.
 *
 * Variabili d'ambiente richieste (Vercel → Project → Settings → Environment Variables):
 *   - NOTION_TOKEN         : integration token Notion (secret_...)
 *   - NOTION_DATABASE_ID   : id del database Notion di destinazione
 * Opzionale:
 *   - FATHOM_WEBHOOK_SECRET : se impostata, il webhook deve inviare lo stesso
 *                             valore nell'header `x-fathom-secret` (o `?secret=` in query).
 *
 * NOTE: la forma esatta del payload Fathom può variare a seconda di come hai
 * configurato il webhook (nativo, Zapier, ecc.). L'estrazione qui sotto è
 * difensiva: prova più nomi di campo e non fallisce se qualcosa manca.
 */

const NOTION_API = 'https://api.notion.com/v1/pages';
const NOTION_VERSION = '2022-06-28';

// ---- Tipi minimi del payload Fathom (best-effort, tutti opzionali) ----
interface FathomWebhookBody {
  title?: string;
  topic?: string;
  meeting_title?: string;
  url?: string;
  share_url?: string;
  recording_url?: string;
  summary?: string;
  ai_summary?: string;
  transcript?: string;
  started_at?: string;
  created_at?: string;
  date?: string;
  duration?: number | string;
  participants?: Array<string | { name?: string; email?: string }>;
  recording_id?: string | number;
  id?: string | number;
  call_id?: string | number;
  [key: string]: unknown;
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function normalizeParticipants(participants: FathomWebhookBody['participants']): string | undefined {
  if (!participants || participants.length === 0) return undefined;
  const names = participants
    .map((p) => (typeof p === 'string' ? p : p?.name || p?.email))
    .filter((n): n is string => Boolean(n));
  return names.length ? names.join(', ') : undefined;
}

/** Notion accetta max 2000 caratteri per rich_text; troncatura sicura. */
function richText(content: string | undefined) {
  if (!content) return [];
  return [{ text: { content: content.slice(0, 2000) } }];
}

/**
 * Spezza un testo lungo (es. transcript) in più oggetti rich_text da max 2000
 * caratteri l'uno. Notion accetta fino a 100 elementi per proprietà rich_text,
 * quindi limitiamo a 100 segmenti (~200k caratteri) per evitare errori.
 */
function richTextChunks(content: string | undefined) {
  if (!content) return [];
  const chunks: Array<{ text: { content: string } }> = [];
  for (let i = 0; i < content.length && chunks.length < 100; i += 2000) {
    chunks.push({ text: { content: content.slice(i, i + 2000) } });
  }
  return chunks;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Solo POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. Verifica secret opzionale
  const expectedSecret = process.env.FATHOM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided =
      (req.headers['x-fathom-secret'] as string | undefined) ??
      (typeof req.query.secret === 'string' ? req.query.secret : undefined);
    if (provided !== expectedSecret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
  }

  // 3. Config Notion
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!notionToken || !databaseId) {
    return res
      .status(500)
      .json({ error: 'Missing NOTION_TOKEN or NOTION_DATABASE_ID env vars' });
  }

  // 4. Parse body (Vercel lo pre-parsa se Content-Type è application/json)
  let body: FathomWebhookBody;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // 5. Mappa campi Fathom → proprietà Notion
  const title =
    firstString(body.title, body.meeting_title, body.topic) ?? 'Fathom meeting';
  const meetingUrl = firstString(body.url, body.share_url, body.recording_url);
  const summary = firstString(body.summary, body.ai_summary);
  const transcript = firstString(body.transcript);
  const date = firstString(body.started_at, body.created_at, body.date);
  const participants = normalizeParticipants(body.participants);
  const recordingId = firstString(
    body.recording_id != null ? String(body.recording_id) : undefined,
    body.call_id != null ? String(body.call_id) : undefined,
    body.id != null ? String(body.id) : undefined,
  );

  // Mapping allineato al database "Call Log". I nomi delle chiavi combaciano
  // ESATTAMENTE con le colonne Notion (case-sensitive). Le colonne compilate a
  // mano (Company, Next Step, Sector, Source, Stage, Uses Mava/other tools,
  // Willingness to pay) restano vuote. "Created" è di tipo Created time → auto,
  // non scrivibile, quindi omessa.
  const properties: Record<string, unknown> = {
    Call: {
      title: [{ text: { content: title.slice(0, 2000) } }],
    },
  };
  if (date) properties['Call Date'] = { date: { start: date } };
  if (meetingUrl) properties['Fathom URL'] = { url: meetingUrl };
  if (summary) properties.Summary = { rich_text: richText(summary) };
  if (transcript) properties.Transcript = { rich_text: richTextChunks(transcript) };
  if (recordingId) properties['Recording ID'] = { rich_text: richText(recordingId) };
  if (participants) properties.Person = { rich_text: richText(participants) };

  // 6. Crea la pagina su Notion
  try {
    const notionRes = await fetch(NOTION_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
      }),
    });

    if (!notionRes.ok) {
      const detail = await notionRes.text();
      console.error('Notion API error', notionRes.status, detail);
      return res
        .status(502)
        .json({ error: 'Notion API error', status: notionRes.status, detail });
    }

    const created = (await notionRes.json()) as { id?: string };
    return res.status(200).json({ ok: true, notionPageId: created.id });
  } catch (err) {
    console.error('Webhook handler failed', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
