# Tino — one image: the API server (Bun runs the TypeScript directly) plus the
# built web app it serves. Railway builds this from .railway/railway.ts.

FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
RUN bun install --frozen-lockfile

FROM deps AS web
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
COPY assets assets
RUN bun run --filter @tino/web build

FROM oven/bun:1.3-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY --from=deps /app/packages/core/node_modules packages/core/node_modules
COPY package.json tsconfig.base.json ./
COPY packages packages
COPY apps/server/package.json apps/server/tsconfig.json apps/server/
COPY apps/server/src apps/server/src
COPY --from=web /app/apps/web/dist/client apps/web/dist/client
USER bun
EXPOSE 8080
CMD ["bun", "apps/server/src/bootstrap/main.ts"]
