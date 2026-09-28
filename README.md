# PoliBot

A Discord bot that uses [DeepSeek](https://api-docs.deepseek.com/), or any OpenAI-compatible model, for two things:

- **`/summarize`** reads the last N messages in the current channel and privately (ephemerally) replies with a summary.
- **`/dailynews`** posts the day's 3 biggest news stories to a chosen channel once a day.

```
/summarize [count:1-500, default 50] [include_bots:true|false]

/dailynews setup channel:#news [time:08:00]   # admins only; time is 24-hour US Eastern
/dailynews now                                # post today's stories immediately
/dailynews status
/dailynews stop
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

## Privacy

Running `/summarize` sends that channel's recent message content to DeepSeek's API. Make sure the server's members and admins are okay with that before you deploy.

Usernames are pseudonymized before anything leaves the bot (`src/summary/anonymize.ts`):

- Message authors and `@mentions` become `User1`, `User2`, and so on. The same person gets the same label throughout a request.
- Plain-text occurrences of the display name, global name, or username of anyone who wrote or was mentioned in the fetched messages are also replaced. Names shorter than 3 characters are skipped.
- The label-to-name mapping stays in memory for that one request. Real names are swapped back into the summary before it's shown in Discord.

This is best effort. Nicknames, misspellings, and names of people who aren't authors or mentioned won't be caught. Everything else in the messages is sent as written, including personal details people typed.

## Development

```sh
npm test         # unit tests for transcript formatting/truncation/chunking
npm run build    # typecheck + compile to dist/
```
