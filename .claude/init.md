# Stampdeck — Session Quick-Start

You're in the **Stampdeck** repo: a multi-tenant SaaS for digital loyalty cards (Google Wallet phase 1, Apple Wallet phase 2). We compete with Perkstar (UK) and Tap2 (NL), positioned as **Netherlands-first** for SMBs.

Read `CLAUDE.md` for full context. The short version:

## Layout

```
apps/
  api/          Node 20 + Express + TS (ESM) + MySQL
  web/          Next.js 14 App Router + Tailwind
packages/
  shared/       Shared TS types
docker-compose.dev.yml    Local dev (mysql exposed, ports published)
docker-compose.prod.yml   VPS deploy (Traefik labels, internal-only)
```

## Ports (local)

- api: `4000`
- web: `3001` (not 3000 — VPS Metabase already uses 3000)
- mysql: `3306`

## Local dev

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
mkdir -p secrets
pnpm install
docker compose -f docker-compose.dev.yml up -d mysql
pnpm db:migrate
docker compose -f docker-compose.dev.yml up -d api web
curl http://localhost:4000/health
```

## VPS deployment context

- Hostinger VPS already runs Traefik on `n8n_default` network, cert resolver `mytlschallenge` (Let's Encrypt, TLS-ALPN).
- Subdomains: `api.sippzy.com` (api), `app.sippzy.com` (web).
- Metabase owns host port `3000` — do not publish 3000 from this project.
- Google Wallet SA key lives at `/docker/stampdeck/secrets/wallet-sa.json` on the VPS (chmod 600). Mounted into api as `/secrets/wallet-sa.json`. Never commit it.

## Google Wallet

- Issuer ID: `3388000000023150410`
- SA email: `wallet-issuer@sippzy-wallet.iam.gserviceaccount.com`

## Schema philosophy

`loyalty_programs.program_type` + `loyalty_programs.config_json` + `loyalty_cards.card_state` make the schema polymorphic across stamp / points / membership / multipass / discount / cashback / gift / coupon. Adding a card type = new shape in `packages/shared` + new business logic. No schema migration needed.

## Conventions

- Strict TS. No `any` in checked-in code.
- API is ESM (`"type": "module"`).
- Env validated with zod at startup.
- Multi-tenant: every query must filter by `merchant_id`.
- Secrets via env / mounted files only.
