# Discord Quest Completer

> A Discord bot that shows Discord Quests (the sponsored missions in the Quest
> Home), their requirements, progress and rewards - driven entirely through
> slash commands.
>
> Every user gets their own **rooms** for the accounts they want to work
> with. A room is private to the user who created it. The developer guild can
> receive every room event through one webhook configured with `WEBHOOK_URL`.
>
> This is the 2.0 rewrite of the original selfbot. The quest engine and the
> configuration parser were kept; the user-token automation was replaced by
> official bot authentication and OAuth2 account linking.
> See [`docs/MIGRATION.md`](docs/MIGRATION.md) for the full inventory.

---

## Features

| | |
| --- | --- |
| 🧩 **Slash commands only** | 7 command groups, no prefix commands |
| 🔎 **Quest intelligence** | task types, requirements, platforms, rewards, eligibility |
| 🏠 **Private rooms** | every user owns their rooms and their accounts - nobody else sees them |
| 🔗 **Developer webhook** | all room events are mirrored to one webhook (configured with `WEBHOOK_URL`) |
| 🗄️ **SQLite persistence** | versioned migrations, progress history, admin audit log |
| 🔔 **Notifications** | new quests, progress, completion, reward and expiry events |
| 🎨 **Questor style UI** | banner images from the CDN, progress bars, dropdowns with every quest, interactive buttons, pagination |
| 🩺 **Health endpoint** | `/health` for hosting platforms, graceful shutdown |
| 🛡️ **Safe by design** | encrypted token vault, per user scoping, no selfbot |

---

## Requirements

* Node.js **22.5+** (the bot uses the built-in `node:sqlite` module) - Node 24 recommended
* A Discord application with a bot user
* Optional: a persistent disk (SQLite) on your hosting platform

---

## Installation

```bash
git clone https://github.com/adityaingal/Auto-Quest-Discord.git
cd Auto-Quest-Discord
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
6. **Bot -> Privileged Gateway Intents** -> leave everything **off**. The bot
   only needs the `Guilds` intent and never reads messages.

### 2. Configure

```dotenv
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=your-client-secret
DISCORD_REDIRECT_URI=http://localhost:3000/oauth/callback
OWNER_ID=your-discord-user-id,second-owner-user-id
ENCRYPTION_KEY=some-long-random-string
```

> `ENCRYPTION_KEY` is **required**. It protects every stored token. Without
> it the bot refuses to start - there is no default key, because a published
> default would let everybody decrypt the database. Generate one with
> `openssl rand -hex 32`.

### 3. Invite the bot

`https://discord.com/api/oauth2/authorize?client_id=<CLIENT_ID>&permissions=274145032832&scope=bot%20applications.commands`

### 4. Register the commands

Slash commands are registered automatically on startup. For instant
registration in one server, set `GUILD_ID`. Without it the commands are
registered globally (Discord can take up to an hour to propagate).

`/admin setup` shows the current setup and re-registers the commands.

---

## The quest interface

Run `/quest panel` (or `/quest access` first to link your account):

1. The embed shows the banner image, the reward, the requirement, the quest
   name, the enrollment status and the progress bar.
2. Below the embed is the **Quest Selection** dropdown - every quest the bot
   knows about (from the catalogue, from the account you control or a staged
   batch) is listed there. Pick one to switch the banner, reward, tasks,
   progress and enrollment date.
3. Below the dropdown are the action buttons:
   - **View Quest** - opens the official game URL from the quest catalogue.
   - **Details** - full task requirements and reward details.
   - **Progress** - your own reward state and recorded progress.
   - **Refresh** - re-fetches the quest data.
   - **Help** - explains why a quest may be unavailable.
4. Same flow via `/quest select <quest>` or `/quest search <name>`.

> `View Quest` only appears when the quest publishes a game URL.
> Enrolling in a quest happens in the Discord client - the bot routes you to
> it, it does not enrol you automatically.

---

## Command reference

### `/quest`

| Subcommand | Description |
| --- | --- |
| `/quest panel [account]` | **Open the main interface** - quest banner image, reward, progress bar, the Quest dropdown with every quest and the action buttons (Refresh, Details, Progress, View Quest, Help) |
| `/quest access` | Link or manage your own account through the official OAuth2 flow |
| `/quest select <quest>` | Open the main interface for a specific quest |
| `/quest search <name>` | Search the available quests by name |
| `/quest categories` | Show the available quests grouped by platform |
| `/quest list [account]` | All available quests with id, application and eligibility (dropdown + pagination) |
| `/quest info <quest> [account]` | Full details: task types, requirements, platform, rewards |
| `/quest start` | Eligibility check and the official enrolment route (confirmation buttons) |
| `/quest auto <quest> [account]` | Complete one quest with your account |
| `/quest all [account]` | Complete every available quest - **all accounts start at the same time** |
| `/quest all stop` | Stop the running queue after the current quest |
| `/quest sessions` | Your accounts - no token is shown |
| `/quest switch <account>` | Choose the account the bot works with (`all` uses every account) |
| `/quest progress` | Recorded progress with progress bars |
| `/quest status <quest> [account]` | Status of one quest for your account |
| `/quest refresh` | Refresh the quest information and store it |
| `/quest history` | Your recent quest activity |

### `/room`

A room is your own container for accounts. Only you can see it.

| Subcommand | Description |
| --- | --- |
| `/room create <name> [description]` | Create a room. It is reset automatically after 30 days |
| `/room search <name>` | Find your rooms by name and see their accounts |
| `/room list` | List every room you own |
| `/room add <room> <token>` | Add an account to a room - it gets the next free slot |
| `/room remove <room> <slot>` | Remove an account - the remaining slots are closed up |
| `/room delete <room>` | Delete a room with every account in it |
| `/room renew <room>` | Reset the 30 day timer of a room |

The slots of a room are a continuous sequence: `1, 2, 3, ...`. When you
remove the account in slot 2, the account that was in slot 3 moves to slot 2
and the next account you add gets slot 3. There is never a hole in the
sequence.

### Developer webhook

Set `WEBHOOK_URL` to a webhook URL in the guild you use to watch the bot and
every room event is posted there:

- room created
- account added
- account removed

The message carries the **room name**, the **account** and the **event** - it
never carries the token. The webhook is configured once by the developer and
is not available to the users of the bot.

### `/account`

| Subcommand | Description |
| --- | --- |
| `/account link` | Official OAuth2 authorisation (only the `identify` scope) |
| `/account status` | Whether an account is linked and still valid |
| `/account unlink` | Delete the link, the rooms and every trace of your data |
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
| `/admin purge <user>` | Delete every piece of data of a user |

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
Scope  (bot/services/scope.ts)   <- what this user may reach
        |
        v
Quest / Room / Reward / Account / Progress service  (bot/services/*)
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
| `bot/services/` | quest, room, account, progress, reward, notification, admin logic |
| `bot/integrations/` | OAuth2, webhooks, Discord REST for linked accounts, quest providers |
| `bot/database/` | connection, migrations, repositories |
| `bot/ui/` | embeds, components, theme |
| `bot/utils/` | config, logger, errors, crypto |
| `src/` | the preserved legacy quest engine (models + parser) |

### The scope

Every command runs inside a scope that is built from the Discord user id
(`bot/services/scope.ts`). The scope decides:

- which accounts a command may use - the accounts of the rooms of that user,
  and for the owner additionally the operator level accounts,
- which rows a query may touch,
- which settings the user may change - the selected account is stored per
  user, so one user can never change the selection of another one.

The scope is passed explicitly down to the services. There is no global
"current account" that a command could fall back to.

---

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | yes | - | bot token |
| `DISCORD_CLIENT_ID` | yes | - | application id |
| `ENCRYPTION_KEY` | yes | - | key for the token vault - the bot refuses to start without it |
| `DISCORD_CLIENT_SECRET` | no | - | needed for `/account link` |
| `DISCORD_REDIRECT_URI` | no | - | OAuth2 redirect target |
| `OWNER_ID` | no | - | full admin access - several ids, comma separated |
| `ADMIN_ROLE_ID` | no | - | role that may use `/admin` |
| `GUILD_ID` | no | - | guild scoped command registration |
| `DATABASE_PATH` | no | `data/quest-bot.sqlite` | SQLite file |
| `QUEST_CATALOG_PATH` | no | `quest.json` | quest catalogue snapshot |
| `LOG_LEVEL` | no | `INFO` | `DEBUG`/`INFO`/`WARN`/`ERROR` |
| `NOTIFICATION_INTERVAL_MINUTES` | no | `15` | notification polling interval |
| `PORT` | no | `3000` | HTTP port for `/health` and the OAuth2 callback |
| `NOTIFY_CHANNEL_ID` | no | - | channel that receives the status messages |
| `USER_TOKEN` | no | - | a Discord **user** token for the operator - gives access to the live quests and the automation |
| `WEBHOOK_URL` | no | - | webhook in the developer guild - receives every room event |

> `GUILD_ID` accepts several ids (comma separated). Guild scoped commands appear
> instantly, global ones can take up to an hour to propagate.
>
> `ENCRYPTION_KEY` is required. It encrypts every stored token. If it is
> missing the bot refuses to start - there is no built-in fallback key,
> because a published default would let everybody decrypt the database.
> The same key has to be used on every instance, so a token that was stored on
> one instance stays readable on the others.
>
> `USER_TOKEN` enables `/quest auto` and `/quest all` for the **operator**.
> Regular users add their own accounts with `/room add`.

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
   `OWNER_ID` accepts several ids, comma separated - each id gets the same
   full access.
4. Set `DISCORD_REDIRECT_URI` to `https://<your-service>.onrender.com/oauth/callback`
   and add the same URL in the Developer Portal.
5. The blueprint creates a 1 GB disk mounted at `/var/data`; set
   `DATABASE_PATH=/var/data/quest-bot.sqlite` so the data survives restarts.

> `NODE_ENV` must **not** be set on Render - npm would skip the dev
> dependencies and the TypeScript build would fail.

### Quest automation on Render

The quest endpoints are user-session endpoints, so the bot needs a user token:

* every user adds their own with `/room add <room> <token>`, or
* the operator sets `USER_TOKEN=<token>` in the environment, or
* the operator uses `/token add main <token> user` (stored encrypted).

The same `ENCRYPTION_KEY` has to be used on every instance, so a token
registered on one instance stays readable on the others.

> One user token can only be used by one session at a time - opening a second
> gateway session with it invalidates the first one.

### Several accounts at the same time

Every user token is an account. The bot works with all of them:

| Command | Effect |
| --- | --- |
| `/quest sessions` | Lists the accounts, their state and the selected one |
| `/quest switch <account>` | Works only with that account from now on |
| `/quest switch account:all` | Uses every account again |
| `/quest all` | Runs the quests of **all** accounts - they all start at the same time |
| `/quest all account:<label>` | Runs the quests of one account |
| `/quest auto <quest>` | Runs one quest on every account that offers it |

The quests of all accounts are enrolled and advanced **in parallel**, so a
video quest that needs five minutes is finished after five minutes and not
after five minutes per account. The selection made with `/quest switch`
survives a restart.

Every user only ever sees and uses **their own** accounts. The account
labels of one user never appear in the command list of another one.

Docker works as well:

```bash
docker build -t quest-completer .
docker run -d --name quest-completer --restart unless-stopped \
  -p 3000:3000 \
  -v quest-data:/app/data \
  -e DISCORD_BOT_TOKEN=... \
  -e DISCORD_CLIENT_ID=... \
  -e ENCRYPTION_KEY=... \
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
the rooms (including the slot re-sequencing), the token vault, the scoping and
the UI helpers.

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
* **Using a user token violates Discord's terms of service.** `/room add`
  asks for one, so that the bot can read the live quests of that account and
  run the automation for it. Use it at your own risk - a user token that
  automates a Discord account can get that account disabled. The token is
  encrypted at rest, is never shown in full and is never sent to a webhook.
* A room is reset after 30 days. The accounts in it are deleted with it.
* The whitelist is **off** by default, so anybody can use the bot. Turn it on
  with `/admin whitelist enable` if you want to limit it to certain servers
  or users.

---

## Credits

* [discord.js](https://github.com/discordjs/discord.js)
* [discord.food quest docs](https://docs.discord.food/resources/quests)
