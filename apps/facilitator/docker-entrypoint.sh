#!/bin/sh
# Take ownership of the mounted volume, then drop privileges for good.
#
# Railway mounts its volumes root-owned, so a container that starts as `node`
# cannot create the SQLite file and dies with SQLITE_CANTOPEN. The image cannot
# fix that at build time: the mount replaces whatever the build put there.
#
# So the container starts as root, does exactly one privileged thing, and hands
# off. `setpriv` (util-linux, already in the base image) replaces the process
# rather than forking one, which keeps PID 1 semantics — SIGTERM still reaches
# Node, and the graceful shutdown in index.ts still runs.
set -e

DATA_DIR="$(dirname "${CATALOG_PATH:-/data/catalog.db}")"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  # setpriv changes the uid and nothing else, so HOME would still point at
  # /root and corepack would try to write its cache there as `node`.
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all "$@"
fi

# Already unprivileged — a local `docker run --user node`, for instance.
exec "$@"
