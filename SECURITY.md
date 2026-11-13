# Security Policy

## Supported versions

The `main` branch is the only supported version.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's
private vulnerability reporting on the repository, or contact the operator
directly.

Include:

- what the problem is,
- how to reproduce it,
- which version or commit you tested,
- what an attacker gains from it.

You will get an acknowledgement within a few days and a fix or an assessment
once the report has been reviewed.

## What is handled as a security issue

- A user can read the rooms, accounts or progress of another user.
- A token is exposed in a log, an embed, a webhook message or an HTTP
  response.
- The bot can be talked into sending data to an address it should not reach.
- A stored token can be decrypted without the `ENCRYPTION_KEY`.
- An unauthenticated request can change the state of the bot.

## Design notes for contributors

These are the rules that keep the bot safe. Please keep them in mind before
opening a pull request.

### Every read and every write is scoped

A user may only ever reach their own data. The scope is built from the
Discord user id in `bot/services/scope.ts` and passed down explicitly. Do
not add a query that takes a user id from a command option.

- Never fall back to a global account or a global setting when a scope is
  available. The account selection is stored per user
  (`scopeKey()` in `bot/services/scope.ts`).
- A background job uses `OPERATOR_SCOPE` and must only touch operator data.

### Secrets never get a default

`bot/config.ts` throws when `ENCRYPTION_KEY` is missing. Do not reintroduce a
fallback key - a published default would let everybody decrypt every stored
token.

### Tokens are encrypted and masked

- Tokens are encrypted with `TokenVault` (AES-256-GCM) before they are
  written.
- A token is never logged, never echoed in an embed and never sent to a
  webhook.
- `TokenService.mask` and `TokenService.fingerprint` are the only ways a
  token may be shown.

### The bot is not an HTTP proxy

`bot/integrations/webhook.ts` only accepts `discord.com` webhook URLs, and
the webhook URL comes from the environment (`WEBHOOK_URL`), never from a
user. Keep the host allowlist tight.

### The whitelist covers every interaction

The check in `bot/index.ts` runs before the autocomplete, before the button
handlers and before the commands. Keep it that way - the autocomplete and the
buttons are the easy way to bypass a command level check.

### The bot needs as few intents as possible

Only `GatewayIntentBits.Guilds` is requested. A privileged intent like
`MessageContent` has to be justified in the Discord developer review, and
this bot does not read messages.
