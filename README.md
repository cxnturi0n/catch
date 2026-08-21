# Catch

Command centre for Web3 community managers. Analytics across connected platforms,
moderator scheduling and payouts, operations and client reporting.

Production: https://catch-app-kohl.vercel.app

---

## Design principle you need to know before changing anything

**The platform only shows metrics it can actually verify.** When a figure is not
derivable from the integrations, it is omitted or explicitly marked unavailable.
It is never estimated, interpolated or faked.

This is enforced in `src/lib/analyticsCapabilities.ts`, a matrix of
`platform × metric × time window × source` that is the single source of truth for
the analytics layer. Every analytics component reads from it. Consequences you
will hit in practice:

- A chart is drawn only with **two or more real data points**. One point would
  imply a trend that does not exist.
- A time window is offered only if a selected metric supports it, and enabled only
  if enough history has accumulated. Otherwise it renders disabled, with the reason.
- If an integration returns unexpected keys, the metric **hides itself** rather
  than showing zero.

Several metrics competitors display are deliberately absent for this reason:
community health scores, sentiment, audience geography, quest funnel stages,
automatic KOL results. Each requires a data source we do not have. Adding any of
them means adding the source first, not the UI.

---

## Stack

| Layer | Technology |
|---|---|
| Interface | React 19, TypeScript 6, Vite 8, Tailwind 4, React Router 7 |
| Charts | Recharts 3 |
| Database | Supabase (PostgreSQL) with row level security |
| Auth | Supabase Auth, Google only |
| Server logic | 16 Supabase edge functions (Deno) |
| Scheduling | pg_cron, one minute cadence |
| Realtime | Supabase Realtime (postgres_changes) |
| Hosting | Vercel |
| AI summary | Anthropic API (Claude) |

Roughly 32,600 lines of application code, 99 components, 33 tables, 27 migrations.

---

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the Supabase values
npm run setup                # verifies everything is wired correctly
npm run dev
```

`npm run setup` checks Node version, dependencies, environment variables, CLI
tooling and that no environment file is tracked in git. It reports whether a
secret is present, never its value. Run it first on a new machine.

`.env.local` needs:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Both are publishable client keys. Nothing secret belongs in this file, and `.env*`
is gitignored regardless.

### Commands

| Command | Purpose |
|---|---|
| `npm run setup` | Verify the machine is correctly configured |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | `tsc -b` then `vite build`. **Must pass before any deploy** |
| `npm run verify` | Same gate as build, named explicitly for pre-deploy checks |
| `npm run lint` | oxlint |
| `vercel --prod` | Deploy to production |

There is no test suite yet. Type checking plus a clean production build is
currently the only regression gate. Introducing tests is the first consolidation
task, and it is a prerequisite for the fast release cycle, not an optional extra.

### CLI tools

```bash
npm i -g vercel
npx supabase login && npx supabase link --project-ref <ref>
```

Run Supabase commands **from the project directory**. Outside it, the CLI cannot
tell which project you mean and will prompt you to pick from all of them.

---

## Repository layout

```
src/
  components/
    layout/        Sidebar, TopBar, MainLayout (the shell)
    modules/       One folder or file per dashboard section
    ui/            Shared primitives: Card, Modal, Button, SplitPane
    brand/         CatchMark (the logo, sapphire and gold variants)
  lib/             Business logic, all framework free
    analyticsCapabilities.ts   The honest-metrics matrix. Read this first.
    db.ts                      Every Supabase query lives here
    chatEngine.ts              Catch Intelligence, deterministic engine
    recapData.ts               Cross platform summary builder
    statusUpdate.ts            Status Update snapshot + AI call
  hooks/           useRealtimeTables, useNow, useMediaQuery
  context/         Auth, Workspace, Theme, Timezone, Toast, Language
  i18n/            EN/PT content for the public site
supabase/
  migrations/      27 versioned SQL migrations
  functions/       16 edge functions (Deno)
api/               Vercel serverless endpoints
```

### Conventions

- Comments explain **why**, not what. Match the density of surrounding code.
- Everything must keep working if a migration has not been run yet. Server writes
  that depend on a new column are best effort and degrade silently.
- Never gate visibility on an animation. No element starts at `opacity: 0` and
  relies on JS to become visible: a frozen animation must never hide content.
- Moderator shift hours are **UTC by deliberate design** (a distributed team needs
  one unambiguous frame). User facing calendars use the account timezone instead.

---

## How the data gets in

Each integration follows the same shape: a `*-connect` function validates
credentials and registers the integration, a `*-sync` function pulls data on a
schedule. Credentials live in the `integrations` table, protected by row level
security, and never reach the browser.

`cron-sync` runs every minute and iterates over all workspaces with active
integrations. Three protections make that cadence safe against third party rate
limits:

1. **Per platform floor.** Discord and Telegram 60s, Galxe and Zealy 300s.
2. **Deterministic jitter.** A stable offset derived from the workspace id spreads
   requests across the minute. Deterministic on purpose: a random offset would make
   the gap between polls swing wildly, which is what rate limiters punish.
3. **Throttle on last attempt, not last success.** A rejected call still consumed
   quota, so a failing platform backs off instead of retrying every minute.

Snapshots are written only when a value actually changes, plus a heartbeat every
30 minutes, keeping the table at roughly 3,500 rows per day per workspace.

### Platform specifics

**Discord.** Bot token plus guild id. `View Audit Log` permission is needed for
bans, the privileged `SERVER MEMBERS` intent for tenure and retention. When the
intent is missing the function detects it and returns an explicit result the UI
surfaces, rather than showing zeros. Message polling uses a per channel cursor
(`discord_channel_cursors`) so it never re-reads history.

**Telegram.** Admin bot with privacy mode **off**, otherwise messages are not
received. Two channels: periodic member count, and a webhook for live events.
Message text is counted and **discarded, never stored**.

> The webhook must be registered with `allowed_updates=["message","chat_member"]`.
> `chat_member` is opt-in: if omitted, the platform keeps working on messages and
> records **zero** join/leave events **with no error anywhere**. This is the single
> easiest thing to get silently wrong in this codebase.

**Galxe / Zealy.** Public space alias, and subdomain plus API key respectively.
Quest completion stages are not exposed by either API, which is why they are absent.

**X.** No free read access. Data arrives through manual CSV import.

---

## Realtime

`useRealtimeTables` subscribes to `postgres_changes` filtered by `workspace_id`,
debounced 500ms so a bulk insert does not trigger a refetch storm. It is a no-op
for signed out users.

**The 5 minute polling interval in each consumer is deliberately kept.** Realtime
is the fast path, polling is the floor. A realtime channel can drop silently and
the user must never be stranded on stale numbers. Do not remove the intervals.

---

## Catch Intelligence

The gold mark denotes AI features. The chat engine (`chatEngine.ts`) is
**deterministic, not generative**: it matches keywords and returns vetted answers.
Zero cost, zero latency, cannot fabricate.

The only generative call is `status-update`. The client assembles the snapshot from
already computed numbers and the model only writes prose over them; it has no
database access. The system prompt forbids inventing figures and asserting
causation. On any failure it falls back to a deterministic summary and labels it as
such, so the panel always renders.

---

## Before you deploy

1. `npm run build` must pass.
2. Deploy edge functions **before** running a migration they depend on. Reversing
   the order can make external APIs be polled far more often than intended.
3. Frontend and edge functions deploy independently. A frontend deploy never
   updates a function, and vice versa.

See `HANDOVER.md` for account access, secrets and the list of pending activations.
