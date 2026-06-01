FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
# Build the shared package first so its dist/ exists when api resolves
# @stampdeck/shared at compile-time AND runtime (api's `main` field points to
# dist/index.js — see packages/shared/package.json).
RUN pnpm --filter @stampdeck/shared run build
RUN pnpm --filter @stampdeck/api run build
# tsc only compiles .ts files. Copy the SQL migrations alongside the compiled
# migrate.js so that `node dist/db/migrate.js` can find them at runtime
# (migrate.ts resolves the migrations dir relative to its own location).
RUN cp -r apps/api/src/db/migrations apps/api/dist/db/migrations

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps   /repo/node_modules ./node_modules
COPY --from=deps   /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build  /repo/apps/api/dist ./apps/api/dist
COPY --from=build  /repo/packages/shared ./packages/shared
COPY apps/api/package.json ./apps/api/package.json
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]
