# Migration report: selfbot quest completer -> slash command bot

The repository was converted in place. The legacy quest engine was kept and is
now used through an adapter; the selfbot specific parts were removed because
the target specification forbids them.

## Feature inventory of the previous version

| # | Legacy feature | File | Classification | Where it lives now |
| --- | --- | --- | --- | --- |
| 1 | Quest configuration parsing (`task_config`) | `src/interface.ts` | **Preserve** | `src/interface.ts` (unchanged semantics) |
| 2 | Quest configuration parsing (`task_config_v2`) | `src/quest.ts` | **Preserve** | `src/quest.ts` - `resolveTask()`, `taskList`, `availableTaskTypes` |
| 3 | Task type resolution + progress reading | `src/quest.ts` | **Preserve** | `src/quest.ts` -> `bot/services/questAdapter.ts` -> `bot/models/quest.ts` |
| 4 | Reward parsing (type, orbs, redemption instructions) | `src/interface.ts` | **Preserve** | `bot/services/questAdapter.ts` (`buildRewards`) |
| 5 | Application metadata | `src/interface.ts` | **Preserve** | `QuestView.applicationId / applicationName` |
| 6 | Platform handling | `src/questManager.ts` | **Preserve** | `bot/models/enums.ts` (`QuestPlatformType`) |
| 7 | Content type / location handling | `src/questManager.ts` | **Preserve** | `bot/models/enums.ts` (`QuestContentType`) |
| 8 | Quest catalogue snapshot | `quest.json` | **Preserve** | `quest.json` -> `bot/integrations/catalogProvider.ts` |
| 9 | Quest listing / filtering | `src/questManager.ts` | **Modify** | `bot/services/questService.ts` (list/info/status/refresh) |
| 10 | Progress tracking | `src/questManager.ts` | **Modify** | `bot/services/progressService.ts` + `quest_progress` table |
| 11 | Reward claiming | `src/questManager.ts` | **Modify** | `bot/services/rewardService.ts` -> official endpoint, human captcha |
| 12 | Reward code retrieval | (new) | **Add** | `GET /quests/{id}/reward-code` via the linked account |
| 13 | Multi account support | `src/accounts.ts` | **Replace** | one Discord user = one bot user; accounts are linked through OAuth2 |
| 14 | Notification system | `src/notifier.ts` | **Modify** | `bot/services/notificationService.ts` (embeds, per user settings) |
| 15 | Bot control panel (prefix commands) | `src/botController.ts` | **Replace** | slash commands only (`bot/commands/*`) |
| 16 | CLI dashboard (`figlet`, tables) | `bot.ts` | **Replace** | Discord embeds (`bot/ui/embeds.ts`) |
| 17 | Desktop client impersonation (UA, `x-super-properties`, Identify patch) | `src/constants.ts`, `src/client.ts` | **Remove** | forbidden by the specification - a bot connects with the official gateway |
| 18 | User token usage (selfbot) | `src/client.ts` | **Remove** | official OAuth2 linking only (`bot/integrations/oauth2.ts`) |
| 19 | `enroll` / `heartbeat` / `video-progress` (progress spoofing) | `src/questManager.ts` | **Remove** | user-session only actions - the bot reports progress instead of forging it |
| 20 | hCaptcha solving (2captcha / anti-captcha) | `src/captcha.ts` | **Remove** | captchas are solved by the human in the Discord client |
| 21 | Browser console snippet | `code.js` | **Remove** | selfbot helper, not part of the bot |
| 22 | CLI token/quest helpers | `scripts/check-token.ts`, `scripts/list-quests.ts` | **Replace** | `/account status`, `/quest list` |
| 23 | Error handling | ad-hoc | **Modify** | `bot/utils/errors.ts` (centralised, every error has a user message) |
| 24 | Logging | `console.log` | **Modify** | `bot/utils/logger.ts` (levels, redaction) |
| 25 | Persistence | none (in memory) | **Add** | SQLite with migrations (`bot/database/`) |
| 26 | Health endpoint | none | **Add** | `/health` (`bot/httpServer.ts`) |
| 27 | Graceful shutdown | none | **Add** | `bot/index.ts` (SIGINT/SIGTERM) |

## Why the removals are necessary

The target specification states:

> "The bot must use slash commands exclusively. No prefix commands. No
> message-content command parsing. No self-bot functionality. No user-token
> collection."

and

> "Do not implement user-token extraction, desktop-client impersonation,
> CAPTCHA automation or private API protection bypasses."

Features 17-21 depend on exactly those techniques, so they cannot be carried
over. Everything that only *reads* quest configuration (features 1-8) was kept
and is now the single source of truth for the whole bot - no command duplicates
the parsing logic.

## What "unsupported" means for the user

Discord's quest endpoints (`/quests/@me`, `/quests/{id}/heartbeat`,
`/quests/{id}/claim-reward`, ...) are **user session** endpoints. They are not
part of the public bot API and Discord answers bot credentials with `401`.

The bot therefore has two quest sources:

1. **Catalogue** (always available) - the bundled `quest.json` snapshot with
   every quest, task and reward configuration.
2. **Linked account** (best effort) - the OAuth2 token of a linked account is
   used against the same endpoints. Discord currently rejects that with
   `401`, and the bot reports the integration as *unavailable* instead of
   pretending that it works.

Commands that would require a user session (`/quest start`, `/reward claim`)
explain the situation and route the user to the official Discord client, where
the enrolment and the claim - including the human captcha verification - happen.

## Data model changes

The old version had no persistence. The new database adds:

`users`, `account_links`, `quest_records`, `quest_progress`, `quest_history`,
`reward_records`, `notification_settings`, `guild_settings`, `admin_logs`,
`bot_config`, `oauth_states`, `schema_migrations`.

Migrations are versioned and applied in order, so an existing database is
upgraded in place. `schema_migrations` records what has been applied and
`/admin restore` can roll the data back to a backup file.

## Credential handling

* Only OAuth2 tokens (scope `identify`) are stored, encrypted with AES-256-GCM.
* The encryption key comes from `ENCRYPTION_KEY` (fallback: the client secret).
* Raw user tokens are never requested, stored or logged.
* Authorization headers are never written to the log.
* OAuth2 state values are single use and bound to the Discord user that started
  the flow, so a redirect link cannot be used by somebody else.
