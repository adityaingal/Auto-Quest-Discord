# Privacy Policy

_Last updated: 2026-11-13_

This bot ("Quest Completer") is a Discord bot. This policy explains what
data it stores, why, and how to get it deleted.

## What is stored

The bot stores the following data **per Discord user**, and only for the
Discord account that triggered the storage:

| Data | Why | How it is protected |
| --- | --- | --- |
| Your Discord user id | To attach your data to your account | Plain text |
| Your username | To show it back to you | Plain text |
| A linked account id and username | So the bot can read the quests of the account you authorised | Plain text |
| An OAuth2 access token and refresh token | So the bot can read the quests of your linked account | Encrypted with AES-256-GCM |
| Quest progress, reward status, command history | So `/quest progress` and `/quest history` can show your own history | Plain text |
| Rooms you create, and the accounts inside them | Rooms are your private containers for accounts | Encrypted with AES-256-GCM |
| A Discord webhook id and token | If you set a webhook on a room, so the bot can post there | Encrypted with AES-256-GCM |

## What is never stored

- Your Discord password.
- The content of messages of other users.
- Your Discord user token in plain text. It is encrypted before it is
  written to disk and it is never displayed or logged.
- The full token in a webhook message. A webhook post contains the room
  name, the account name and the event - never the token itself.

## Who can see your data

- **You.** A room belongs to the account that created it. No other user can
  read it, list it, or use the accounts inside it. The bot enforces this in
  the database layer, not only in the commands.
- **The bot owner.** Aggregate statistics only - counts of users, rooms and
  accounts. Never tokens, never room contents, never the names of your
  accounts.

## How long is it kept

- Quest progress, history and reward records are kept until you delete them.
- **Rooms are reset automatically after 30 days.** When a room expires it is
  deleted together with every account in it. You get a warning a few days
  before that happens, and `/room renew` keeps a room alive for another
  30 days.
- OAuth2 tokens expire on their own and are refreshed while the link is
  active.

## How to delete your data

- `/account unlink` deletes the linked account, its tokens, your rooms, your
  progress, your history and your reward records immediately.
- `/room delete` deletes a single room with every account in it.
- `/room remove` deletes a single account from a room and closes the gap in
  the sequence.
- The bot owner can delete a user entry with `/admin purge user:<id>`.

After `/account unlink` there is nothing left of you in the database.

## Third parties

- **Discord.** The bot talks to the Discord API to read quests, to send
  notifications and to post to webhooks. Discord receives whatever the bot
  sends, including the commands you run.
- **The webhook owner.** If you set a webhook on a room, the messages the
  bot posts there are visible to whoever can read that channel. Choose a
  channel only you can read if that matters to you.

## Hosting

The bot runs on the infrastructure of its operator. The database is a single
SQLite file. The operator is able to read the database - this is why the
tokens are encrypted and the owner only looks at counts.

## Contact

Open an issue on the repository or contact the operator directly.
