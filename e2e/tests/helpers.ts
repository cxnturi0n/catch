import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const PASSWORD = 'e2e-password-12345'

export function uniqueEmail(tag: string) {
  return `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`
}

/** The verification link the backend would have e-mailed (dev outbox). */
export async function latestLink(request: APIRequestContext, to: string, pattern: RegExp): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await request.get(`/api/dev/outbox?to=${encodeURIComponent(to)}`)
    const { emails } = (await res.json()) as { emails: Array<{ text: string }> }
    const m = emails.at(-1)?.text.match(pattern)
    if (m) return m[0]
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`no email matching ${pattern} for ${to}`)
}

/** First-run overlays (AI recap popup, section tutorials) would cover the
 * elements under test; mark them seen before the app boots. */
export async function silenceOnboardingOverlays(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('catch:recap:lastShown', String(Date.now()))
      localStorage.setItem('catch:layoutPromptSeen', '1')
      for (const id of ['analytics', 'listening', 'report', 'moderators', 'kol', 'tasks', 'payments', 'integrations', 'catchlab', 'instructions', 'leaderboard', 'compensation', 'resources', 'meetings', 'catch'])
        localStorage.setItem(`catch:tutorial:${id}`, '1')
    } catch {
      /* ignore */
    }
  })
}

/** Sign up through the UI, verify through the real link, land on onboarding. */
export async function signUpAndVerify(page: Page, email: string, name = 'E2E User') {
  await silenceOnboardingOverlays(page)
  await page.goto('/signup')
  await page.getByPlaceholder('Full name').fill(name)
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder(/Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()
  const link = await latestLink(page.request, email, /https?:\/\/\S+verify-email\S+/)
  await page.goto(link)
  await page.waitForURL(/\/onboarding/)
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await silenceOnboardingOverlays(page)
  await page.goto('/login')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** RFC 6238 TOTP, same as the backend test helper. */
export async function totp(secretB32: string): Promise<string> {
  const { createHmac } = await import('node:crypto')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secretB32.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)))
  const h = createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1]! & 0xf
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0')
}
