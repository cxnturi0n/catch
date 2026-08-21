export function formatCompactNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function formatDay(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatLongDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "3 days ago", "just now", "2 weeks ago", etc. Falls back to a plain date past ~2 months. */
export function formatRelativeTime(dateStr: string): string {
  const then = new Date(dateStr).getTime()
  const now = Date.now()
  const diffMs = now - then
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7)
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  }
  if (diffDays < 60) return '1 month ago'
  return formatLongDate(dateStr)
}

export function isOverdue(dateStr: string): boolean {
  const due = new Date(dateStr)
  due.setHours(23, 59, 59, 999)
  return due.getTime() < Date.now()
}
