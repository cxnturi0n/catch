import type { XAnalyticsData } from '../types'

const STORAGE_KEY_PREFIX = 'catch:x-analytics:'

function storageKey(workspaceId: string): string {
  return `${STORAGE_KEY_PREFIX}${workspaceId}`
}

export function loadXAnalytics(workspaceId: string): XAnalyticsData | null {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (!raw) return null
    return JSON.parse(raw) as XAnalyticsData
  } catch {
    return null
  }
}

export function saveXAnalytics(workspaceId: string, data: XAnalyticsData): void {
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(data))
  } catch {
    // localStorage full or unavailable
  }
}

export function clearXAnalytics(workspaceId: string): void {
  try {
    localStorage.removeItem(storageKey(workspaceId))
  } catch {
    // ignore
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

export async function parseXAnalyticsCsvFile(file: File): Promise<XAnalyticsData> {
  const text = await file.text()
  // Remove BOM if present
  const clean = text.replace(/^﻿/, '')
  const lines = clean.split(/\r?\n/).filter((l) => l.trim())

  // Find header row — the one that contains the "impressions" column
  let headerIdx = -1
  let headers: string[] = []
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cols = parseCsvLine(lines[i]).map((h) => h.toLowerCase().trim().replace(/['"]/g, ''))
    if (cols.includes('impressions')) {
      headerIdx = i
      headers = cols
      break
    }
  }

  if (headerIdx === -1) {
    throw new Error(
      'Could not find data columns. Make sure you exported "Tweet activity" (By tweet) from analytics.twitter.com.',
    )
  }

  const col = (name: string) => headers.indexOf(name)
  const timeIdx = col('time')
  const impressionsIdx = col('impressions')
  const engagementsIdx = col('engagements')
  const likesIdx = col('likes')
  const retweetsIdx = col('retweets')
  const repliesIdx = col('replies')

  if (timeIdx === -1 || impressionsIdx === -1) {
    throw new Error('Missing required columns (time, impressions). Export "By tweet" from the Tweets tab.')
  }

  type DayBucket = { impressions: number; engagements: number; likes: number; retweets: number; replies: number }
  const byDate = new Map<string, DayBucket>()

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    if (cols.length < 4) continue
    const timeStr = cols[timeIdx]?.trim() ?? ''
    const dateMatch = timeStr.match(/(\d{4}-\d{2}-\d{2})/)
    if (!dateMatch) continue
    const date = dateMatch[1]

    const n = (idx: number) => (idx !== -1 ? parseInt(cols[idx] ?? '0', 10) || 0 : 0)
    const prev = byDate.get(date) ?? { impressions: 0, engagements: 0, likes: 0, retweets: 0, replies: 0 }
    byDate.set(date, {
      impressions: prev.impressions + n(impressionsIdx),
      engagements: prev.engagements + n(engagementsIdx),
      likes: prev.likes + n(likesIdx),
      retweets: prev.retweets + n(retweetsIdx),
      replies: prev.replies + n(repliesIdx),
    })
  }

  if (byDate.size === 0) {
    throw new Error('No tweet data found in the file. The export may be empty or in an unexpected format.')
  }

  const trend = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, m]) => ({ date, impressions: m.impressions, engagements: m.engagements }))

  const dates = trend.map((t) => t.date)
  const totalImpressions = trend.reduce((s, t) => s + t.impressions, 0)
  const totalEngagements = trend.reduce((s, t) => s + t.engagements, 0)
  const vals = [...byDate.values()]
  const totalLikes = vals.reduce((s, m) => s + m.likes, 0)
  const totalRetweets = vals.reduce((s, m) => s + m.retweets, 0)
  const totalReplies = vals.reduce((s, m) => s + m.replies, 0)

  return {
    importedAt: new Date().toISOString(),
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    totalImpressions,
    totalEngagements,
    avgEngagementRate: totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0,
    totalLikes,
    totalRetweets,
    totalReplies,
    trend,
  }
}
