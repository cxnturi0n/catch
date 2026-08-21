import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// True only when both env vars are actually set — lets callers (AuthContext,
// WorkspaceContext) skip Supabase entirely and fall back to guest/mock mode
// instead of letting every query fail against a placeholder project.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey)

// createClient() throws synchronously if the URL is missing/invalid, which
// would crash the whole app at import time (this module is pulled in by
// AuthContext, which wraps the entire route tree). Fall back to a harmless
// placeholder so the client always constructs; isSupabaseConfigured is what
// actually gates whether we call it.
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder-anon-key', {
  auth: {
    // Keep users signed in across visits: persist the session in localStorage,
    // silently refresh the token, and pick up the OAuth session from the URL
    // after the Google redirect. This is what stops the "log in every time" loop.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Implicit flow: the OAuth redirect returns the tokens directly in the URL
    // hash, so the session is established without a PKCE code exchange (which
    // depends on a locally-stored verifier that can go missing across the
    // Google → Supabase → app hops). More robust for this setup.
    flowType: 'implicit',
  },
})
