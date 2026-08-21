import { db } from '../db/client.js'
import { securityEvents } from '../db/schema/index.js'
import { logger } from '../logger.js'

export type SecurityEventType =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'password_reset'
  | 'password_changed'
  | 'email_changed'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'mfa_failed'
  | 'backup_codes_regenerated'
  | 'account_linked'
  | 'account_unlinked'
  | 'session_revoked'
  | 'account_deleted'

export interface SecurityEventInput {
  userId: string
  type: SecurityEventType
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
}

// Append-only audit trail of authentication events. Failures are logged and
// swallowed: the audit log must never break the flow it is recording.
export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    await db.insert(securityEvents).values({
      userId: input.userId,
      type: input.type,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? null,
    })
  } catch (err) {
    logger.error({ err, type: input.type }, 'failed to record security event')
  }
}
