// Shared contract for platform clients. Used by the API (connect + manual
// sync) and by the worker (scheduled sync) so the logic exists once.

export class PlatformError extends Error {
  constructor(
    message: string,
    /** Stable code the UI can branch on. */
    public code: 'INVALID_CREDENTIALS' | 'NOT_FOUND' | 'RATE_LIMITED' | 'UPSTREAM' | 'MISSING_PERMISSION',
    public status?: number,
  ) {
    super(message)
  }
}

export interface ConnectResult {
  /** Stored encrypted. */
  credentials: Record<string, string>
  /** Safe to show in the UI. */
  metadata: Record<string, unknown>
}

export interface SyncResult {
  /** Stored in platform_metrics.metrics for the day and compared for snapshots. */
  metrics: Record<string, unknown>
}

export interface SyncContext {
  workspaceId: string
}

export interface PlatformClient<C extends Record<string, string>, Input> {
  connect(input: Input): Promise<ConnectResult>
  sync(credentials: C, ctx?: SyncContext): Promise<SyncResult>
}

const DEFAULT_TIMEOUT_MS = 15_000

// fetch with a timeout and a clear upstream error; never throws the raw
// URL (bot tokens travel in Telegram paths).
export async function upstreamFetch(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } catch {
    throw new PlatformError('Platform unreachable', 'UPSTREAM')
  } finally {
    clearTimeout(t)
  }
}
