# Discord Quest Completer

> A Discord bot that shows Discord Quests (the sponsored missions in the Quest
> Home), their requirements, progress and rewards - driven entirely through
> slash commands.
>
> This is the 2.0 rewrite of the original selfbot. The quest engine and the
> configuration parser were kept; the user-token automation was replaced by
> official bot authentication and OAuth2 account linking.
> See [`docs/MIGRATION.md`](docs/MIGRATION.md) for the full inventory.

---

## Features

| | |
| --- | --- |
| 🧩 **Slash commands only** | 26 commands in 5 groups, no prefix commands |
| 🔎 **Quest intelligence** | task types, requirements, platforms, rewards, eligibility |
| 🔐 **Official OAuth2 linking** | encrypted token storage, single-use state, revocable |
| 🗄️ **SQLite persistence** | versioned migrations, progress history, admin audit log |
| 🔔 **Notifications** | new quests, progress, completion, reward and expiry events |
| 🎨 **Rich UI** | embeds, progress bars, dropdowns, pagination, confirmation buttons |
| 🩺 **Health endpoint** | `/health` for hosting platforms, graceful shutdown |
| 🛡️ **Safe by design** | no selfbot, no user tokens, no captcha automation |

---

## Requirements

* Node.js **22.5+** (the bot uses the built-in `node:sqlite` module) - Node 24 recommended
* A Discord application with a bot user
* Optional: a persistent disk (SQLite) on your hosting platform

---

## Installation

```bash
git clone <your-repo> discord-quest-completer
cd discord-quest-completer
npm install
cp .env.example .env      # then fill it in
npm run build
npm start
```

### 1. Create the Discord application

1. <https://discord.com/developers/applications> -> **New Application**
2. **Bot** -> **Reset Token** -> copy it into `DISCORD_BOT_TOKEN`
3. **General Information** -> copy the **Application ID** into `DISCORD_CLIENT_ID`
4. **OAuth2 -> Redirects** -> add `https://<your-host>/oauth/callback`
   (local development: `http://localhost:3000/oauth/callback`)
5. **OAuth2 -> URL Configuration** -> copy the **Client Secret** into
   `DISCORD_CLIENT_SECRET`
6. **Bot -> Privileged Gateway Intents** -> enable *Message Content* if you
   want the bot to read command context in DMs

### 2. Configure

```dotenv
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=your-client-secret
DISCORD_REDIRECT_URI=http://localhost:3000/oauth/callback
OWNER_ID=your-discord-user-id
ENCRYPTION_KEY=some-long-random-string
```

### 3. Invite the bot

`https://discord.com/api/oauth2/authorize?client_id=<CLIENT_ID>&permissions=274145032832&scope=bot%20applications.commands`

### 4. Register the commands

Slash commands are registered automatically on startup. For instant
registration in one server, set `GUILD_ID`. Without it the commands are
registered globally (Discord can take up to an hour to propagate).

`/admin setup` shows the current setup and re-registers the commands.

---

## Command reference

### `/quest`

| Subcommand | Description |
| --- | --- |
| `/quest list` | All available quests with id, application and eligibility (dropdown + pagination) |
| `/quest info` | Full details: task types, requirements, platform, rewards |
| `/quest start` | Eligibility check and the official enrolment route (confirmation buttons) |
| `/quest auto <quest>` | Complete one quest with the configured user session |
| `/quest all` | Complete every available quest, with a live progress bar and timer |
| `/quest all stop` | Stop the running queue after the current quest |
| `/quest sessions` | The user accounts (sessions) the bot works with - no token is shown |
| `/quest progress` | Recorded progress with progress bars |
| `/quest status` | Status of one quest for your account |
| `/quest refresh` | Refresh the quest information and store it |
| `/quest history` | Your recent quest activity |

### `/account`

| Subcommand | Description |
| --- | --- |
| `/account link` | Official OAuth2 authorisation (only the `identify` scope) |
| `/account status` | Whether an account is linked and still valid |
| `/account unlink` | Delete the linked account and its credentials |
| `/account privacy` | What is stored, who can see it, how to remove it |

### `/task`

| Subcommand | Description |
| --- | --- |
| `/task list` | Every task type Discord uses |
| `/task info` | What one task type requires |
| `/task progress` | Show the recorded progress per quest |
| `/task verify` | Verify a value against a live API response (never fabricates one) |

### `/reward`

| Subcommand | Description |
| --- | --- |
| `/reward list` | Rewards recorded for your account |
| `/reward info` | Reward details and the requirements behind them |
| `/reward status` | Eligibility and claim status |
| `/reward claim` | Start the official claim flow (human captcha when Discord asks) |
| `/reward code` | Fetch a claimed reward code through the Discord API |

### `/token` (owner or admin role)

| Subcommand | Description |
| --- | --- |
| `/token list [type]` | Every stored token - `bot`, `user` or all (masked, never in full) |
| `/token add <label> <token> <type>` | Register a **bot** token (extra bot instance) or a **user** token (quests) |
| `/token import [label]` | Register the `USER_TOKEN` environment variable as an account |
| `/token remove <id>` | Delete a stored token |
| `/token check <id>` | Validate a stored token against Discord |

### `/admin` (owner or admin role)

| Subcommand | Description |
| --- | --- |
| `/admin setup` | Setup status, user sessions and command registration |
| `/admin stats` | Usage statistics |
| `/admin users` | Known users |
| `/admin logs` | Admin audit log |
| `/admin reload` | Reload the catalogue and the configuration |
| `/admin backup` | Write a database backup |
| `/admin restore` | Restore a backup (autocomplete over the backup files) |
| `/admin maintenance` | Toggle maintenance mode (confirmation button) |
| `/admin config` | Read and write configuration values |

### `/admin whitelist` (owner or admin role)

| Subcommand | Description |
| --- | --- |
| `/admin whitelist list` | The whitelisted servers and users |
| `/admin whitelist add guild\|user <id>` | Allow a server or a user |
| `/admin whitelist remove guild\|user <id>` | Remove it |
| `/admin whitelist enable` / `disable` | Turn the restriction on or off (off by default) |
| `/admin whitelist sync` | Add every server the bot is in |

---

## Architecture

```
Discord slash command
        |
        v
Command handler  (bot/commands/*)
        |
        v
Quest / Reward / Account / Progress service  (bot/services/*)
        |
        v
Legacy quest engine  (src/quest.ts + src/interface.ts)   <- unchanged parsing
        |
        v
Quest provider  (bot/integrations/*)
        |
        v
SQLite (bot/database/*)
        |
        v
Embed response (bot/ui/*)
```

| Folder | Content |
| --- | --- |
| `bot/commands/` | slash command definitions and the component router |
| `bot/services/` | quest, account, progress, reward, notification, admin logic |
| `bot/integrations/` | OAuth2, Discord REST for linked accounts, quest providers |
| `bot/database/` | connection, migrations, repositories |
| `bot/ui/` | embeds, components, theme |
| `bot/utils/` | config, logger, errors, crypto |
| `src/` | the preserved legacy quest engine (models + parser) |

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | yes | - | bot token |
| `DISCORD_CLIENT_ID` | yes | - | application id |
| `DISCORD_CLIENT_SECRET` | no | - | needed for `/account link` |
| `DISCORD_REDIRECT_URI` | no | - | OAuth2 redirect target |
| `ENCRYPTION_KEY` | no | client secret | key for the token vault |
| `OWNER_ID` | no | - | full admin access |
| `ADMIN_ROLE_ID` | no | - | role that may use `/admin` |
| `GUILD_ID` | no | - | guild scoped command registration |
| `DATABASE_PATH` | no | `data/quest-bot.sqlite` | SQLite file |
| `QUEST_CATALOG_PATH` | no | `quest.json` | quest catalogue snapshot |
| `LOG_LEVEL` | no | `INFO` | `DEBUG`/`INFO`/`WARN`/`ERROR` |
| `NOTIFICATION_INTERVAL_MINUTES` | no | `15` | notification polling interval |
| `PORT` | no | `3000` | HTTP port for `/health` and the OAuth2 callback |
| `NOTIFY_CHANNEL_ID` | no | - | channel that receives the status messages |
| `USER_TOKEN` | no | - | a Discord **user** token - gives access to the live quests and the automation |

> `GUILD_ID` accepts several ids (comma separated). Guild scoped commands appear
> instantly, global ones can take up to an hour to propagate.
>
> `USER_TOKEN` enables `/quest auto` and `/quest all`. It is an optional,
> operator managed setting - `/token add <label> <token> user` stores the same
> kind of token encrypted in the database and works without any environment
> variable.

---

## Render deployment

`render.yaml` is included - Render picks it up automatically.

1. Push the repository to GitHub and create a **Web Service** from it.
2. Render uses `render.yaml` (or set it manually):
   * Build command: `npm ci --include=dev && npm run build`
   * Start command: `npm start`
   * Health check path: `/health`
3. Add the environment variables (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`,
   `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `OWNER_ID`,
   `ENCRYPTION_KEY`, `GUILD_ID`, `DATABASE_PATH=/var/data/quest-bot.sqlite`).
4. Set `DISCORD_REDIRECT_URI` to `https://<your-service>.onrender.com/oauth/callback`
   and add the same URL in the Developer Portal.
5. The blueprint creates a 1 GB disk mounted at `/var/data`; set
   `DATABASE_PATH=/var/data/quest-bot.sqlite` so the data survives restarts.

> `NODE_ENV` must **not** be set on Render - npm would skip the dev
> dependencies and the TypeScript build would fail.

### Quest automation on Render

The quest endpoints are user-session endpoints, so the bot needs a user token:

* either `USER_TOKEN=<token>` in the environment, or
* `/token add main <token> user` from Discord (stored encrypted).

The same `ENCRYPTION_KEY` has to be used on every instance, so a token
registered on one instance stays readable on the others.

> One user token can only be used by one session at a time - opening a second
> gateway session with it invalidates the first one.

Docker works as well:

```bash
docker build -t quest-completer .
docker run -d --name quest-completer --restart unless-stopped \
  -p 3000:3000 \
  -v quest-data:/app/data \
  -e DISCORD_BOT_TOKEN=... \
  -e DISCORD_CLIENT_ID=... \
  quest-completer
```

---

## Development

```bash
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
npm test           # node:test suite
npm run build      # compile to dist/
```

The test suite covers the legacy parser (both `task_config` formats), the
database migrations, the repositories, the command definitions, the services,
the token vault and the UI helpers.

---

## Limits (and why)

* Discord's quest endpoints are **user session** endpoints. A bot account gets
  `401`, so the bot cannot enrol quests, forge progress or claim rewards by
  itself. It reports what the official API returns and routes the action to the
  Discord client.
* Captcha verifications are always solved by a human - the bot never bypasses
  them.
* The bundled `quest.json` is a snapshot of the quest configurations; use
  `/quest refresh` to update the stored copy.
* A user token can only drive one session at a time - a second session with the
  same token invalidates the first one.
* Using a user token violates Discord's terms of service. Use it at your own
  risk.

---

## Credits

* [discord.js](https://github.com/discordjs/discord.js)
* [discord.food quest docs](https://docs.discord.food/resources/quests)
