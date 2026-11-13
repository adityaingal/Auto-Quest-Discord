# Auto Quest Discord — Technical Protocol Spec

> **Note (2.0 rewrite):** this document describes the Discord quest protocol.
> The bot no longer *acts* as a user - the impersonation, the user-token flow
> and the captcha automation described in §2, §3.4, §3.5 and §4 are **not
> implemented any more** (see [`MIGRATION.md`](MIGRATION.md)). The bot only
> *reads* quest configuration through the catalogue or a linked OAuth2 account
> and reports what Discord returns.

Complete description of how this program talks to Discord, so another bot (or an
LLM) can reimplement it. Everything marked **[verified]** was confirmed against the
live API; everything marked **[docs]** comes from <https://docs.discord.food/resources/quests>.

---

## 0. What this is (and what it cannot do)

A headless client that automatically completes **Discord Quests** (the sponsored
"Missions" in the Quest Home) for a **user account**, then claims the reward.

| Fact | Detail |
| --- | --- |
| Quests are a **user** feature | `GET /quests/@me` → `401` for bot tokens **[verified]** |
| Rewards belong to the user | Orbs / decorations are granted to the authenticated user, not to a bot |
| Bot accounts can still help | reporting, and triggering the user-token workers (see §9) |
| Protocol surface | 4 REST endpoints + 1 gateway connection |

---

## 1. Authentication

### 1.1 Token type

The program uses a **Discord user token** (a.k.a. selfbot token):

```
<base64(user_id)>.<base64(timestamp)>.<base64(hmac)>
```

Obtained from the browser while logged in:
`discord.com/app` → F12 → Network → any `discord.com/api/.../users/@me` request →
Request Headers → `authorization` → copy the value (strip any `Bot ` prefix).

A **bot token** from the Developer Portal will **not** work for quests.

### 1.2 Token lifecycle (critical)

* Changing the Discord password invalidates **every** existing token.
* Opening a **new gateway session with the same token invalidates the old token**.
  → Two program instances on the same token kill each other.
  → One token per account, never two slots with the same token.
* Tokens are rejected with `401 {"message": "401: Unauthorized", "code": 0}`.

### 1.3 Auth header

User tokens must be sent **without** a `Bot ` prefix:

```
Authorization: <raw user token>
```

`@discordjs/rest` normally sends `Bot <token>`; the program strips the prefix in a
custom `makeRequest` hook (see §2.3).

---

## 2. Client fingerprint (required for the server to accept the calls)

### 2.1 User-Agent **[verified]**

```
Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36
```

The `Electron/<version>` part is **mandatory** for heartbeats:

> "Heartbeated quest tasks may only be completed from desktop clients. If the
> requesting user-agent does not include electron version info (e.g. `Electron/28.2.10`),
> the request will fail with a 401 unauthorized error." **[docs]**

### 2.2 Headers sent on every REST call **[verified]**

```
accept-language: vi
origin: https://discord.com
pragma: no-cache
priority: u=1, i
referer: https://discord.com/channels/@me
sec-ch-ua: "Not)A;Brand";v="8", "Chromium";v="138"
sec-ch-ua-mobile: ?0
sec-ch-ua-platform: "Windows"
sec-fetch-dest: empty
sec-fetch-mode: cors
sec-fetch-site: same-origin
x-debug-options: bugReporterEnabled
x-discord-locale: en-US
x-discord-timezone: Asia/Saigon
x-super-properties: <base64 JSON, see below>
```

### 2.3 `x-super-properties` payload

Base64 of:

```json
{
  "os": "Windows",
  "browser": "Discord Client",
  "release_channel": "stable",
  "client_version": "1.0.9215",
  "os_version": "10.0.19045",
  "os_arch": "x64",
  "app_arch": "x64",
  "system_locale": "en-US",
  "has_client_mods": false,
  "client_launch_id": "<random UUID>",
  "browser_user_agent": "<the UA above>",
  "browser_version": "37.6.0",
  "os_sdk_version": "19045",
  "client_build_number": 471091,
  "native_build_number": 72186,
  "client_event_source": null,
  "launch_signature": "<random UUID>",
  "client_heartbeat_session_id": "<random UUID>",
  "client_app_state": "focused"
}
```

### 2.4 Gateway Identify payload **[verified]**

The gateway connection identifies like the desktop client, **not** like a bot:

```json
{
  "op": 2,
  "d": {
    "token": "<user token>",
    "properties": { "...as above..." , "is_fast_connect": false, "gateway_connect_reasons": "AppSkeleton" },
    "capabilities": 0,
    "presence": null,
    "compress": false,
    "client_state": { "guild_versions": {} }
  }
}
```

`intents: 0` — a user account needs no gateway intents. The implementation patches
`WebSocketShard.prototype.send` to rewrite the Identify, but **only when
`intents === 0`**, so a real bot connection in the same process is untouched.

### 2.5 Gateway READY payload shape **[verified]**

`@discordjs/core` re-emits gateway dispatches wrapped:

```ts
{ api, shardId, data: <raw dispatch payload> }
```

so the user object is at `payload.data.user`:

```json
{ "v": 10, "user": { "id": "...", "username": "..." }, "session_id": "..." }
```

> Trap: emitting the event manually (`client.emit('READY', {...})`) bypasses the
> wrapper and yields `payload.user === undefined`.

---

## 3. REST endpoints

Base: `https://discord.com/api/v10`. Auth: `Authorization: <raw user token>`.

### 3.1 `GET /quests/@me` — list quests **[verified]**

Response:

```json
{
  "quests": [ { "id", "config", "user_status", "targeted_content", "preview" } ],
  "excluded_quests": [],
  "quest_enrollment_blocked_until": null
}
```

`config` (snake_case on the REST API — the desktop client uses camelCase, do not mix them up):

```
id, config_version, starts_at, expires_at, features[],
application { id, name, link },
assets { hero, hero_video, quest_bar_hero, game_tile, logotype, ... },
colors { primary, secondary },
messages { quest_name, game_title, game_publisher },
task_config      { type, join_operator, tasks{} },   # legacy quests
task_config_v2   { join_operator, tasks{} },          # current quests
rewards_config   { assignment_method, rewards[], rewards_expire_at, platforms[] },
share_policy, cta_config { link, button_label, ... }
```

`user_status`:

```
user_id, quest_id, enrolled_at, completed_at, claimed_at, claimed_tier,
orb_quantity_claimed, progress { <TASK_TYPE>: { event_name, value, updated_at, completed_at, heartbeat } }
```

> **Trap:** current quests expose their tasks in `task_config_v2`, older ones in
> `task_config`. A resolver must check **both** and fall back gracefully.

### 3.2 Task types **[docs]**

| Type | Spoofable here | Notes |
| --- | --- | --- |
| `WATCH_VIDEO` | ✅ | via `video-progress` |
| `WATCH_VIDEO_ON_MOBILE` | ✅ | same endpoint |
| `PLAY_ON_DESKTOP` | ✅ | via `heartbeat` |
| `PLAY_ON_XBOX` | ❌ | console only |
| `PLAY_ON_PLAYSTATION` | ❌ | console only |
| `STREAM_ON_DESKTOP` | ❌ | needs a real stream + 2nd user in VC |
| `PLAY_ACTIVITY` | ❌ | embedded activity |
| `ACHIEVEMENT_IN_GAME` / `ACHIEVEMENT_IN_ACTIVITY` | ❌ | tracked by the app |

Resolution order used: `WATCH_VIDEO`, `PLAY_ON_DESKTOP`, `STREAM_ON_DESKTOP`,
`PLAY_ACTIVITY`, `WATCH_VIDEO_ON_MOBILE` (first match wins).

### 3.3 `POST /quests/{id}/enroll` **[verified]**

```json
{ "location": 11, "is_targeted": false, "metadata_raw": null }
```

`location` = quest content type, `11` = `QUEST_HOME_DESKTOP`.
Returns the new `user_status` (with `enrolled_at`).

### 3.4 `POST /quests/{id}/heartbeat` — PLAY_ON_DESKTOP **[verified]**

```json
{ "application_id": "<config.application.id>", "terminal": false }
```

* Send every **60 s**; progress grows by the seconds since the last heartbeat
  (server caps it at 2 min per beat) **[docs]**.
* When the task is done, send one last beat with `"terminal": true`.
* Response is the updated `user_status` (check `completed_at`).
* Requires the Electron UA (§2.1).

### 3.5 `POST /quests/{id}/video-progress` — WATCH_VIDEO **[verified]**

```json
{ "timestamp": <seconds watched, float> }
```

Server-side anti-cheat **[verified by behaviour]**:

```
allowed = floor((now - enrolled_at) / 1000) + 10
```

A `timestamp` may never exceed `allowed`. Practical loop (1 s tick, +5 s per beat):

```
while timestamp < target:
    allowed = min(target, floor((now - enrolled_at) / 1000) + 10)
    if allowed - secondsDone >= 5 or allowed == target:
        POST { timestamp: min(allowed, secondsDone + 5) }
    sleep(1s)
```

Result: a 900 s video quest takes ≈15 minutes of wall clock — the server's pacing
is what makes it work, not the client.

Because the pacing is per quest (it is measured from the quest's own
`enrolled_at`), the quests of several accounts - and several quests of one
account - can run **at the same time**: every quest is enrolled first and then
advanced in parallel. The whole queue then needs as long as its slowest quest
instead of the sum of all of them.

### 3.6 `POST /quests/{id}/claim-reward` **[verified]**

```json
{
  "location": 11,
  "platform": 0,
  "is_targeted": false,
  "metadata_raw": null
}
```

* `location` and `platform` are **both required** — omitting them →
  `400 Invalid Form Body: location[BASE_TYPE_REQUIRED] / platform[BASE_TYPE_REQUIRED]`.
* `platform` must be one of the quest's `rewards_config.platforms`
  (`0` = CROSS_PLATFORM, `1` = XBOX, `2` = PLAYSTATION, `3` = SWITCH, `4` = PC).
  A platform not offered by the quest →
  `403 Quest does not support codes for this platform (code 260004)`.
* **Discord answers with an hCaptcha challenge** (see below) instead of claiming.

### 3.7 `GET /quests/{id}/reward-code` **[docs]**

Returns the redeem code of an already-claimed reward.

---

## 4. The hCaptcha wall on claiming **[verified]**

Raw response body of a claim attempt:

```json
{
  "captcha_key": ["captcha-required"],
  "captcha_sitekey": "4bb5aadb-b50f-4f23-b1c2-92b59ba400d5",
  "captcha_service": "hcaptcha",
  "captcha_session_id": "caa09d8b-...",
  "captcha_rqdata": "vwOLPnQg6c67fXfzPyo6miLlzEYEpyk/...",
  "captcha_rqtoken": "Im8yRk9LOUVnOTR6SHJCNkcvV1pCVUYrVnpqUmRXOEhUeHdBNDVLZUlISFA0ejYvM2EycksySk42cXFxR2FNNUkwOXkyRkE9PVdadmJkQ21xSHh5ZlgxaHQi.avZHGw.WT40d7TfXT41MbLoQ-e40T8ykhg"
}
```

`@discordjs/rest` surfaces this as `DiscordAPIError` with the message
`"No Description"` (the body has no `message`/`code` field) — the real payload is
in `error.rawError`.

**Solving flow** (same as Discord's other captcha-protected endpoints):

1. POST the claim → get `captcha_sitekey` + `captcha_rqdata` + `captcha_session_id`.
2. Solve the hCaptcha with a solving service (2captcha / anti-captcha), passing
   `sitekey`, `rqdata`, the Discord UA and `isInvisible: true`.
3. Repeat the **same** request with header `X-Captcha-Key: <solution>`.

Without a solver key the only option is a human: click **Claim** in the Discord
client (the desktop app solves the captcha itself).

---

## 5. Content type (`location`) enum **[docs]**

Only a few values matter in practice:

| Value | Name | Use |
| --- | --- | --- |
| 1 | QUEST_BAR | quest bar |
| 2 | QUEST_INVENTORY_CARD | inventory |
| 11 | QUEST_HOME_DESKTOP | desktop Quest Home — used for enroll + claim |
| 12 | QUEST_HOME_MOBILE | mobile Quest Home |
| 25 | REWARD_MODAL | reward modal |
| 29 | ORBS_BALANCE_MENU | Orbs menu |

Full list (0–72) is in the discord.food docs.

---

## 6. Reward model **[docs]**

`rewards_config`:

```
assignment_method: 1 = ALL (all rewards assigned on completion), 2 = TIERED
rewards[]: { type, sku_id, asset, messages { name, name_with_article,
             redemption_instructions_by_platform{} }, orb_quantity, quantity,
             expires_at, approximate_count }
rewards_expire_at
platforms[]: quest platform types the reward can be redeemed on
```

Reward types: `1` REWARD_CODE, `2` IN_GAME, `3` COLLECTIBLE (decoration),
`4` VIRTUAL_CURRENCY (Orbs), `5` FRACTIONAL_PREMIUM.

---

## 7. Multi-account operation

* One gateway + one REST client **per account**.
* Accounts are started **sequentially with a gap** (default 8 s) because Discord
  rate-limits Identify requests; a failed start is retried once after 10 s.
* Quest cycles of different accounts then run **in parallel**.
* One dead account must not kill the others → errors are caught per account.
* Output switches to plain log lines (`[main] …`, `[alt] …`) when more than one
  account runs, because the live dashboard would clear the screen over itself.

---

## 8. Program structure

```
bot.ts                 orchestrator: load accounts → start gateways → run cycles
src/accounts.ts        account list (accounts.json / TOKENS / TOKEN)
src/client.ts          REST + gateway client for a user token (fingerprint, identify)
src/constants.ts       UA + super-properties
src/quest.ts           quest model + task resolution (task_config + task_config_v2)
src/questManager.ts    endpoints: enroll, heartbeat, video-progress, claim-reward
src/captcha.ts         optional hCaptcha solver (2captcha / anti-captcha)
src/notifier.ts        posts status messages with a bot token
src/botController.ts   Discord bot control panel (!status, !quests, !run, !stop)
src/questRunner.ts     per-account engine (one cycle = fetch → enroll → progress → claim)
scripts/check-token.ts validates every token
scripts/list-quests.ts dumps every quest + its state
```

---

## 9. Discord bot (optional)

A bot account cannot complete quests, but it can:

1. **Report**: post `✅ Quest completed`, `🎁 Reward claimed`, `❌ Quest failed`,
   `🏁 Cycle finished` to a channel (per-account channel optional).
2. **Control**: with `BOT_COMMAND_CHANNEL_ID` set, the bot listens for
   `!help`, `!status`, `!quests`, `!run [account]`, `!stop`.
   `!run` / `!stop` require the sender id to be in `BOT_ADMIN_USER_IDS`.
   Intents needed: `Guilds | GuildMessages | MessageContent`.

---

## 10. Environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `TOKEN` | yes* | single user token |
| `TOKENS` | yes* | several tokens, comma/space separated |
| `accounts.json` | yes* | account list file (`name`, `token`, `channelId`, `botToken`) |
| `ACCOUNTS_FILE` | no | path to the account list (default `accounts.json`) |
| `LOOP_MINUTES` | no | minutes between cycles, `0` = run once |
| `ACCOUNT_STAGGER_SECONDS` | no | gap between account connects (default 8) |
| `PLAIN_OUTPUT` | no | force log-only output |
| `CAPTCHA_SERVICE` | no | `2captcha` / `anti-captcha` |
| `CAPTCHA_API_KEY` | no | key for solving the claim captcha |
| `BOT_TOKEN` | no | bot token for notifications / control panel |
| `NOTIFY_CHANNEL_ID` | no | default notification channel |
| `BOT_COMMAND_CHANNEL_ID` | no | channel where the bot accepts commands |
| `BOT_ADMIN_USER_IDS` | no | comma separated user ids allowed to run/stop |
| `BOT_PREFIX` | no | command prefix (default `!`) |

\* one of the three account sources.

---

## 11. Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| `401 Unauthorized` on `/quests/@me` | token invalid/expired | re-copy the token, log in again |
| gateway closes with `4004` | invalid token | same as above |
| gateway never sends READY | another session already uses the token | stop the other instance, wait 10 s |
| `401` on `heartbeat` | UA missing `Electron/<version>` | fix the User-Agent |
| `401` on `video-progress` | token dead mid-run | refresh the token |
| `400 No Description` on claim | hCaptcha challenge | solve it or claim in the client |
| `400 BASE_TYPE_REQUIRED` | missing `location`/`platform` | see §3.6 |
| `403 code 260004` | platform not offered by that quest | use a platform from `rewards_config.platforms` |
| quest FAILED: "no supported task type" | console/stream/activity quest | finish it manually on the right platform |

---

## 12. Legal note

User tokens are against Discord's Terms of Service and can get an account
disabled. Automating rewards may also violate the Quest program's rules. Use at
your own risk.
