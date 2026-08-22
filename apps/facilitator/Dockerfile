# The facilitator: payment plane plus discovery, one persistent volume.
#
# Build from the repository root:
#   docker build -f apps/facilitator/Dockerfile -t x402seek-facilitator .
#
# Two things drive the shape of this file.
#
# The embedding model is baked in at build time so a container start never
# depends on the Hugging Face CDN — a facilitator that cannot reach a model host
# should still settle payments, and it should not spend its first minute
# downloading.
#
# The catalog lives on a mounted volume, never in the image. It holds the
# trust-on-first-use ownership bindings, so losing it on redeploy would not just
# empty a listing table: it would let a different payTo claim a canonical key
# that was already bound.

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
COPY apps/e2e-stellar/package.json ./apps/e2e-stellar/
COPY packages/catalog/package.json ./packages/catalog/
COPY packages/search/package.json ./packages/search/
COPY packages/retrieval-eval/package.json ./packages/retrieval-eval/
COPY e2e-harness/proxy/package.json ./e2e-harness/proxy/
COPY e2e-harness/hono-repro/package.json ./e2e-harness/hono-repro/
RUN pnpm install --frozen-lockfile --prod=false

# --- model ------------------------------------------------------------------
# Fetched by calling the real embedder, so a moved artifact or revision fails
# the build here rather than the container at boot in front of a reviewer.
FROM deps AS model
COPY packages/catalog ./packages/catalog
COPY packages/search ./packages/search
COPY apps/facilitator/scripts ./apps/facilitator/scripts
ENV MODELS_CACHE_DIR=/app/.models-cache
RUN pnpm --filter @stellar-bazaar/facilitator exec tsx scripts/warm-model.mts

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV MODELS_CACHE_DIR=/app/.models-cache
ENV PORT=4402
# Overridden by the platform, but never left to a default that means mainnet.
ENV STELLAR_NETWORK=testnet
ENV CATALOG_PATH=/data/catalog.db

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/facilitator/node_modules ./apps/facilitator/node_modules
COPY --from=deps /app/packages/catalog/node_modules ./packages/catalog/node_modules
COPY --from=deps /app/packages/search/node_modules ./packages/search/node_modules
COPY --from=model /app/.models-cache ./.models-cache

COPY package.json pnpm-workspace.yaml ./
COPY packages/catalog ./packages/catalog
COPY packages/search ./packages/search
COPY apps/facilitator ./apps/facilitator

# SQLite needs write access to the directory as well as the file, for its
# journal. This handles the unmounted case; the entrypoint handles the mounted
# one, because a volume mount replaces whatever the build put here.
RUN mkdir -p /data /home/node/.cache && chown -R node:node /data /app /home/node
COPY apps/facilitator/docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

# Starts as root so the entrypoint can take ownership of the mounted volume,
# then drops to `node` with exec — the process never keeps the privilege.
WORKDIR /app/apps/facilitator
ENTRYPOINT ["/usr/local/bin/entrypoint"]

EXPOSE 4402

# No `VOLUME /data` instruction on purpose. Railway rejects it outright —
# "docker VOLUME is not supported, use Railway Volumes" — because the platform
# mounts the volume itself. The mkdir above still matters: it gives the mount
# point the right ownership for the non-root user when nothing is mounted over
# it, which is what makes a local `docker run` behave like the hosted one.

# Readiness, not liveness: 200 here means discovery can actually answer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4402)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
