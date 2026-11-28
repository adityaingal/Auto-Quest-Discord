# Upgrade Plan — Quest Completer v2.2

Written before any edit. Scope: automatic new-quest announcements with media,
mandatory guild membership for DM usage, and full integration with the
existing database/webhook architecture.

## 1. Inspection result (what already exists)

- Language/runtime: TypeScript on Node >= 22.5, `node:sqlite` (DatabaseSync),
  discord.js v14.28. Build: `tsc`; tests: `node:test` via `tsx`.
- Entry point: `bot/index.ts` — global slash commands, owner `!` prefix
  commands, three guarded timers (notifications, public quest notifier,
  auto-pilot), graceful SIGINT/SIGTERM shutdown.
- Quest data source: `quest.json` (catalogue snapshot, 41 quests), read by
  `CatalogProvider` and parsed by the byte-preserved `src/quest.ts` engine.
  There is **no public Discord quest API** available to a bot account.
- Existing new-quest detection: `PublicQuestNotifier` scans the catalogue on
  a timer, seeds a baseline on first ever run, records ids in migration v9
  `quest_announcements` (`quest_id` PRIMARY KEY), posts an embed, stores the
  message/channel id. 429 errors stay `pending` and retry. Already tested.
- Media: `QuestView.imageUrl` is derived from `config.assets.hero`; real
  `hero_video`, `video_metadata.assets.video_player_video` and thumbnails
  exist in the catalogue but are not exposed or rendered yet.
- Database: single SQLite file, migrations v1–v9, `Repositories` with
  parameterized queries and transactions. `Database.backup()` uses
  `VACUUM INTO` into `data/backups/`; `AdminService.backup()/restore()` are
  manual owner commands.
- Webhook: `WEBHOOK_URL` + hardened `parseWebhookUrl()` +
  `DiscordWebhook.send()` are used only to mirror room events. **There is no
  webhook database backup system today.**
- DMs: slash commands are registered globally, so they work in DMs;
  `messageCreate` handles owner prefix commands. No membership gate exists.
- Config: environment + `.env` via `loadConfig()`; documented in
  `.env.example`, `scripts/check-env.ts`, `docs/PROGRAM-INFO.md`.

## 2. Conflicts and the safe compatible solution

1. **"Existing webhook backup system" does not exist.** Do not invent an
   unrelated store: extend the existing `WEBHOOK_URL`, `DiscordWebhook`,
   `Database.backup()` and `AdminService.backup()/restore()` path with a
   `WebhookBackupService`. Because `VACUUM INTO` copies the *whole* database,
   all new tables are backed up automatically with no extra backup pipeline.
2. **Guild member add/remove events need the privileged Server Members
   intent.** Turning it on unconditionally can make `client.login()` fail for
   installations that did not enable it in the Developer Portal. Solution:
   authoritative REST verification (`Routes.guildMember`) on every DM command
   + periodic reconciliation, with gateway events enabled only through an
   explicit opt-in flag. Deny when verification is uncertain.
3. **No public quest API** — detection stays a periodic catalogue scan; new
   ids are discovered from real quest data only. No fabricated fields.
4. **History must never reset** — keep v1–v9 byte-identical, add one v10
   migration with `IF NOT EXISTS` / additive columns only. No deletes of
   `quest_announcements`; no clearing on config change or restore.

## 3. Changes

### Database (migration v10, additive only)
- `quest_metadata`: quest_id PK, name, description, image_url, video_url,
  thumbnail_url, rewards (JSON), official_url, availability, expires_at,
  first_detected_at, last_updated_at.
- `quest_announcements` additive columns: `announced_at`, `reconcile_nonce`,
  `attempts`, `last_error`. Existing rows keep their data/status.
- `guild_membership`: (discord_user_id, guild_id) PK, last_verified_at,
  is_member, joined_at, left_at.
- `webhook_backup_state`: singleton row with last hash, size, path, message
  id, last success/attempt, last error (never a webhook URL).

### Quest announcements + media (`PublicQuestNotifier`)
- Optional `enabled` and `intervalMinutes` from config; single guarded timer
  (no duplicate loop), immediate scan after startup.
- Persist metadata for every seen quest; keep the v9 row as the dedupe.
- Before sending, store a random nonce on the pending row; include it in the
  embed footer. After a successful send store message id + `announced_at`.
  If that write fails, reconcile by scanning recent channel messages for the
  nonce; on the next scan pending rows are reconciled before being resent.
- Media: validated https-only image/thumbnail/banner/video URLs. Missing or
  invalid media is omitted; the announcement still posts. Video is a link
  button/field (never an illegal Discord video embed). Footer:
  `Quest Completer | Automatic Quest Monitor`.

### Membership (`MembershipService`)
- Config: `MEMBERSHIP_VERIFICATION_ENABLED`, `REQUIRED_GUILD_ID`,
  `REQUIRED_GUILD_INVITE`, `MEMBERSHIP_VERIFY_INTERVAL_MINUTES`,
  `MEMBERSHIP_MEMBER_EVENTS`.
- DM interactions (slash commands, components, modals, autocomplete) and DM
  prefix commands call `verify()` before execution. Guild commands are
  untouched by default.
- `verify()` uses `client.rest.get(Routes.guildMember(...))`: 200 = member,
  404 = not a member, anything else (403/429/5xx/network/unavailable guild)
  = unverified → deny. A verified cache short-circuits only while fresh;
  uncertain results never grant access.
- Join/remove listeners (opt-in intent) update membership rows; a periodic
  reconciliation verifies known users and DMs once on a true→false change.
  Closed DMs and API errors are logged without crashing.
- Denial reply: membership-required embed + official invite (link button when
  the invite is a validated https URL, otherwise plain text).

### Webhook backup (`WebhookBackupService`)
- Reuses `WEBHOOK_URL` (validated by `parseWebhookUrl`) and `AdminService.backup()`.
- Timer (default 60 min, configurable), one guarded run at a time.
- Creates a real SQLite snapshot, verifies header/size/hash, uploads the
  `.sqlite` file as a Discord webhook attachment with a metadata embed.
  Hash change detection: identical content is not re-uploaded.
- A run is successful only after the upload response is confirmed; failures
  leave the previous successful state untouched. Webhook URL is never logged.
- `restoreFromWebhook()` (admin only, controlled): download the recorded
  verified attachment from Discord's CDN, verify the SHA-256, check integrity
  and refuse to replace a newer local database. Existing manual
  `!admin restore <file>` remains unchanged.

### Wiring, config, docs
- `bot/services/index.ts` constructs the new services; `bot/index.ts` adds
  the DM gate, member events, backup timer and shutdown handling.
- New env vars documented in `.env.example`, `scripts/check-env.ts`,
  `docs/PROGRAM-INFO.md`; optional Render entries added (no existing value
  changes).
- No new npm dependencies (Node built-ins + existing discord.js).

## 4. Verification plan
1. `npm run check-env`, `npm run typecheck`, `npm test`, `npm run build`.
2. New tests: migration v10 + upgrade from v9; announcement once across a
   simulated restart; Quest A/Quest B sequencing; media permutations and
   invalid URLs; membership 200/404/403/429/timeout/unavailable guild,
   join/leave/rejoin and closed DMs; backup hash change/failure/integrity/
   rollback protection; config parsing.
3. Confirm the existing 147 tests still pass and `src/quest.ts` /
   `src/interface.ts` remain byte-identical.
4. Report actual commands and results — no claimed passes.
