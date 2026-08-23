# AI in Catch

Catch uses AI in three places. In all of them the code computes the numbers and the model only writes words: the model never runs queries, never invents a figure and never takes an action.

## Report (Community Analytics → Report → Generate report)
- Fixed structure every time: executive summary, growth, engagement, sentiment & listening, moderation team, incidents & risk, KOLs & campaigns, operations, recommendations, methodology. Only the data changes.
- Every metric is computed in SQL for the chosen period and the previous period of equal length.
- Rule-based insights (growth drops, high leave rate, low punctuality, no-shows, uncovered peak hours, incident spikes, overdue tasks…) are always present.
- The AI narrative fills the summary, section notes and recommendations; every number it writes is validated against the computed data and rejected slots fall back to rule text. The label under the report title tells which narrative was used.
- Reports are stored per workspace; generating again on unchanged data returns the stored one.
- Report types: Overview (all sections), Single platform (Discord or Telegram only), Moderation (team, incidents, operations).

## Status Update (top bar)
A short briefing written from a snapshot of current numbers, for walking into a call.

## Chat (bottom bar)
Answers questions about this workspace's data and about how Catch works. It reads data through fixed, read-only tools scoped to the current workspace; it cannot see other workspaces and cannot change anything. For actions, use the corresponding module.
