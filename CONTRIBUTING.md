# Contributing

Thanks for helping out. This is a small bot, so the bar for a change is that
it is understandable and that the tests still pass.

## Getting started

```bash
git clone https://github.com/adityaingal/Auto-Quest-Discord.git
cd Auto-Quest-Discord
npm install
cp .env.example .env      # fill in DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID
npm run dev
```

Node.js **22.5** or newer is needed - the bot uses the built-in `node:sqlite`
module.

## Before you open a pull request

```bash
npm run typecheck   # tsc --noEmit
npm test            # node:test suite
npm run build       # compile to dist/
```

All three have to pass. The CI runs the same commands on Node 22 and 24.

## How the code is organised

```
bot/commands/    the slash commands and the component router
bot/services/    the business logic (quest, room, account, reward, ...)
bot/integrations/ the Discord REST calls (OAuth2, webhooks, user sessions)
bot/database/    the connection, the migrations and the repositories
bot/ui/          the embeds, the components and the theme
bot/utils/       the config, the logger, the errors and the crypto
src/             the preserved legacy quest engine (models + parser)
```

The rule that matters most: **a command never talks to the database
directly.** It goes through a service, and the service is always given a
scope. See [SECURITY.md](SECURITY.md) for the details - a change that breaks
the scoping is a security bug, not a style question.

## Adding a command

1. Add the subcommand to the group in `bot/commands/`.
2. Put the logic into a service in `bot/services/`.
3. Add a test in `tests/`.
4. Update the command reference in the readme.

The test in `tests/services.test.ts` checks the subcommands of every group,
so a new subcommand has to be added to that list as well.

## Adding a migration

Migrations are append-only - never edit an applied one. Add a new entry to
`MIGRATIONS` in `bot/database/index.ts` with the next version number and a
descriptive name. The migrations run automatically at startup.

## Style

- Tabs for indentation, single quotes, semicolons.
- No comments that restate the code. Explain *why* something is done, not
  what the next line does.
- Keep the user facing messages free of jargon - they are read by people who
  do not know what a "scope" is.

## Reporting bugs

Open an issue and describe what you did, what happened and what you expected.
If it involves the quest automation, mention the account label - never the
token.
