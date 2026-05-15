FROM node:22-slim AS deps
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock* ./
COPY packages/core/package.json ./packages/core/
COPY packages/aws/package.json ./packages/aws/
COPY packages/cli/package.json ./packages/cli/
RUN bun install --frozen-lockfile

FROM deps AS builder
COPY packages/core/tsconfig.json packages/core/tsconfig.build.json ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/aws/tsconfig.json packages/aws/tsconfig.build.json ./packages/aws/
COPY packages/aws/src ./packages/aws/src
# Build both packages (core first, aws depends on core types)
RUN cd packages/core && ./node_modules/.bin/tsc -p tsconfig.build.json && \
    cd ../aws && ./node_modules/.bin/tsc -p tsconfig.build.json

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
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/aws/dist ./packages/aws/dist
COPY assets ./assets
COPY scripts ./scripts

# Ensure workspace packages are resolvable via node_modules/@tino/*
RUN mkdir -p node_modules/@tino && \
    ln -s /app/packages/core node_modules/@tino/core && \
    ln -s /app/packages/aws node_modules/@tino/aws

ENV NODE_ENV=production
CMD ["node", "packages/core/dist/index.js"]
