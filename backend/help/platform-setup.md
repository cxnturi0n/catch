# Platform setup

How to connect each platform in Setup → Integrations.

## Discord (live connection)
Bot Token + Server ID

1. Go to discord.com/developers/applications and log in.
2. Open your bot application (or click "New Application" and give it a name).
3. In the left menu click "Bot". Under Token, click "Reset Token" → confirm → "Copy". This is your Bot Token, keep it safe.
4. In the left menu click "OAuth2" → "URL Generator". Under Scopes, tick "bot".
5. Under Bot Permissions, tick: View Channels, Read Message History, and View Audit Log (needed for ban stats).
6. Copy the generated URL at the bottom, open it in your browser, pick your server, and click "Authorize".
7. In the Discord app: User Settings (⚙️) → Advanced → turn on "Developer Mode".
8. Right-click your server name (top-left) → "Copy Server ID".
9. Back in Catch → Integrations → Discord → Connect. Paste the Bot Token and the Server ID, then click Connect.

## Telegram (live connection)
Bot Token + Chat ID

1. Open Telegram and search for "@BotFather" (the official one, with the blue check).
2. Send /newbot, choose a display name, then a username that ends in "bot".
3. BotFather replies with your Bot Token (a long string like 123456:ABC...). Copy it.
4. Open your group → add your new bot as a member.
5. Make the bot an Admin of the group (required to read the member count).
6. Get the Chat ID: temporarily add "@RawDataBot" to the group, it posts the group id (a negative number like -1001234567890). Copy it, then remove that bot.
7. Back in Catch → Integrations → Telegram → Connect. Paste the Bot Token and the Chat ID, then click Connect.

## Twitter / X (CSV import)
Manual CSV import

1. X has no free API, so data is imported manually (takes 1 minute).
2. Go to analytics.twitter.com and log in.
3. Click the "Tweets" tab.
4. Set the date range (up to 90 days).
5. Click "Export data" → "By tweet" to download the CSV.
6. In Catch → Analytics → scroll to the X Analytics section → click "Import CSV" and upload the file.
7. Your impressions, engagements, likes and retweets appear immediately.

## Zealy (live connection)
Community Subdomain + API Key

1. Log in to zealy.io as an admin of your community.
2. Open your community, then go to Settings → API (the "API keys" section).
3. Click "Create API key", give it a name, and copy the key, Zealy shows it only once, so store it safely.
4. Find your community subdomain: it’s the slug in your Zealy URL, zealy.io/cw/<subdomain> (e.g. "arbitrum").
5. Back in Catch → Integrations → Zealy → Connect. Paste the Community Subdomain and the API Key, then click Connect.

## Galxe (live connection)
Space Alias (public, no key)

1. Open galxe.com and go to your project’s Space page.
2. Your Space alias is the last part of the Space URL: galxe.com/<alias> (e.g. galxe.com/optimism → the alias is "optimism").
3. No API key is needed, Catch reads public Space stats (followers, active campaigns, participants).
4. Back in Catch → Integrations → Galxe → Connect. Paste the Space Alias, then click Connect.

## Snapshot (coming soon)
Coming soon

1. Live connection coming soon. You’ll enter your Space ENS, e.g. arbitrum.eth.
