# Repair & Extension Plan — Discord Quest Completer v2.1

> Written before any code change. Inspection baseline: `npm run check-env`,
> `npm run typecheck` and `npm test` (112 tests) all green; repo untouched.

## Part 1 — Root causes found during inspection

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | Expired quests show as "Unavailable", no distinct Expired state | `questAdapter.resolveEligibility()` maps `isExpired()` → `QuestEligibility.UNAVAILABLE`; the enum has no `EXPIRED` member | Add `QuestEligibility.EXPIRED`, map expired → `EXPIRED` (unless already completed), add label/emoji/color/status text |
| 2 | Completed status never detected in reward status | `rewardService.buildStatus()` compares `quest.eligibility === 'completed'` (string) — works by luck of enum value, but breaks for any other member and bypasses the enum | Compare against `QuestEligibility.COMPLETED` |
| 3 | `!admin reload` / `/quest refresh` cannot fix a stale catalogue | `CatalogProvider.load()` caches `this.quests` forever; no invalidation path | Add `CatalogProvider.reload()` and call it from `QuestService.refresh()` |
| 4 | Duplicate/inconsistent progress records | `questService.recordProgress()` re-implements `progressService.record()` but skips history logging — two write paths for one table | Inject `ProgressService` into `QuestService`; `recordProgress()` delegates (single write path, history included) |
| 5 | Live fetch failure aborts the whole list instead of falling back | `QuestService.list()` calls `autoService.listLiveQuests()` without a guard; a thrown error skips the catalogue fallback | Wrap in try/catch → fall back to linked/catalogue (`isFallbackError` path) |
| 6 | Multi-account refresh only ever persists one account's view | `QuestService.refresh()` delegates to `list(scope)` which reads a single (default) account | Refresh aggregates `listAllLiveQuests()` across **every** account of the scope (deduped by quest id), falling back to `list()` |
| 7 | Completion lost when live data temporarily has no progress | `QuestService.status()` only back-fills numbers from stored progress, never the completed state recorded from Discord | When stored progress says completed/claimed and the live view does not, promote eligibility from the stored (Discord-sourced) row |
| 8 | Expired-quest handling in automation | `AutoService.isRunnable()`/`runWithSession()` already skip expired quests — verified correct, no change | — |
| 9 | No retry/error handling for new features | (feature gap) | Notifier keeps rows `pending` on failure (incl. 429 rate limits) and retries on the next scan; every timer/interaction is guarded so errors never crash the bot |

## Parts 2–5 — New features

- **`bot/services/publicQuestNotifier.ts`** — scans the authoritative catalogue
  (`CatalogProvider`), dedupes through the new `quest_announcements` table
  (survives restarts), posts one announcement embed per genuinely new quest to
  the configured public channel. First-ever scan seeds a baseline (no spam);
  later discoveries are announced exactly once. Rate-limit/permission errors
  keep the row `pending` for retry. Only catalogue data is published.
- **Announcement embed** (`questAnnouncementEmbed` in `ui/embeds.ts`) — banner,
  name, promo text, reward, task requirements, platform, expiration,
  availability, official URL; buttons **View Quest** (link, only for a verified
  `https://` URL from the catalogue config), **Available Quests**, **Refresh**.
- **Public "Available Quests" panel** — `/quest available` + `quest:pub_*`
  component routes: Previous / Next / page info / Refresh / Quest Details /
  select menu / View Official Quest link; 25 entries per page (Discord limit),
  status labels Available/Enrolled/In Progress/Completed/Expired/Unavailable;
  reads the catalogue only — private progress never leaves its scope.
- **"Check All Quest Progress"** — `/quest check` + `quest:check_all` button:
  scope resolved from `interaction.user.id`, refreshes every account of that
  scope from the authenticated user sessions (`listAllLiveQuests`), records
  verified progress through `ProgressService`, recalculates % from API values,
  detects completed/claimable, replies with a summary embed
  (Total/Available/In Progress/Completed/Expired). Never claims anything.

## Part 6 — Migration (new version only)

- **v9 `quest_announcements`** (existing migrations untouched): quest id PK,
  `first_discovered_at`, `last_detected_at`, `announcement_status`,
  `message_id`, `channel_id`, `updated_at`; indexes on status and last
  detected. `IF NOT EXISTS` everywhere → safe on existing installs.
- Repository methods: upsert-seen / list-pending / mark-announced / counts.

## Part 7 — Config

- New optional env var **`PUBLIC_QUEST_CHANNEL_ID`** (public new-quest
  announcements). `NOTIFY_CHANNEL_ID` and every other existing variable keep
  their meaning. Documented in `.env.example` and added to
  `scripts/check-env.ts` OPTIONAL list before any deployment change.

## Part 8 — Security invariants (verified, preserved)

- Scope always built from `interaction.user.id` (`services.scopeFor`).
- Whitelist check runs for every interaction type in `bot/index.ts`.
- AES-256-GCM vault, no default key; tokens never rendered/logged/sent.
- Public surfaces (notifier, public panel) touch catalogue data only.
- `src/quest.ts` and `src/interface.ts` remain byte-identical.

## Part 9 — Quality

- Reuse: `CatalogProvider`, `questAdapter`, `ProgressService`,
  `ui/embeds.ts`, `ui/panel.ts`, `InteractionRouter` prefix routing,
  `Repositories`, `Logger`. No new parallel service for existing jobs.

## Part 10 — Tests

- New `tests/publicQuest.test.ts`: detection, dedupe, restart recovery,
  rate-limit retry, expired/availability mapping, pagination >25, public panel
  routing, scope isolation, check-all summary, completion sync, migration v9.
- Extend `tests/database.test.ts` (v9 table) and `tests/services.test.ts`
  (new subcommands). Then run `check-env`, `typecheck`, `test`, `build`.

## Part 11 — Deliverables

- Final report: root causes, files touched, migration, features, config,
  test results, Render deployment steps, Discord API limits.
