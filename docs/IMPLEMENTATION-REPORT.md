# Implementation Report — Discord Quest Completer v2.1

Parts 1–11 of the repair & extension task. The plan this report follows is
`docs/REPAIR-PLAN.md` (written before any edit).

## Verification (all green)

| Gate | Command | Result |
| --- | --- | --- |
| Env check | `npm run check-env` | exit 0, `config loads OK` (shows the new optional var) |
| Types | `npm run typecheck` | exit 0 |
| Tests | `npm test` | **135/135 pass, 0 fail** (baseline was 112) |
| Build | `npm run build` | exit 0 (`dist/` emitted) |
| Read-only files | `git diff -- src/quest.ts src/interface.ts` | **no diff — byte-identical** |

## Part 1 — Root causes found & fixed

| # | Root cause | Fix |
|---|-----------|-----|
| 1 | `resolveEligibility()` mapped expired → `UNAVAILABLE`; the enum had no `EXPIRED` member, so users could never tell *why* a quest was unavailable | Added `QuestEligibility.EXPIRED` + label/emoji (`🔴`)/color (danger)/status text; mapping order: **Completed** (authoritative `completed_at` wins even past expiry) → **Expired** → In progress → Enrolled → Available |
| 2 | `rewardService.buildStatus()` compared `eligibility === 'completed'` (string literal instead of the enum) | Compares `QuestEligibility.COMPLETED` |
| 3 | `CatalogProvider` cached `quest.json` forever — `!admin reload` and refresh could never pick up a newer file (stale catalogue) | Added `CatalogProvider.reload()`; called from `questService.refresh()`, from the public-panel Refresh button and from every notifier scan (guarded, falls back to the cache on a broken file) |
| 4 | Two write paths for `quest_progress`: `questService.recordProgress()` duplicated `ProgressService.record()` but skipped history logging | `QuestService` now takes the injected `ProgressService`; `recordProgress()` delegates — one writer, history included. Construction order in `createServices` changed accordingly |
| 5 | `QuestService.list()` called the live source unguarded — one thrown error skipped the whole catalogue fallback | Wrapped in try/catch with a warn log → falls back to linked/catalogue as before |
| 6 | Refresh persisted only the *default* account's view (multi-account refresh lost quests) | `refresh()` aggregates `listAllLiveQuests()` across **every** account of the scope, deduped by quest id, source lists all answering accounts; falls back to `list()` when nothing answered |
| 7 | `status()` only back-filled numbers, never the completed state — a temporarily empty live response dropped a completed quest back to "available" | When the stored row (written earlier from a Discord response) says completed/`completed_at` and the live view doesn't, eligibility **and** the stored progress are promoted. No value is invented — only persisted Discord data is reused |
| 8 | Expired-quest handling in automation | Verified correct (`isRunnable`/`runWithSession` already skip expired) — no change |
| 9 | No retry story for new features | Notifier keeps rows `pending` on failure (incl. HTTP 429) and retries next scan; every timer/interaction is guarded so errors never crash the bot |

`start()` also refuses an `EXPIRED` quest with a dedicated message.

## Parts 2–5 — New features

- **`bot/services/publicQuestNotifier.ts`** (new) — periodic scan of the
  authoritative catalogue: reloads the snapshot, seeds a **baseline** on the
  very first run (fresh installs don't flood the channel), records every later
  discovery as `pending`, posts the announcement embed, marks it `announced`
  with message+channel id. The **database row is the dedupe** → restarts never
  repost. 429/permission errors keep the row pending and defer the rest of the
  batch. Injectable `sender` for tests. Publishes catalogue data only — never
  tokens, accounts, user ids or private progress.
- **Announcement embed** (`questAnnouncementEmbed`) — banner image, name,
  promo text (game/publisher/description), reward, task requirements, platform,
  expiration (UTC + relative), availability, official URL in the embed title.
  Buttons: **View Quest** (link — only when the catalogue published a verified
  `https://` URL; `verifiedQuestUrl()` rejects http/javascript/garbage),
  **Available Quests**, **Refresh**.
- **Public "Available Quests" browser** — `/quest available` (non-ephemeral)
  + `quest:pub_*` routes: Previous / Next / page-info / Refresh / Quest
  Details / select menu / official-link button, detail view with a way back.
  25 entries per page (`publicQuestPages`), works past 25 and past 100.
  Statuses: Available / Enrolled / In Progress / Completed / Expired /
  Unavailable. Reads `CatalogProvider` only — **no scope is ever resolved in
  these handlers** (asserted by a test), so private progress can't leak.
- **"Check All Quest Progress"** — `/quest check` + `quest:check_all` button.
  Scope comes from `interaction.user.id` / the command context; refreshes every
  account of that scope via `listAllLiveQuests`, records verified progress
  through `ProgressService`, recalculates % from API values, detects
  completed/claimable, and replies with an ephemeral summary embed
  (Total / Available / In Progress / Completed / Expired / Claimable).
  **Never claims anything.**

## Part 6 — Migration

New **v9 `quest_announcements`** only (v1–v8 untouched — asserted by a test):
`quest_id` PK, `first_discovered_at`, `last_detected_at`,
`announcement_status` (`baseline|pending|announced`), `message_id`,
`channel_id`, `updated_at`; indexes on status and last-detected. All
`IF NOT EXISTS` → safe and idempotent on existing installs (tested by
simulating a database that stopped at v8). Repository methods:
`recordAnnouncementSeen`, `getAnnouncement`, `listAnnouncements`,
`countAnnouncements`, `markAnnouncementAnnounced`.

## Part 7 — Config

- **New optional env var `PUBLIC_QUEST_CHANNEL_ID`** — public new-quest
  announcement channel. Documented in `.env.example`, listed in
  `scripts/check-env.ts` OPTIONAL, added to `docs/PROGRAM-INFO.md`.
  Unset → quests are tracked but never posted.
- **No existing env var changed meaning** — `NOTIFY_CHANNEL_ID` still drives
  status messages; the scan timer reuses `NOTIFICATION_INTERVAL_MINUTES`.

## Part 8 — Security

Preserved and verified: `AccountScope`/`scopeFor(interaction.user.id)`,
whitelist on every interaction type in `bot/index.ts`, AES-256-GCM vault with
no default key, OAuth2 ownership, component ownership checks. No token is
displayed, logged or sent anywhere; public surfaces (notifier, public panel)
touch catalogue data only; the check-all reply is ephemeral. Every new
component handler resolves scope from `interaction.user.id` — and the public
handlers resolve **no** scope at all (test-asserted). `src/quest.ts` and
`src/interface.ts` are byte-identical.

## Part 9 — Quality

Reused `CatalogProvider`, `questAdapter`, `ProgressService`, `ui/embeds.ts`,
`ui/panel.ts`, `InteractionRouter` prefix routing, `Repositories`, `Logger`.
No duplicated service. Non-sensitive logs only (counts, quest ids/names,
HTTP status). All timers and handlers are guarded — no new crash path.
Also updated the stale migration table in `docs/PROGRAM-INFO.md` (was v7,
now lists v8 + v9).

## Part 10 — Tests

New `tests/publicQuest.test.ts` (23 tests): migration v9 shape + older
migrations untouched; expired/completed/enrolled/in-progress/available
mapping; enum-based reward status; announcement embed content + no private
data; verified-URL button rule; baseline seeding; announce-exactly-once
(incl. simulated restart); 429 → pending → retry; channel-unset tracking
without posting; pagination >25 with clamping; availability/expired labels;
public routing without scope resolution; unauthorized owner-panel denial;
check-all summary + scope isolation + completion sync; live account refresh
persisting progress; stored completion restored; history written by the
delegated progress path; refresh reloading the file + hook; multi-account
refresh aggregation; throwing live source falling back.

Updated: `tests/database.test.ts` (v9 table + upgrade-from-v8 test),
`tests/services.test.ts` (new `available`/`check` subcommands, injected
`ProgressService`, enum-based reward assertion).

**Results: `npm run check-env` ✅ · `npm run typecheck` ✅ ·
`npm test` 135/135 ✅ · `npm run build` ✅**

## Part 11 — Deployment (Render) & Discord limits

### Render deployment

1. Set the new env var in the Render service (or leave it unset):
   `PUBLIC_QUEST_CHANNEL_ID=<channel id>` — invite the bot to that channel
   with **View Channel + Send Messages + Embed Links**.
   (`!admin` docs / `.env.example` show the format.)
2. No other config change is required. `NODE_ENV` must stay unset (the
   TypeScript build needs dev dependencies).
3. On first start migration v9 runs automatically (idempotent); existing data
   is untouched.
4. The first scan seeds the baseline (no announcements for the existing
   catalogue). Announcements begin with the first *new* quest after that.
5. The persistent disk/database file carries `quest_announcements`, so
   restarts and deploys never repost.

### Discord API limitations encountered

- **25 items** max per select menu → the public browser pages at 25.
- **4000 chars** per embed description and **25 fields** per embed → the
  list/detail/announcement embeds stay inside both (long text is sliced).
- **6 embeds / 10 components rows** per message → announcements use 1 embed
  + 1 row.
- **Rate limits (429)** on message sends → announcements stay `pending` and
  are retried on the next scan instead of being dropped or retried in a loop.
- **No Discord API for "quest catalogue changed"** → detection is a periodic
  local scan of the authoritative snapshot (`quest.json`), re-read each scan.
- Button/link components require absolute `https://` URLs → unverified links
  are never rendered.
- Interaction responses must be deferred within 3 seconds → check-all defers
  before the refresh runs.

## Files

**Created:** `bot/services/publicQuestNotifier.ts`, `tests/publicQuest.test.ts`,
`docs/REPAIR-PLAN.md`, `docs/IMPLEMENTATION-REPORT.md`.

**Modified:** `bot/models/enums.ts`, `bot/ui/theme.ts`, `bot/ui/embeds.ts`,
`bot/ui/panel.ts`, `bot/ui/components.ts`, `bot/services/questAdapter.ts`,
`bot/services/questService.ts`, `bot/services/rewardService.ts`,
`bot/services/index.ts`, `bot/integrations/catalogProvider.ts`,
`bot/database/index.ts`, `bot/database/repositories.ts`, `bot/config.ts`,
`bot/commands/quest.ts`, `bot/commands/interactions.ts`, `bot/index.ts`,
`.env.example`, `scripts/check-env.ts`, `docs/PROGRAM-INFO.md`,
`tests/database.test.ts`, `tests/services.test.ts`.

**Untouched:** `src/quest.ts`, `src/interface.ts` (byte-identical),
migrations v1–v8, all existing env var meanings.
