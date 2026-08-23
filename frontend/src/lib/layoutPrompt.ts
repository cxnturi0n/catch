// ── "Build your layout with Catch", one-shot gate ──────────────────────────
// The prompt is a first-run moment, not a recurring nudge: once a user has seen
// it, they never see it again, not on a new workspace, not on a new device.
//
// Two layers, mirroring how the account timezone is resolved:
//   • localStorage → instant and offline-safe, answers before the first paint
//   • profiles.layout_prompt_seen_at (migration 024) → makes it stick across devices
// Either one being set is enough to suppress the prompt.

import { getProfile, markLayoutPromptSeen } from './db'

const STORAGE_KEY = 'catch:layoutPromptSeen'

/** Device-local answer, available synchronously. */
export function hasSeenLayoutPromptLocally(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'done'
  } catch {
    // Storage unavailable (private mode): treat as "not seen" and let the
    // server-side check below decide. Worst case the prompt shows once more.
    return false
  }
}

function rememberLocally() {
  try {
    window.localStorage.setItem(STORAGE_KEY, 'done')
  } catch {
    /* nothing to do, the profile flag still covers signed-in users */
  }
}

/**
 * Server-side answer for a signed-in user. Returns false on any failure (missing
 * column, offline) so a broken read can never permanently hide the first run.
 */
export async function hasSeenLayoutPromptRemotely(userId: string): Promise<boolean> {
  try {
    const profile = await getProfile(userId)
    return Boolean(profile?.layout_prompt_seen_at)
  } catch {
    return false
  }
}

/** Mark it seen everywhere. Local write is immediate; the profile write is best-effort. */
export function rememberLayoutPromptSeen(userId: string | null) {
  rememberLocally()
  if (!userId) return
  void markLayoutPromptSeen(userId).catch(() => {
    /* pre-024 or offline, the local flag still holds on this device */
  })
}
