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
- A delivery log entry: the tracking ID, the delivery ID, the event name and action
  (for example `pull_request` / `opened`), what happened to it (delivered, filtered,
  failed, …), a short reason when there is one — a filter rule, or the error Discord
  returned — and the time. It never holds any part of the payload.

**For each change to a server's configuration**

- The server ID, the Discord user ID and username of whoever made the change, whether
  it was made in the dashboard or with `/repo`, what kind of change it was (for example
  "paused deliveries" or "rotated the webhook secret"), the repository it applied to,
  and the time. It never holds a secret or the contents of a setting. Server admins see
  it on the dashboard's History page.

**For each dashboard sign-in that was ended early**

- A random session ID (on sign-out) or the Discord user ID with the time of the click
  (on "sign out everywhere"), kept only until that session would have expired.

## What is not stored

- **Webhook payloads.** Each one is checked, turned into a Discord message, and
  discarded. Issue text, commit messages and the like live only in the Discord message.
- **Message contents** once posted — Discord holds them, not GitHuBot.
- **GitHub credentials.** There are none; the bot never signs in to GitHub.
- **Secrets from secret scanning alerts.** The alert's secret value is never read.
- **Discord user profiles.** Commands check permissions at the moment they run. The
  only user data kept is the ID and username on change-history entries, described above.

## The optional dashboard

With `DASHBOARD_ENABLED`, people can sign in with Discord (scopes `identify guilds`).
The Discord access token is used once during sign-in to read the user's name, avatar
and servers, and is then dropped — it is never stored. Nothing about the session is
kept on the server: a signed cookie in the user's own browser holds their Discord user
ID, username, avatar URL, the servers (ID and name) where they manage the bot, and an
anti-forgery token. It expires after `DASHBOARD_SESSION_HOURS` (12 by default) or on
sign-out. The pages load nothing from third parties except the signed-in user's and
their servers' images from Discord's CDN.

Changes made in the dashboard are stored exactly as the same change made with `/repo`
would be, and both are written to the change history described above.

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
- **Delivery records**, including the delivery log, are deleted after **30 days**.
- **Change history** is deleted after **90 days**, and at once with the server's other
  data when the bot is removed (after the 7-day grace period above).

A server's admins can therefore erase everything the bot holds about their server by
removing each repository, or by removing the bot.

## Questions

Ask whoever operates the instance you use. For questions about the software itself,
open an issue at [MatiDeZeta/GitHuBot](https://github.com/MatiDeZeta/GitHuBot/issues);
report security problems privately as described in [SECURITY.md](SECURITY.md).
