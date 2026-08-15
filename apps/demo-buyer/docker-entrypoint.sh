#!/bin/sh
# Take ownership of the mounted volume, then drop privileges for good.
#
# Same shape as the facilitator's, and for the same reason: Railway mounts its
# volumes root-owned, so a container that starts as `node` cannot create the
# SQLite file and dies with SQLITE_CANTOPEN. `setpriv` replaces the process
# rather than forking one, so PID 1 semantics survive and SIGTERM still reaches
# Node, which is what lets the ledger close cleanly.
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  # setpriv changes the uid and nothing else, so HOME would still point at
  # /root and corepack would try to write its cache there as `node`.
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all "$@"
fi

exec "$@"
