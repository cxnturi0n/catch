import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// A client scoped to the CALLER's session: it forwards the user's JWT so all
// queries run as that authenticated user and are covered by the existing RLS
// policies (a workspace owner may manage their own integrations/metrics). This
// avoids depending on the service-role secret, which is not reliably available
// under Supabase's new publishable/secret API-key system.
export function createUserClient(req: Request) {
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// A service-role client that bypasses RLS. ONLY for trusted server-to-server
// jobs with no user context (e.g. the scheduled cron-sync that must read every
// workspace's integrations). Requires the SUPABASE_SERVICE_ROLE_KEY secret to
// be set on the function. Never expose the result of its queries to a caller
// without an explicit authorization check.
export function createServiceClient() {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
