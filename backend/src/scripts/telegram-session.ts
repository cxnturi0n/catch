// One-off: log a dedicated Telegram user account in and print the session
// string for TELEGRAM_SESSION. Needs TELEGRAM_API_ID and TELEGRAM_API_HASH
// (https://my.telegram.org, "API development tools").
//
//   cd backend && TELEGRAM_API_ID=... TELEGRAM_API_HASH=... npx tsx src/scripts/telegram-session.ts
//
// The string grants full access to that account: use an account created for
// Catch, enable two step verification on it, keep the value in the server env
// only, and re-run this script (and terminate other sessions in Telegram) to
// rotate it.
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { TelegramClient, sessions } from 'telegram'

const apiId = Number(process.env.TELEGRAM_API_ID)
const apiHash = process.env.TELEGRAM_API_HASH
if (!apiId || !apiHash) {
  console.error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH first.')
  process.exit(1)
}

const rl = createInterface({ input: stdin, output: stdout })
const client = new TelegramClient(new sessions.StringSession(''), apiId, apiHash, { connectionRetries: 3 })
await client.start({
  phoneNumber: () => rl.question('Phone number (international format): '),
  phoneCode: () => rl.question('Code you received in Telegram: '),
  password: () => rl.question('Two step verification password (empty if none): '),
  onError: (err) => console.error(err),
})
const me = (await client.getMe()) as { username?: string; firstName?: string }
console.log(`\nLogged in as ${me.username ? '@' + me.username : me.firstName}.`)
console.log('\nTELEGRAM_SESSION=' + client.session.save())
console.log('\nPaste the line above into the server .env (staging and production), then restart the worker.')
await client.disconnect()
rl.close()
process.exit(0)
