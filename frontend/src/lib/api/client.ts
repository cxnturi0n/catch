// Thin HTTP client for the Catch backend. Cookies carry the session, so every
// call is made with credentials and an Origin the server trusts. Errors are
// normalised to ApiError with the server's { error: { code, message } } shape.

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api'

export class ApiError extends Error {
  status: number
  code: string
  issues?: Array<{ path: string; message: string }>
  constructor(status: number, code: string, message: string, issues?: Array<{ path: string; message: string }>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.issues = issues
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; issues?: ApiError['issues'] } } | null)?.error
    throw new ApiError(res.status, err?.code ?? 'REQUEST_ERROR', err?.message ?? `Request failed (${res.status})`, err?.issues)
  }
  return data as T
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError
