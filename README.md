# OnUsClub

Multi-tenant SaaS for digital loyalty cards (stamp cards, points, memberships, etc.) for cafés, salons, and small businesses. Customers add cards to Google Wallet (Phase 1) and later Apple Wallet (Phase 2). Owners stamp/redeem by scanning the customer's QR after billing.

Positioned as the **Netherlands-first, SMB-friendly** alternative to Perkstar (UK) and Tap2 (NL).

## Stack

- pnpm workspaces monorepo
- `apps/api` — Node 20 + Express + TypeScript (ESM) + mysql2 + zod + pino
- `apps/web` — Next.js 14 (App Router) + TypeScript + Tailwind + NextAuth
- `packages/shared` — shared TypeScript types
- MySQL 8 (docker-compose)
- Traefik (in production, via existing VPS setup)

## Local quickstart

```bash
# 1. Copy env files
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# 2. Create empty secrets dir (gitignored; Google Wallet SA key goes here later)
mkdir -p secrets

# 3. Install
pnpm install

# 4. Start MySQL, then api + web
docker compose -f docker-compose.dev.yml up -d mysql
pnpm db:migrate
docker compose -f docker-compose.dev.yml up -d api web

# 5. Verify
curl http://localhost:4000/health
open http://localhost:3001
```

Local ports: api `4000`, web `3001`, mysql `3306`. (Next.js is on 3001, not 3000, because the VPS uses 3000 for Metabase.)

## Deploy (stub)

`docker-compose.prod.yml` is wired for the existing Hostinger VPS:

- Joins the external Traefik network `n8n_default`.
- Uses cert resolver `mytlschallenge` for Let's Encrypt.
- Routes `api.sippzy.com` → api, `app.sippzy.com` → web.
- MySQL stays internal; no host ports published for api/web.

Full deploy runbook will be added when we cut the first prod release.

## Architecture notes

See `CLAUDE.md` for the canonical project context (stack decisions, Google Wallet issuer ID, competitor positioning, deploy conventions).
