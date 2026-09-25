# Privacy

GitHuBot is self-hosted software: whoever runs an instance decides where it runs and
controls its data. This page describes exactly what the software stores, why, and for
how long, so an operator can tell their server members.

## What is stored

In the instance's own database (SQLite or Postgres):

**For each Discord server that uses the bot**

- The server ID.
- Settings chosen with `/repo`: language, default theme and density, and the channel
  for delivery alerts.
- The date the bot was removed from the server, if it was (see [Deletion](#deletion)).

**For each tracked repository**

- The server ID and the GitHub `owner/repo` name.
- Channel IDs it posts to, role IDs it mentions, and the filter rules admins typed
  (branch, label and author patterns).
- Its theme, density and language, if set.
- A random tracking ID (part of the webhook URL) and the webhook secret, encrypted
  with AES-256-GCM under the operator's `MASTER_KEY` — plus the previous secret while
  a rotation is in progress.
- Delivery health: counters, the times of the last delivery, success and error, and
  the last error message Discord returned.
- The repository name GitHub last reported, when it differs from the tracked one.

**For each webhook delivery**

- GitHub's delivery ID (a random identifier), the tracking ID, and when it arrived.
  This prevents the same event from posting twice and draws the dashboard's activity
  chart.

## What is not stored

- **Webhook payloads.** Each one is checked, turned into a Discord message, and
  discarded. Issue text, commit messages and the like live only in the Discord message.
- **Message contents** once posted — Discord holds them, not GitHuBot.
- **GitHub credentials.** There are none; the bot never signs in to GitHub.
- **Secrets from secret scanning alerts.** The alert's secret value is never read.
- **Discord user profiles.** Commands check permissions at the moment they run.

## The optional dashboard

With `DASHBOARD_ENABLED`, people can sign in with Discord (scopes `identify guilds`).
The Discord access token is used once during sign-in to read the user's name, avatar
and servers, and is then dropped — it is never stored. Nothing about the session is
kept on the server: a signed cookie in the user's own browser holds their Discord user
ID, username, avatar URL, the servers (ID and name) where they manage the bot, and an
anti-forgery token. It expires after `DASHBOARD_SESSION_HOURS` (12 by default) or on
sign-out. The page loads nothing from third parties.

## Kept only in memory

Delivery counters for `/stats` and `/metrics`, alert cooldowns, and the icon set.
All of it resets on restart.

## Logs

The process writes logs to standard output. They include server IDs, repository names,
tracking IDs, Discord user IDs for dashboard sign-ins and dashboard actions, and error
messages. Secrets, tokens, signatures and `MASTER_KEY` are redacted. How long logs are
kept depends on where the operator hosts the bot.

## Who else sees data

- **Discord** receives the messages the bot posts and the commands people run.
- **GitHub** sends the webhooks. When someone runs `/repo add`, the bot makes one
  unauthenticated request to `api.github.com/repos/<owner>/<repo>` to warn about typos
  and private repositories; GitHub sees that repository name and the host's IP address.

Nothing else is contacted. There is no telemetry and no analytics.

## Deletion

- **`/repo remove`** deletes the repository and its delivery records immediately.
  Delete the webhook on GitHub too; the bot cannot, because it has no GitHub access.
- **Removing the bot from a server** deletes all of that server's data — settings,
  tracked repositories and their delivery records — **7 days later**. Inviting the bot
  back within those 7 days cancels it. A Discord outage never counts as a removal.
- **Delivery records** are deleted after **30 days**.

A server's admins can therefore erase everything the bot holds about their server by
removing each repository, or by removing the bot.

## Questions

Ask whoever operates the instance you use. For questions about the software itself,
open an issue at [MatiDeZeta/GitHuBot](https://github.com/MatiDeZeta/GitHuBot/issues);
report security problems privately as described in [SECURITY.md](SECURITY.md).
