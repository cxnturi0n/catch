// HTML email renderer for scheduled reports (#6).
//
// Email clients run NO JavaScript (so no recharts) and inconsistently support
// <style>/flexbox/grid — so this is table-based layout with INLINE styles and
// bar "charts" drawn as nested divs whose width is a percentage. Sapphire
// palette + top/bottom stripes match the in-app one-pager. Keep it to one
// screenful of content.

interface WorkspaceReport {
  workspaceName: string
  reportType: 'community' | 'general'
  periodStart: string
  periodEnd: string
  members: number | null
  incidentsTotal: number
  incidentsResolved: number
  incidentsByType: { label: string; value: number }[]
  tasksByStatus: { label: string; value: number }[]
  paymentsTotal: number
  paymentsCurrency: string
  paymentsCount: number
  moderatorCount: number
}

const SERIES = ['#2f7cf6', '#8cc5ff', '#1e3a8a', '#6db3ff', '#14276b', '#4d9fff']

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function kpiCell(label: string, value: string): string {
  return `<td style="padding:8px;border:1px solid #1c2b47;border-radius:8px;background:#0c1424;">
    <div style="font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:#9fb2d4;">${esc(label)}</div>
    <div style="font-size:18px;font-weight:700;color:#ffffff;">${esc(value)}</div>
  </td>`
}

/** Horizontal bar rows — the no-JS stand-in for a bar/pie chart. */
function barTable(title: string, rows: { label: string; value: number }[]): string {
  if (rows.length === 0) return ''
  const max = Math.max(...rows.map((r) => r.value), 1)
  const total = rows.reduce((s, r) => s + r.value, 0)
  const body = rows
    .map((r, i) => {
      const widthPct = Math.max(4, Math.round((r.value / max) * 100))
      const share = total > 0 ? Math.round((r.value / total) * 100) : 0
      const color = SERIES[i % SERIES.length]
      return `<tr>
        <td style="width:38%;padding:4px 8px 4px 0;font-size:13px;color:#cbd5e1;">${esc(r.label)}</td>
        <td style="padding:4px 0;">
          <div style="background:#0c1424;border-radius:6px;overflow:hidden;">
            <div style="width:${widthPct}%;background:${color};height:14px;border-radius:6px;"></div>
          </div>
        </td>
        <td style="width:64px;padding:4px 0 4px 8px;font-size:12px;color:#ffffff;text-align:right;">${fmtNum(r.value)} · ${share}%</td>
      </tr>`
    })
    .join('')
  return `<div style="margin:0 0 20px;">
    <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#8cc5ff;margin-bottom:8px;">${esc(title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">${body}</table>
  </div>`
}

export function renderReportEmail(report: WorkspaceReport): string {
  const typeLabel = report.reportType === 'community' ? 'Community Analytics Report' : 'General Report'
  const periodLabel = `${fmtDate(report.periodStart)} – ${fmtDate(report.periodEnd)}`

  const kpis: [string, string][] = []
  if (report.members != null) kpis.push(['Members', fmtNum(report.members)])
  if (report.reportType === 'general') {
    kpis.push(['Incidents', `${report.incidentsResolved}/${report.incidentsTotal}`])
    kpis.push(['Moderators', fmtNum(report.moderatorCount)])
    if (report.paymentsTotal > 0) kpis.push(['Payout', `${fmtNum(report.paymentsTotal)} ${esc(report.paymentsCurrency)}`])
  }
  if (kpis.length === 0) kpis.push(['Workspace', esc(report.workspaceName)])

  const kpiRow = `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 20px;"><tr>${kpis
    .map(([l, v]) => kpiCell(l, v))
    .join('')}</tr></table>`

  const charts =
    report.reportType === 'general'
      ? barTable('Incidents by type', report.incidentsByType) + barTable('Tasks by status', report.tasksByStatus)
      : ''

  const summary =
    report.reportType === 'general'
      ? `${esc(report.workspaceName)} handled ${report.incidentsTotal} moderation incident${report.incidentsTotal === 1 ? '' : 's'} (${report.incidentsResolved} resolved) this period, with ${report.moderatorCount} moderator${report.moderatorCount === 1 ? '' : 's'} on the roster${report.paymentsTotal > 0 ? ` and ${fmtNum(report.paymentsTotal)} ${esc(report.paymentsCurrency)} paid out` : ''}.`
      : `${esc(report.workspaceName)} community snapshot for ${periodLabel}.${report.members != null ? ` Currently tracking ${fmtNum(report.members)} members across connected platforms.` : ''}`

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;background:#060812;padding:24px 12px;font-family:Inter,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#0c1424;border:1px solid #1c2b47;border-radius:16px;overflow:hidden;">
        <tr><td style="height:8px;background:#2f7cf6;background-image:linear-gradient(90deg,#1e3a8a,#2f7cf6,#8cc5ff);font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:40px;height:40px;background:#2f7cf6;background-image:linear-gradient(135deg,#1e3a8a,#2f7cf6,#8cc5ff);border-radius:10px;text-align:center;vertical-align:middle;color:#fff;font-weight:800;font-size:18px;">C</td>
            <td style="padding-left:12px;">
              <div style="font-size:18px;font-weight:800;color:#ffffff;">${esc(typeLabel)}</div>
              <div style="font-size:13px;color:#9fb2d4;">${esc(report.workspaceName)} · ${esc(periodLabel)}</div>
            </td>
          </tr></table>

          <p style="margin:20px 0;padding:14px 16px;background:rgba(255,255,255,0.03);border:1px solid #1c2b47;border-radius:12px;font-size:14px;line-height:1.6;color:#e2e8f0;">${summary}</p>

          ${kpiRow}
          ${charts}

          <div style="margin-top:8px;font-size:12px;color:#6b7ba0;text-align:center;">Generated by Catch · ${esc(fmtDate(new Date().toISOString()))}</div>
        </td></tr>
        <tr><td style="height:8px;background:#2f7cf6;background-image:linear-gradient(90deg,#8cc5ff,#2f7cf6,#1e3a8a);font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
