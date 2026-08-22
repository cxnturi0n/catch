import { expect, test } from '@playwright/test'
import { signUpAndVerify, uniqueEmail } from './helpers'

test('moderators: add, see in roster, quota enforced server-side', async ({ page }) => {
  const email = uniqueEmail('ws')
  await signUpAndVerify(page, email)
  await page.getByRole('button', { name: 'Founder / Core Team' }).click()
  await page.getByRole('button', { name: /Just one/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('e.g. Arbitrum Foundation').fill('Mods DAO')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Telegram' }).click()
  await page.getByRole('button', { name: 'Enter Catch' }).click()
  await page.waitForURL(/\/dashboard/)

  await page.goto('/dashboard/moderators')
  for (const name of ['Lena Ortiz', 'Kai Tanaka', 'Marco Bianchi']) {
    await page.getByRole('button', { name: 'Invite' }).first().click()
    await page.getByPlaceholder('e.g. Marco Rossi').fill(name)
    await page.getByRole('button', { name: 'Add Moderator' }).click()
    await expect(page.getByText(name).first()).toBeVisible()
  }

  // Starter plan: 3 moderators — the 4th is refused by the API, not only the UI.
  const ws = await page.evaluate(() => localStorage.getItem('catch:activeWorkspace'))
  const res = await page.request.post(`/api/workspaces/${ws}/moderators`, { data: { fullName: 'Fourth' } })
  expect(res.status()).toBe(403)
  expect((await res.json()).error.code).toBe('QUOTA_EXCEEDED')

  // Another user cannot see this workspace at all.
  const intruder = await page.context().browser()!.newContext()
  const p2 = await intruder.newPage()
  await signUpAndVerify(p2, uniqueEmail('intruder'))
  const denied = await p2.request.get(`/api/workspaces/${ws}/moderators`)
  expect(denied.status()).toBe(404)
  await intruder.close()
})
