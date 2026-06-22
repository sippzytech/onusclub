FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# Next.js transpilePackages handles .ts at build time, but we build shared
# anyway for consistency with the api image and so the d.ts files exist for
# downstream tooling.
RUN pnpm --filter @onusclub/shared run build
RUN pnpm --filter @onusclub/web run build

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /repo/apps/web
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3001
CMD ["node", "apps/web/server.js"]
