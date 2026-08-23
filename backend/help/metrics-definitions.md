# Metric definitions

How every number in Catch reports and analytics is computed. All days are UTC calendar days. "Previous period" means the window of equal length immediately before the selected one.

## Community growth
- **Total members**, latest daily membership snapshot per connected platform, summed. Not unique users across platforms.
- **Net growth**, last snapshot minus first snapshot inside the period.
- **Growth rate**, net growth divided by the first snapshot, in percent.
- **Joins / Leaves**, Telegram: exact join/leave events from the bot webhook. Discord: new and left members from membership snapshots.
- **Leave rate**, leaves divided by total members, in percent.

## Engagement
- **Messages**, human messages counted per member per day; message text is never stored.
- **Messages per day**, messages divided by the number of days in the period.
- **Active members**, distinct members (platform + member id) with at least one message in the period.
- **Engagement rate**, active members divided by total members, in percent.
- **Avg daily active**, distinct posting members per day, averaged over days with data.
- **Messages per active member**, messages divided by active members.
- **Peak hour (UTC)**, the hour of day with the most messages in the period.
- **Share of messages in top 3 hours**, how concentrated activity is; above 40% means staffing should follow that window.

## Moderation team
- **Moderator messages**, messages whose author display name matches a moderator's Discord or Telegram handle (case and @ insensitive).
- **Shifts evaluated**, scheduled shift days in the period that were checked.
- **Punctuality**, share of evaluated shifts where the moderator's first message fell within 15 minutes after the shift start.
- **No-shows**, evaluated shifts with no moderator activity during the whole shift window.
- **Peak hours without a shift**, how many of the 3 busiest UTC hours have no moderator shift covering them.
- **Paid**, payments recorded in the period, per currency.

## Incidents & risk
- **Incidents**, incidents logged with a date inside the period, compared with the previous period.
- **Resolution rate**, resolved incidents divided by incidents in the period.
- **Open for more than 72h**, incidents still Open or Escalated that were created more than 72 hours ago.

## KOLs & campaigns
- **Active in period**, KOLs whose last activity date falls inside the period.
- **Combined reach**, sum of the reach field of all tracked KOLs.

## Operations
- **Task completion**, tasks in status Done divided by all tasks.
- **Overdue tasks**, tasks past due date and not Done.
- **Schedule adherence**, published content divided by all content planned in the period (scheduled + published + cancelled).

## Sentiment & listening
Not collected yet. The section is present in every report and will populate when Listening is connected.
