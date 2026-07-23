#!/bin/sh
set -e

# Railway (and Docker) volumes often mount as root over /app/data.
# The runtime user is githubot — without a chown, better-sqlite3 fails with SQLITE_CANTOPEN.
DATA_DIR="${GITHUBOT_DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"
if [ "$(id -u)" = "0" ]; then
	chown -R githubot:githubot "$DATA_DIR"
	exec su-exec githubot "$@"
fi

exec "$@"
