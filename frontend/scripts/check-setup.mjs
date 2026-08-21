#!/usr/bin/env node
// Verifies a fresh machine is ready to run and deploy Catch.
// Reports what is missing and how to fix it, without ever printing a secret value.
//
//   node scripts/check-setup.mjs

import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m    ${m}`)
const warn = (m, fix) => { console.log(`  \x1b[33mWARN\x1b[0m  ${m}`); if (fix) console.log(`        -> ${fix}`) }
const fail = (m, fix) => { console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); if (fix) console.log(`        -> ${fix}`); failures++ }
let failures = 0

const has = (cmd) => {
  try { execSync(cmd, { stdio: 'ignore' }); return true } catch { return false }
}

console.log('\n\x1b[1mCatch — setup check\x1b[0m\n')

// ── Toolchain ──
console.log('Toolchain')
const major = Number(process.versions.node.split('.')[0])
if (major >= 20) ok(`Node ${process.versions.node}`)
else fail(`Node ${process.versions.node} is too old`, 'Install Node 20 or newer')

if (existsSync('node_modules')) ok('Dependencies installed')
else fail('node_modules missing', 'npm install')

// ── Client environment ──
console.log('\nClient environment')
const envFile = ['.env.local', '.env'].find((f) => existsSync(f))
if (!envFile) {
  fail('No .env.local found', 'cp .env.example .env.local, then fill in the Supabase values')
} else {
  const env = readFileSync(envFile, 'utf8')
  // Presence and non-placeholder check only. Values are never printed.
  const check = (key, required) => {
    const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'))
    const v = m?.[1]?.trim()
    if (!v || v.startsWith('your_')) {
      if (required) fail(`${key} not set in ${envFile}`, 'Copy it from the Supabase project settings')
      else warn(`${key} not set (optional)`, 'Only needed for the Google Sheets export')
    } else ok(`${key} set`)
  }
  check('VITE_SUPABASE_URL', true)
  check('VITE_SUPABASE_PUBLISHABLE_KEY', true)
  check('VITE_GOOGLE_CLIENT_ID', false)
}

// ── CLIs ──
console.log('\nDeployment tooling')
if (has('vercel --version')) ok('Vercel CLI available')
else warn('Vercel CLI not installed', 'npm i -g vercel, then vercel login')

if (has('npx supabase --version')) {
  ok('Supabase CLI available')
  if (existsSync('supabase/.temp/project-ref')) ok('Supabase project linked')
  else warn('Supabase project not linked', 'npx supabase link --project-ref <ref>  (run from this directory)')
} else {
  warn('Supabase CLI not available', 'npx supabase login')
}

// ── Repository hygiene ──
console.log('\nRepository')
if (existsSync('.git')) {
  ok('Git repository initialised')
  try {
    const tracked = execSync('git ls-files', { encoding: 'utf8' })
    const leaked = tracked.split('\n').filter((f) => /^\.env($|\.local)/.test(f) || f.startsWith('.vercel/'))
    if (leaked.length) fail(`Secrets tracked in git: ${leaked.join(', ')}`, 'git rm --cached <file> and rotate the exposed keys')
    else ok('No environment files tracked')
  } catch { /* not fatal */ }
  try {
    const remote = execSync('git remote -v', { encoding: 'utf8' }).trim()
    if (remote) ok('Remote configured')
    else warn('No remote configured', 'gh repo create catch --private --source=. --push')
  } catch { /* not fatal */ }
} else {
  fail('Not a git repository', 'git init && git add . && git commit -m "Initial commit"')
}

// ── Result ──
console.log('')
if (failures === 0) {
  console.log('\x1b[32mReady.\x1b[0m  npm run dev to start, npm run build before deploying.\n')
} else {
  console.log(`\x1b[31m${failures} blocking issue(s).\x1b[0m  Resolve the FAIL lines above, then re-run.\n`)
  process.exit(1)
}
