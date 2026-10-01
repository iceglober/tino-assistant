FROM node:22-slim AS deps
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock* ./
COPY packages/core/package.json ./packages/core/
RUN bun install --frozen-lockfile

FROM deps AS builder
COPY packages/core/tsconfig.json packages/core/tsconfig.build.json packages/core/tsconfig.app.json packages/core/vite.config.ts ./packages/core/
COPY packages/core/src ./packages/core/src
# Build server (tsc) + console SPA (Vite)
RUN cd packages/core && \
    ./node_modules/.bin/tsc -p tsconfig.build.json && \
    ./node_modules/.bin/vite build

FROM oven/bun:1 AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY assets ./assets

# Ensure workspace packages are resolvable via node_modules/@tino/*
RUN mkdir -p node_modules/@tino && \
    ln -s /app/packages/core node_modules/@tino/core

ENV NODE_ENV=production
CMD ["bun", "run", "packages/core/dist/bootstrap/main.js"]
