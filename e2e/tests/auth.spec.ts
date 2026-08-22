import { expect, test } from '@playwright/test'
import { login, PASSWORD, signUpAndVerify, totp, uniqueEmail } from './helpers'

test.describe.configure({ mode: 'serial' })

const email = uniqueEmail('auth')

test('sign up, verify by link, onboard into a workspace', async ({ page }) => {
  await signUpAndVerify(page, email)

  // Onboarding: role + single/multiple → workspace name → platforms
  await page.getByRole('button', { name: 'Community Manager' }).click()
  await page.getByRole('button', { name: /Just one/ }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('e.g. Arbitrum Foundation').fill('E2E DAO')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Discord' }).click()
  await page.getByRole('button', { name: 'Enter Catch' }).click()
  await page.waitForURL(/\/dashboard/)
  await expect(page.getByText('E2E DAO').first()).toBeVisible()
})

test('unverified accounts cannot sign in; wrong password rejected', async ({ page }) => {
  const other = uniqueEmail('unverified')
  await page.goto('/signup')
  await page.getByPlaceholder('Full name').fill('Nope')
  await page.getByPlaceholder('Email').fill(other)
  await page.getByPlaceholder(/Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Check your inbox')).toBeVisible()
  await login(page, other)
  await expect(page.getByText(/verify your email/i)).toBeVisible()

  await login(page, email, 'definitely-wrong-password')
  await expect(page.getByText(/Incorrect email or password/)).toBeVisible()
})

test('password reset through the emailed link', async ({ page, request }) => {
  await page.goto('/forgot-password')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText(/reset link is on its way/)).toBeVisible()
  const { latestLink } = await import('./helpers')
  const link = await latestLink(request, email, /https?:\/\/\S+reset-password\S+/)
  await page.goto(link)
  await page.getByPlaceholder(/New password/).fill(PASSWORD + 'x')
  await page.getByPlaceholder('Confirm new password').fill(PASSWORD + 'x')
  await page.getByRole('button', { name: 'Update password' }).click()
  await page.waitForURL(/\/login/)
  await login(page, email, PASSWORD + 'x')
  await page.waitForURL(/\/dashboard/)
  // restore the original password for the next tests
  await page.goto('/dashboard/security')
  await page.getByLabel('Current password').fill(PASSWORD + 'x')
  await page.getByLabel(/New password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByText(/Password updated/)).toBeVisible()
})

test('two-factor: enable with QR secret, then sign in needs a TOTP code', async ({ page }) => {
  await login(page, email)
  await page.waitForURL(/\/dashboard/)
  await page.goto('/dashboard/security')
  await page.getByRole('button', { name: 'Enable two-factor' }).click()
  await page.getByPlaceholder('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Continue' }).click()
  const keyLine = await page.getByText(/Enter this key manually/).textContent()
  const secret = keyLine!.split(':').pop()!.trim()
  await page.getByPlaceholder('123 456').fill(await totp(secret))
  await page.getByRole('button', { name: 'Verify and enable' }).click()
  await expect(page.getByRole('heading', { name: 'Backup codes' })).toBeVisible()
  await page.getByRole('button', { name: "I've saved them" }).click()
  await expect(page.getByText(/Enabled\. Signing in requires/)).toBeVisible()

  // Fresh session → challenge screen → dashboard
  await page.context().clearCookies()
  await login(page, email)
  await page.waitForURL(/\/two-factor/)
  await page.getByPlaceholder('123 456').fill('000000')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByText(/not valid/)).toBeVisible()
  await page.getByPlaceholder('123 456').fill(await totp(secret))
  await page.getByRole('button', { name: 'Verify' }).click()
  await page.waitForURL(/\/dashboard/)
})
