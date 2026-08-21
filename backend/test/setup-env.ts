// Test processes load ./.env like the app does, then force test-safe values.
try {
  process.loadEnvFile('.env')
} catch {
  /* no .env */
}
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL ??= 'warn'
process.env.APP_URL ??= 'http://localhost:5173'
process.env.API_URL ??= 'http://localhost:3000'
process.env.DATABASE_URL ??= 'postgres://catch:change-me@localhost:5432/catch'
process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-1234'
delete process.env.RESEND_API_KEY // never send real email from tests
