# Discord Quest Completer — Full Program Information

> **Status**: version 2.1, public at https://github.com/adityaingal/Auto-Quest-Discord
> **Audience**: another AI or engineer asked to modify, extend or integrate this bot.
> Read this file first. It tells you exactly what exists, how it works and
> what is intentionally NOT implemented.

---

## 1. What this is

A Discord bot that shows Discord Quests (sponsored missions in the Quest
Home), their requirements, progress and rewards — driven entirely through
slash commands. It does **not** bypass authentication, solve CAPTCHAs or
cheat the quest system. It only reports what Discord returns and routes the
user to the official enrolment route.

It has three cooperating layers:

1. **A public-facing bot** — every Discord user can run the slash commands.
2. **Per-user "rooms"** — private account storage. Each user owns their own
   rooms containing the Discord user tokens they want to manage. Nobody else
   can see or use those accounts.
3. **Quest intelligence** — a bundled snapshot of the current quests
   (`quest.json`, 41 quests) that is also refreshed live from a linked
   account when possible.

### Absolute requirements

* Node.js >= 22.5 (uses the built-in `node:sqlite` module)
* A Discord application with a bot user
* npm dependencies (`discord.js` v14, `discord-api-types`, `chalk`,
  `cli-table3`, `figlet`, `tsx`, `typescript`)
* A licence-compatible environment (GPL-3.0)

---

## 2. High-level architecture

```
Discord slash command
        |
        v
Command handler  (bot/commands/*)
        |
        v
Scope  (bot/services/scope.ts)   <-- what this user may reach
        |
        v
Quest / Room / Reward / Account / Progress service  (bot/services/*)
        |
        v
Legacy quest engine  (src/quest.ts + src/interface.ts)  <-- unchanged parsing
        |
        v
Quest provider  (bot/integrations/*)   OAuth2, webhooks, Discord REST
        |
        v
SQLite (bot/database/*)
        |
        v
Embed response (bot/ui/*)
```

### Folder layout

| Folder | Content |
| --- | --- |
| `bot/commands/` | Slash command definitions and the component router |
| `bot/services/` | Business logic: quests, rooms, accounts, progress, rewards, notifications, admin |
| `bot/integrations/` | OAuth2, webhooks, Discord REST (quest endpoints, `/users/@me`, `/quests/@me`) |
| `bot/database/` | Connection, versioned migrations, repositories |
| `bot/ui/` | Embeds, buttons, dropdowns, theme |
| `bot/utils/` | Config, logger, errors, crypto (AES-256-GCM vault, HMAC state) |
| `src/` | The original selfbot quest engine, preserved as-is for parsing |
| `data/` | SQLite file (gitignored) |

---

## 3. Security model (the single most important section)

**Every command, autocomplete and component interaction runs inside a scope.**
The scope is built from the Discord user id in `bot/services/scope.ts`:

```ts
export type AccountScope = {
  userId: string;          // the Discord user id
  isOperator: boolean;     // true only for OWNER_ID / whitelisted admins
};
```

### Rules

1. **A user can only reach their own data.** Rooms store tokens encrypted
   with `ENCRYPTION_KEY`. The scope filters every query.
2. **The operator's accounts are visible to the operator only.** The
   optional operator-level user token (`USER_TOKEN` / `!token add ... user`)
   is used exclusively when `scope.isOperator` is true.
3. **The encryption key has NO default.** The bot refuses to start without
   `ENCRYPTION_KEY`. Never reintroduce a fallback key — a published default
   would let anyone decrypt the database.
4. **The whitelist is enforced on every interaction type** — slash commands,
   buttons and the autocomplete.
5. **Component interactions carry the scope** encoded in the custom id
   (e.g. `quest:panel_refresh:<questId>:<base64url(account)>`), so a button
   can never reach another user's panel or account.
6. **Tokens are never shown.** `TokenService.mask` / `fingerprint` are the
   only ways a token may be displayed.

### The token vault

`TokenVault` (bot/utils/crypto.ts) uses **AES-256-GCM** with a random 12-byte
IV per record and a SHA-256-derived 32-byte key from `ENCRYPTION_KEY` (or,
as a fallback if unset, `DISCORD_CLIENT_SECRET`). The vault class also signs
OAuth2 state values (HMAC-SHA256), all bound to the user that started the
flow.

---

## 4. Data model (SQLite, versioned migrations)

Migrations live in `bot/database/index.ts`; they run at startup.

| Version | Name | What |
| --- | --- | --- |
| v1 | `initial_schema` | Tables: `users`, `account_links`, `quest_records`, `quest_progress`, `quest_history`, `reward_records`, `notification_settings`, `guild_settings`, `admin_logs`, `bot_config`, `oauth_states` |
| v2 | `bot_tokens` | `bot_tokens` table — additional bot tokens |
| v3 | `token_types` | Renames `bot_tokens` → `tokens`; adds `type`, `account_id`, `account_username` |
| v4 | `whitelist` | Whitelisted guilds/users |
| v5 | `whitelist_roles` | Whitelist entries get a role: `member` or `admin` |
| v6 | `rooms` | **Rooms and room_accounts** — every user owns private rooms for their accounts |
| v7 | `drop_per_room_webhooks` | Drops the per-room webhook columns (replaced by the single developer webhook from env) |

### Tables

- **`users`** — discord_user_id (PK), username, created/updated timestamps.
- **`account_links`** — discord_user_id, discord_account_id, username,
  access_token, refresh_token (both encrypted), expires_at, scopes.
  UNIQUE(discord_user_id, discord_account_id).
- **`quest_records`** — quest catalogue snapshot, reused for the cmdlet.
- **`quest_progress`** — one row per (user, quest): status, value, target,
  percent, enrolled/completed/claimed.
- **`quest_history`** — user-visible event log.
- **`reward_records`** — reward eligibility/claim state per (user, quest).
- **`notification_settings`** — per-user notification toggles.
- **`bot_config`** — maintenance mode, whitelist state, per-user default
  account key (`account.<discordUserId>`), etc.
- **`oauth_states`** — single-use signed OAuth2 state, bound to the user.
- **`rooms`** (v6) — owner_user_id, name, description, expires_at. Rooms are
  **reset after 30 days**.
- **`room_accounts`** (v6) — room_id, slot (1, 2, 3, ... continuous), token
  (encrypted), account_id, account_username, status. UNIQUE(room_id, slot).
  Removing an account closes the gap in the sequence.

### Deleting data

`/account unlink` (`accountService.unlink`) and the owner-only prefix command `!admin purge <user>` both call `repositories.purgeUser()`, which deletes
the user's: rooms, room_accounts, account_links, quest_progress,
quest_history, reward_records, notification_settings and oauth_states.

---

## 5. Environment variables

Required: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `ENCRYPTION_KEY`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | yes | — | Bot token from the Developer Portal |
| `DISCORD_CLIENT_ID` | yes | — | Application id |
| `ENCRYPTION_KEY` | **yes** | — | Key for the token vault. **The bot refuses to start without it.** |
| `DISCORD_CLIENT_SECRET` | no | — | Needed for `/account link` |
| `DISCORD_REDIRECT_URI` | no | — | OAuth2 redirect target |
| `OWNER_ID` | no | — | Comma separated ids — full admin access |
| `ADMIN_ROLE_ID` | no | — | Role that may use the owner commands |
| `GUILD_ID` | no | — | Guild-scoped registration (comma separated) |
| `DATABASE_PATH` | no | `data/quest-bot.sqlite` | SQLite file |
| `QUEST_CATALOG_PATH` | no | `quest.json` | Quest catalogue |
| `LOG_LEVEL` | no | `INFO` | `DEBUG`/`INFO`/`WARN`/`ERROR` |
| `NOTIFICATION_INTERVAL_MINUTES` | no | `15` | Notification polling interval |
| `PORT` | no | `3000` | HTTP port for `/health` and OAuth2 callback |
| `WEBHOOK_URL` | no | — | Discord webhook in the developer guild; receives room events |
| `USER_TOKEN` | no | — | Discord user token for the operator — Questor style live data and automation. ToS violation; optional |
| `NOTIFY_CHANNEL_ID` | no | — | Channel for the notifier service |

Render: see `render.yaml`. `NODE_ENV` must NOT be set (npm would skip the
dev dependencies and the TypeScript build would fail).

---

## 6. Command reference

Public slash commands follow Discord scopes for every Discord user. The
administrative commands are owner-only prefix commands (default prefix `!`).

### `/quest`

| Subcommand | Purpose |
| --- | --- |
| `list [account]` | All available quests (dropdown + pagination) |
| `info <quest> [account]` | Full details: tasks, requirements, rewards |
| `start` | Eligibility check and the official enrolment route |
| `sessions` | Show the accounts your rooms hold |
| `switch <account>` | Choose the account the bot works with (`all` = every account) |
| `progress` | Your recorded progress per quest |
| `status <quest> [account]` | Status of one quest for your account |
| `refresh` | Refresh the quest catalogue from the source |
| `history` | Your recent quest activity |
| `panel [account]` | **Main interactive interface** - banner image, reward, progress bar, full Quest dropdown with pagination, action buttons |
| `access` | Connect/manage your own account via OAuth2; disconnect button |
| `select <quest>` | Open the panel for a specific quest |
| `search <name>` | Search the quests by name |
| `categories` | Platforms/games present in the catalogue |

### `/account`

| Subcommand | Purpose |
| --- | --- |
| `link` | Link your Discord account via the official OAuth2 flow |
| `status` | Show whether an account is linked and still valid |
| `unlink` | Delete the linked account, its tokens, your rooms, progress and history |
| `privacy` | Show the privacy notice |

### `/task`

| Subcommand | Purpose |
| --- | --- |
| `list` | Every task type Discord uses |
| `info <task>` | What one task type requires |
| `progress` | Recorded progress grouped by task type |
| `verify <quest>` | Validate the recorded progress against Discord's response |

### `/reward`

| Subcommand | Purpose |
| --- | --- |
| `list` | Rewards recorded for your account |
| `info <quest>` | Reward name, type, requirements |
| `status <quest>` | Eligibility and claim status |
| `claim <quest>` | Start the official claim flow (human captcha when Discord asks) |
| `code <quest>` | Fetch a claimed reward code |

### Room prefix commands (owner only)

| Prefix command | Purpose |
| --- | --- |
| `!room create <name> [description]` | Create a room |
| `!room search <name>` | Find a room |
| `!room list` | List rooms |
| `!room add <room> <token>` | Add a user token to a room |
| `!room remove <room> <slot>` | Remove an account |
| `!room delete <room>` | Delete a room and its accounts |
| `!room renew <room>` | Reset the 30 day timer |

### Token prefix commands (owner only)

| Prefix command | Purpose |
| --- | --- |
| `!token list [type]` | Every stored token, masked (bot or user) |
| `!token add <label> <token> <type>` | Register a bot or user token |
| `!token import [label]` | Register USER_TOKEN as an account |
| `!token remove <id>` | Delete a stored token |
| `!token check <id>` | Validate a token against Discord |

### Admin prefix commands (owner only)

| Prefix command | Purpose |
| --- | --- |
| `!admin setup` | Setup status + re-register slash commands |
| `!admin stats` | Usage statistics |
| `!admin users` | Known users |
| `!admin logs` | Admin audit log |
| `!admin reload` | Reload catalogue/config |
| `!admin backup` | Create a database backup |
| `!admin restore <file>` | Restore a backup |
| `!admin maintenance` | Toggle maintenance mode |
| `!admin config <key> <value>` | Read/write configuration values |
| `!admin purge <user>` | Delete every piece of data of a user |
| `!whitelist list` | The whitelisted servers and users |
| `!whitelist add <guild|user> <id> [member|admin]` | Allow a server or a user |
| `!whitelist remove <guild|user> <id>` | Remove it |
| `!whitelist enable` / `!whitelist disable` | Turn the restriction on or off |
| `!whitelist sync` | Add every server the bot is in to the whitelist |
| `!quest auto <quest>` | Complete one quest with the operator accounts |
| `!quest all [stop]` | Complete every quest with the operator accounts |

## 7. The quest panel UI

`/quest panel` produces the main interface:

1. **Embed** — title `QUEST COMPLETER`, quest banner image (from the
   catalogue's CDN path — verified `HTTP 200`), reward, task types, your
   account, the required task, progress bar, eligible/enrolled status.
2. **Quest Selection dropdown** below the embed — lists every quest the
   scope can see (catalogue snapshot by default), shows reward + the number
   of Orbs, and switches the embed on selection. The selected quest is
   carried in the component custom id for the page navigation.
3. **Action buttons** — View Quest (official game URL from the catalogue),
   Details, Progress, Refresh, Help.
4. **Show more than 25 quests** — the menu lists only the first 25 and page
   buttons (`Previous`/`Next`) appear when more quests exist.

Selection is scoped per user, and it is ephemeral — nobody else can see it.

---

## 8. Quest engine (preserved from the original)

`src/quest.ts` and `src/interface.ts` are kept byte-identical to the
original selfbot to preserve the parsing pipeline:

- `task_config` and `task_config_v2` are merged
- task types are resolved through `QuestTaskType` (`WATCH_VIDEO`,
  `PLAY_ON_DESKTOP`, ...)
- `isRunnable` filters expired/completed/incompatible quests
- `applyConfig` / `mergeTasks` produce the normalized quest shape

Adapter `bot/services/questAdapter.ts` maps the engine's Quest to the bot's
`QuestView`/`QuestDetail`. Live responses (from a user token) are handled
the same way.

---

## 9. Where quest data comes from

In priority order:

1. **Live response** from the linked user account (`/quests/@me`) — if the
   account is linked and the token is valid.
2. **Linked account** — OAuth2 `identify` scope only. Quest endpoints are
   user-session-only, so OAuth2 cannot read the live quest data (Discord
   returns `401` for bot tokens on those endpoints).
3. **Catalogue snapshot** — `quest.json` (41 quests as of Nov 2026). Works
   offline, always.

---

## 10. Notification service

`bot/services/notificationService.ts` runs on an interval
(`NOTIFICATION_INTERVAL_MINUTES`, default 15). It pushes Discord DMs to the
user when:

- a new quest appears (if they opted in),
- a quest's progress changes,
- a quest completes,
- a reward becomes claimable.

It also runs the room-expiry sweep hourly: rooms older than 30 days are
deleted, their owners get a DM before the deletion, and `/room renew` keeps
a room alive.

---

## 11. Deeper details for integrators

### Command registration

`bot/commands/registry.ts` registers the command groups with
`Routes.applicationGuildCommands` (when `GUILD_ID` is set) or
`Routes.applicationCommands` (global). Registration happens on startup;
`!admin setup` re-registers.

### Component interactions

`bot/commands/interactions.ts` routes `MessageComponent` interactions. The
main paths used by the panel:

- `quest:panel_select:<page>:<account>` — switch the quest
- `quest:panel_prev:<page>:<account>:<questId>` / `quest:panel_next:...` — page through the dropdown
- `quest:panel_refresh:<questId>:<account>` — refresh embed
- `quest:panel_details:<questId>:<account>` — quest detail embed
- `quest:panel_progress:<questId>:<account>` — progress embed
- `quest:panel_help:<questId>:<account>` — why a quest may be unavailable
- `quest:access:disconnect` / `quest:access:confirm` / `quest:access:cancel`

Every one of them resolves the scope from `interaction.user.id` — never
from the interaction payload.

### The webhook

`WEBHOOK_URL` is for the developer's own guild. When set, the bot posts:
room created / account added / account removed — room name, account name
and event type. The token is never sent. Only `discord.com` hosts are
accepted. The webhook is not configurable by end users.

### Tests

```bash
npm run test       # node:test suite (101 tests)
npm run typecheck  # tsc --noEmit
npm run build      # compile to dist/
```

Advice: the test suite is designed to catch regressions in the scope, the
token vault, the migrations and the UI. Do not remove it.

---

## 12. What the bot intentionally does NOT do

- No CAPTCHA solving or bypass.
- No enrolment in a quest on behalf of a user; the user enrols in the
  Discord client themselves.
- No extraction of a user's password or anything beyond the `identify` OAuth2 scope.
- No brute force, no rate-limit bypass, no token cracking.
- No access to messages of users other than the one who ran the command.
- No access to data in another user's room or account.
- No warranty or liability for misuse. See `docs/PROTOCOL.md` and the
  terms of service of Discord.
