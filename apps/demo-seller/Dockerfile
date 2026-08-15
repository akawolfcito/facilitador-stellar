# The demo seller. One paid resource, no key, no database, no model.
#
# Kept as its own image on purpose: this process must never be in a position to
# sign anything, and the surest way to guarantee that is for it not to ship the
# code that could. It carries no Stellar SDK and no signer.
#
# Build from the repository root:
#   docker build -f apps/demo-seller/Dockerfile -t x402seek-demo-seller .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/demo-seller/package.json ./apps/demo-seller/
COPY apps/facilitator/package.json ./apps/facilitator/
COPY packages/catalog/package.json ./packages/catalog/
COPY packages/search/package.json ./packages/search/
RUN pnpm install --frozen-lockfile --prod=false

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=4420
ENV HOST=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/demo-seller/node_modules ./apps/demo-seller/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/demo-seller ./apps/demo-seller
# Only the one guard it imports, not the whole facilitator.
COPY apps/facilitator/package.json ./apps/facilitator/
COPY apps/facilitator/src/own-facilitator.ts ./apps/facilitator/src/own-facilitator.ts

# Holds no secret, so it needs no privileged identity.
USER node
WORKDIR /app/apps/demo-seller

EXPOSE 4420
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4420)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "start"]
