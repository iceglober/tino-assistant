FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml ./
# Approve native build scripts (better-sqlite3 needs node-gyp; esbuild needs its binary)
RUN echo "onlyBuiltDependencies[]=better-sqlite3\nonlyBuiltDependencies[]=esbuild" > .npmrc
RUN pnpm install --frozen-lockfile --prod=false

FROM node:22-slim AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# better-sqlite3 needs the native module from the deps stage
# tsx runs TypeScript directly — no build step needed

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
