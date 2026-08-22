import { z } from 'zod'

// Load ./.env when present (local development). Values already set in the
// real environment win, so containers configured via env_file are unaffected.
try {
  process.loadEnvFile('.env')
} catch {
  /* no .env file */
}

// Single place where process.env is read. Everything else imports `config`.
// Fails fast at boot with a readable list of what is missing or malformed.
// Empty strings (a blank line in .env / compose) count as unset.
const optionalSecret = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional())

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Public origin of the SPA (CORS, auth redirects, links in emails).
  APP_URL: z.url(),
  // Public origin of this API as seen by the browser (OAuth callbacks are
  // built from it). Behind the edge proxy this is `${APP_URL}/api`.
  API_URL: z.url(),
  DATABASE_URL: z.url(),

  // Auth
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)'),
  GOOGLE_CLIENT_ID: optionalSecret,
  GOOGLE_CLIENT_SECRET: optionalSecret,
  DISCORD_CLIENT_ID: optionalSecret,
  DISCORD_CLIENT_SECRET: optionalSecret,
  FACEBOOK_CLIENT_ID: optionalSecret,
  FACEBOOK_CLIENT_SECRET: optionalSecret,
  TWITTER_CLIENT_ID: optionalSecret,
  TWITTER_CLIENT_SECRET: optionalSecret,

  // Where discovery-form submissions are announced (optional).
  DISCOVERY_NOTIFY_TO: z.preprocess((v) => (v === '' ? undefined : v), z.email().optional()),

  // LLM (status update summary)
  ANTHROPIC_API_KEY: optionalSecret,
  LLM_MODEL: z.string().default('claude-opus-5'),

  // Error tracking (optional)
  SENTRY_DSN: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),

  // Inbound webhooks
  TELEGRAM_WEBHOOK_SECRET: optionalSecret,

  // File storage (local driver). Mount a volume here in containers.
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),

  // Secrets at rest: "<id>:<base64 32 bytes>[,...]", first = active key.
  // Generate one with: echo "k1:$(openssl rand -base64 32)"
  CREDENTIALS_ENCRYPTION_KEYS: z.string().min(1),

  // Email (Resend). Without a key, emails are logged instead of sent.
  RESEND_API_KEY: optionalSecret,
  EMAIL_FROM: z.string().default('Catch <onboarding@resend.dev>'),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}

export const config = loadConfig()
export const isProduction = config.NODE_ENV === 'production'
