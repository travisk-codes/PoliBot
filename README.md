# PoliBot

A Discord bot with three commands. The first two use [DeepSeek](https://api-docs.deepseek.com/), or any OpenAI-compatible model:

- **`/summarize`** reads the last N messages in the current channel and privately (ephemerally) replies with a summary.
- **`/dailynews`** posts the day's 3 biggest news stories to a chosen channel once a day.
- **`/compass`** lets members save their [political compass](https://www.politicalcompass.org/test) coordinates to a Google Sheet, and posts a chart of everyone's.

```
/summarize [count:1-500, default 50] [include_bots:true|false]

/dailynews setup channel:#news [time:08:00]   # admins only; time is 24-hour US Eastern
/dailynews now                                # post today's stories immediately
/dailynews status
/dailynews stop

/compass set economic:-3.5 social:-2.1   # each from -10 to 10
/compass plot                           # posts a chart of everyone in this server
/compass show
/compass remove
```

`/dailynews` is limited to members with **Manage Server** by default. Server admins can change that under Server Settings → Integrations.

## Setup

1. **Create the bot** at <https://discord.com/developers/applications>:
   - Click **New Application** and give it a name.
   - **General Information** page: copy the **Application ID** (a number) → `DISCORD_CLIENT_ID`. It's the same as "Client ID" on the OAuth2 page.
   - **Bot** page: under **Token**, click **Reset Token** and copy the long string → `DISCORD_TOKEN`. Discord shows it only once; if you lose it, reset again. It's a password for your bot, so never commit or share it, and reset it if it leaks.
   - Turn on the **Message Content Intent**. It's on the app's **Bot** page, not General Information. Either:
     - open your application and click **Bot** in the left sidebar, or
     - go to <https://discord.com/developers/applications/select/bot> and pick your app.

     Scroll down past **Token** and **Authorization Flow** to **Privileged Gateway Intents**, turn on **Message Content Intent**, and click **Save Changes**.
     - If this is off, messages come back with empty text, and `/summarize` says there's nothing to summarize.
     - If the bot fails to log in with close code `4014` ("Disallowed intent(s)"), the toggle wasn't saved.
   - Optional, `DISCORD_GUILD_ID`: in the Discord app, turn on User Settings → Advanced → **Developer Mode**, then right-click your server → **Copy Server ID**.
2. **Invite it** using OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: View Channels, Read Message History, Send Messages, Embed Links
   - Or use this link, replacing `YOUR_CLIENT_ID`: `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=84992`
   - If the bot is already in your server, opening the link again updates its permissions.
3. **Configure**:
   ```sh
   cp .env.example .env   # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DEEPSEEK_API_KEY
   npm install
   ```
   Set `DISCORD_GUILD_ID` to your test server's ID to register commands there instantly. Leave it empty to register globally.
4. **Register commands and run**:
   ```sh
   npm run deploy-commands
   npm run dev        # or: npm run build && npm start
   ```
   Re-run `npm run deploy-commands` whenever commands are added or changed, for example after pulling this branch.

### Google Sheets setup (for `/compass`)

The bot signs in to Google as a *service account*, a robot Google account that belongs to your project. It's free.

1. Go to <https://console.cloud.google.com>, sign in, and create a project (top bar → project picker → **New Project**).
2. **APIs & Services → Library**: search for **Google Sheets API** and click **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**. Any name works. Skip the optional role and access steps and click **Done**.
4. Click the new service account, open **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
   - Save it in the project folder as `google-service-account.json`. It's git-ignored.
   - The file is a secret, like the bot token. If it leaks, delete the key on the same page and make a new one.
5. Create a Google Sheet (<https://sheets.new>). Click **Share**, paste the service account's email address (it ends in `.iam.gserviceaccount.com`), and give it **Editor** access.
6. Put the sheet's ID in `.env`. It's the long part of the URL: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`.
   ```
   GOOGLE_SHEET_ID=1AbC...xyz
   GOOGLE_APPLICATION_CREDENTIALS=./google-service-account.json
   ```

The bot creates a **Compass** tab with a header row on first use. You can view or edit the data there. Rows with invalid values are skipped when plotting.

## How it works

- `src/discord/fetchMessages.ts` pages backwards through channel history, 100 messages at a time (Discord's per-request limit).
- `src/summary/format.ts` turns messages into a `[timestamp] name: text` transcript. It drops the oldest lines if the transcript exceeds the character budget.
- `src/summary/llm.ts` sends the transcript to DeepSeek through its OpenAI-compatible API.
- `src/commands/summarize.ts` defers the reply (the LLM call takes longer than 3 s), then edits in an embed. A per-user cooldown of 30 s applies.

### Daily news

- `src/news/feeds.ts` pulls the last 24 hours of headlines from 10 outlets' public RSS feeds: BBC, NPR, NYT, WSJ, Fox News, ABC, CBS, PBS NewsHour, The Guardian and Al Jazeera. It takes up to 10 per outlet.
- `src/news/pick.ts` asks the model to pick the 3 most significant distinct events, preferring stories several outlets cover, and to write a neutral 1–2 sentence summary of each. The post links to the outlets' articles. If the model is unavailable (for example, "Insufficient Balance"), it falls back to the newest headline from 3 outlets, and the footer says so.
- `src/news/scheduler.ts` checks every minute and posts once the configured time has passed each day. If the bot was offline at that time, it posts when it comes back that day. It retries up to 3 times, 15 minutes apart, if posting fails.
- Settings are saved in `data/news-config.json` (git-ignored). It also stores the last few days' links and headlines so stories aren't repeated.
- The bot has to be running for the daily post to happen.

### Political compass

- `src/compass/sheet.ts` stores one row per person per server: server ID, user ID, display name, economic, social, and last updated. It writes with `RAW` input, so the 18-digit Discord IDs stay as text and aren't rounded. Writes go one at a time so simultaneous commands can't overwrite each other.
- `src/compass/plot.ts` draws the chart as SVG and converts it to PNG with `@resvg/resvg-js`:
  - Quadrants use the familiar compass colors, softened.
  - Each person is a labeled dot, and the person who asked is highlighted in orange.
  - Labels are placed so they don't overlap. People at the same spot share a label. In a crowded cluster, labels that can't fit become numbers, listed under the image.
- `/compass plot` is public in the channel. Everything else replies privately.

## Privacy

Running `/summarize` sends that channel's recent message content to DeepSeek's API. Make sure the server's members and admins are okay with that before you deploy.

Usernames are pseudonymized before anything leaves the bot (`src/summary/anonymize.ts`):

- Message authors and `@mentions` become `User1`, `User2`, and so on. The same person gets the same label throughout a request.
- Plain-text occurrences of the display name, global name, or username of anyone who wrote or was mentioned in the fetched messages are also replaced. Names shorter than 3 characters are skipped.
- The label-to-name mapping stays in memory for that one request. Real names are swapped back into the summary before it's shown in Discord.

This is best effort. Nicknames, misspellings, and names of people who aren't authors or mentioned won't be caught. Everything else in the messages is sent as written, including personal details people typed.

`/compass` stores members' display names and coordinates in your Google Sheet. Only people who run `/compass set` are included, and `/compass remove` deletes their row.

## Development

```sh
npm test         # unit tests for transcript formatting/truncation/chunking
npm run build    # typecheck + compile to dist/
```
