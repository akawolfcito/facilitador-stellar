# The demo buyer: the only service here that can spend money.
#
# Build from the repository root:
#   docker build -f apps/demo-buyer/Dockerfile -t x402seek-demo-buyer .
#
# Two things shape this file.
#
# It carries a signing key, so it carries as little else as possible: no model,
# no search index, no catalog, and no workspace it does not import. The smaller
# the image, the shorter the list of things a compromise would find.
#
# It keeps a spend ledger on a mounted volume. Losing that on redeploy would
# refill the day's budget on every push, which is not a budget.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- dependencies -----------------------------------------------------------
# Only manifests, so a source edit does not invalidate the install layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/facilitator/package.json ./apps/facilitator/
COPY apps/mcp-discovery/package.json ./apps/mcp-discovery/
COPY apps/demo-seller/package.json ./apps/demo-seller/
COPY apps/demo-buyer/package.json ./apps/demo-buyer/
COPY apps/e2e-stellar/package.json ./apps/e2e-stellar/
COPY packages/catalog/package.json ./packages/catalog/
COPY packages/search/package.json ./packages/search/
COPY packages/retrieval-eval/package.json ./packages/retrieval-eval/
COPY e2e-harness/proxy/package.json ./e2e-harness/proxy/
COPY e2e-harness/hono-repro/package.json ./e2e-harness/hono-repro/
RUN pnpm install --frozen-lockfile --prod=false

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=4430
# Overridden by the platform, but never left to a default that means mainnet.
ENV STELLAR_NETWORK=testnet
ENV DATA_DIR=/data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/demo-buyer/node_modules ./apps/demo-buyer/node_modules

COPY package.json pnpm-workspace.yaml ./
COPY apps/demo-buyer ./apps/demo-buyer

# SQLite needs write access to the directory as well as the file, for its
# journal. This covers the unmounted case; the entrypoint covers the mounted
# one, because a volume mount replaces whatever the build put here.
RUN mkdir -p /data /home/node/.cache && chown -R node:node /data /app /home/node
COPY apps/demo-buyer/docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

# Starts as root so the entrypoint can take ownership of the mounted volume,
# then drops to `node` with exec. The process never keeps the privilege.
WORKDIR /app/apps/demo-buyer
ENTRYPOINT ["/usr/local/bin/entrypoint"]

EXPOSE 4430

# No `VOLUME /data`: Railway rejects the instruction outright and mounts the
# volume itself. The mkdir above is what makes a local `docker run` behave the
# same way the hosted one does.

# Liveness, not readiness. /ready turns 503 when the day's budget is spent,
# which is the control working, and is not a reason to restart the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4430)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
