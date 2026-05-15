FROM node:22-slim AS deps
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock* ./
COPY packages/core/package.json ./packages/core/
COPY packages/aws/package.json ./packages/aws/
COPY packages/cli/package.json ./packages/cli/
# Install all workspace dependencies (including native modules like better-sqlite3)
RUN bun install --frozen-lockfile

FROM node:22-slim AS runner
WORKDIR /app
RUN npm install -g bun
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/aws/node_modules ./packages/aws/node_modules
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/aws/package.json ./packages/aws/
COPY packages/core/src ./packages/core/src
COPY packages/aws/src ./packages/aws/src
COPY scripts ./scripts

# Ensure workspace packages are resolvable via node_modules/@tino/*
RUN mkdir -p node_modules/@tino && \
    ln -s /app/packages/core node_modules/@tino/core && \
    ln -s /app/packages/aws node_modules/@tino/aws

# tsx runs TypeScript directly — no build step needed
ENV NODE_ENV=production
CMD ["bun", "run", "--filter", "@tino/core", "start"]
