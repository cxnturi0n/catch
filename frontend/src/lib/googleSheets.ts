const GIS_URL = 'https://accounts.google.com/gsi/client'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'
const SCOPE = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
].join(' ')

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: { access_token?: string; error?: string }) => void
          }) => { requestAccessToken: () => void }
        }
      }
    }
  }
}

let gisReady: Promise<void> | null = null

function loadGIS(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  if (gisReady) return gisReady
  gisReady = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_URL
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services.'))
    document.head.appendChild(script)
  })
  return gisReady
}

export async function getGoogleAccessToken(): Promise<string> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  if (!clientId) {
    throw new Error(
      'Google Client ID not configured. Add VITE_GOOGLE_CLIENT_ID to your .env file.',
    )
  }
  await loadGIS()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (res) => {
        if (res.error || !res.access_token) reject(new Error(res.error ?? 'Auth failed.'))
        else resolve(res.access_token)
      },
    })
    client.requestAccessToken()
  })
}

export interface SheetPayload {
  title: string
  headers: string[]
  rows: (string | number)[][]
}

export async function createGoogleSheet(
  accessToken: string,
  spreadsheetTitle: string,
  sheets: SheetPayload[],
): Promise<string> {
  // 1. Create spreadsheet with all tabs
  const createRes = await fetch(SHEETS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: spreadsheetTitle },
      sheets: sheets.map((s) => ({ properties: { title: s.title } })),
    }),
  })
  if (!createRes.ok) throw new Error(`Could not create spreadsheet (${createRes.status}).`)
  const created = (await createRes.json()) as { spreadsheetId: string; spreadsheetUrl: string }

  // 2. Populate all tabs in one batch
  const updateRes = await fetch(
    `${SHEETS_API}/${created.spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: sheets.map((s) => ({
          range: `${s.title}!A1`,
          values: [s.headers, ...s.rows.map((row) => row.map(String))],
        })),
      }),
    },
  )
  if (!updateRes.ok) throw new Error(`Could not populate spreadsheet (${updateRes.status}).`)

  return created.spreadsheetUrl
}
