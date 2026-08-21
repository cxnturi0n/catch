import { config } from '../config.js'
import { logger } from '../logger.js'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

// Transactional email. Resend when configured; otherwise the message is
// logged so local development and tests never need network access.
// In-memory outbox used when no provider is configured (dev + tests).
export const emailOutbox: EmailMessage[] = []

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!config.RESEND_API_KEY) {
    emailOutbox.push(msg)
    if (emailOutbox.length > 50) emailOutbox.shift()
    logger.info({ to: msg.to, subject: msg.subject, text: msg.text }, 'email (not sent: RESEND_API_KEY unset)')
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  })
  if (!res.ok) {
    // Never include the response body in the thrown error: it can echo the recipient.
    logger.error({ status: res.status, to: msg.to, subject: msg.subject }, 'resend rejected email')
    throw new Error('Email delivery failed')
  }
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Minimal, dependency-free templates. Branding can be refined later without
// touching the auth flows that call these.
export function actionEmail(opts: { title: string; intro: string; cta: string; url: string; footer?: string }): Pick<EmailMessage, 'html' | 'text'> {
  const footer = opts.footer ?? 'If you did not request this, you can safely ignore this email.'
  return {
    text: `${opts.title}\n\n${opts.intro}\n\n${opts.cta}: ${opts.url}\n\n${footer}`,
    html: `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;background:#0b1020;color:#e5e7eb;padding:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="520" style="max-width:100%;background:#111a2e;border:1px solid #1f2a44;border-radius:12px;padding:28px">
<tr><td>
<h1 style="margin:0 0 12px;font-size:18px;color:#fff">${esc(opts.title)}</h1>
<p style="margin:0 0 20px;line-height:1.6">${esc(opts.intro)}</p>
<a href="${esc(opts.url)}" style="display:inline-block;background:#2f7cf6;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(opts.cta)}</a>
<p style="margin:20px 0 0;font-size:12px;color:#9aa4bf">${esc(footer)}</p>
</td></tr></table></td></tr></table></body></html>`,
  }
}
