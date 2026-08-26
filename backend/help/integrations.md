# Integrations

Connecting Discord, Telegram and other platforms

Connect your clients’ platforms to pull live data into Catch automatically.

## How to use it
1. Open the Integrations tab for the workspace you want to connect.
2. Choose a platform, follow its setup steps below, and paste in the credentials.
3. Once connected, data flows on its own: Discord through a live gateway connection, Telegram through a webhook, metrics every minute. Sync Now forces a fresh pull.

## How to use per platform
- **Discord**, Create a bot at discord.com/developers, enable the Server Members and Message Content intents, copy the Bot Token and Server ID, and paste them into Catch. The bot must be added to the server with View Channels, Read Message History and View Audit Log. Catch imports 30 days of history and then listens live.
- **Telegram**, Create a bot via @BotFather, get the Bot Token, add the bot to the group as admin (or disable privacy mode), then paste the Chat ID into Catch. The webhook is registered automatically; public groups get a 30 day history import.
- **X / Twitter (CSV Import)**, X does not offer a free API. Instead, export your tweet analytics as a CSV: go to analytics.twitter.com → click the "Tweets" tab → set your date range (up to 90 days) → click "Export data" → select "By tweet". Then open the Analytics page in Catch, scroll to the X Analytics section and click "Import CSV" to upload the file. Your impressions, engagements, likes and retweets will appear immediately.
- **Zealy**, Copy your API key from the Zealy dashboard → Settings → API, and grab your community subdomain from your Zealy URL (zealy.io/cw/<subdomain>). Paste both into Catch to pull member count, total XP and the top questers.
- **Galxe**, Grab your Space alias from your Galxe URL (galxe.com/<alias>) and paste it into Catch, no API key needed. Catch reads public Space stats: followers, active campaigns and total participants.
- **Snapshot**, Enter your Space ENS, e.g. arbitrum.eth.

## Privacy
- Message text from Discord and Telegram is stored encrypted for 30 days so the AI report and chat can analyse it, then deleted. Counts and aggregates are kept. Disconnecting a platform deletes its stored text immediately.

## Pro tips
- Ask clients to add the bot themselves, send them a one-page setup guide instead of asking for raw tokens.
- Reconnect integrations if a token expires, some platforms rotate tokens as often as every 90 days.
