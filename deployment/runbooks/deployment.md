# Deployment Runbook

This runbook describes a single-host PM2 and Nginx deployment for the web MVP.

## Prerequisites

- Node.js version compatible with the lockfile
- `pnpm` matching `packageManager` in `package.json`
- PM2 installed globally
- Nginx installed and TLS configured
- PostgreSQL 16 reachable from the API and worker
- Redis reachable from the API and worker
- Object storage and provider credentials configured where enabled

## Required Environment

Export production secrets before starting PM2. Do not commit these values.

```bash
export NODE_ENV=production
export DATABASE_URL='postgresql://...'
export REDIS_URL='redis://...'
export JWT_ACCESS_TOKEN_SECRET='...'
export JWT_REFRESH_TOKEN_SECRET='...'
export ENCRYPTION_KEY='...'
export WEB_HOST='127.0.0.1'
export WEB_PORT='3002'
export API_HOST='127.0.0.1'
export API_PORT='4001'
export API_CORS_ORIGINS='https://doctobook.example.com'
export API_TRUST_PROXY=true
export NEXT_PUBLIC_API_URL='https://doctobook.example.com'
export WEB_PUBLIC_URL='https://doctobook-staging.techstageit.com'
```

Add payment, email, SMS, and Firebase variables only when the corresponding provider is enabled.

## First-Time Server Setup

```bash
mkdir -p logs
pnpm install --frozen-lockfile --prod=false
pnpm build
deployment/scripts/migrate.sh
pm2 start deployment/pm2/ecosystem.config.cjs --update-env
pm2 save
pm2 startup
```

Install Nginx config:

```bash
sudo cp deployment/nginx/doctobook.conf /etc/nginx/sites-available/doctobook.conf
sudo ln -s /etc/nginx/sites-available/doctobook.conf /etc/nginx/sites-enabled/doctobook.conf
sudo nginx -t
sudo systemctl reload nginx
```

Set `API_TRUST_PROXY=true` because Nginx forwards client IP and scheme to NestJS. If more proxies are added, document the trusted hop chain before changing this value.

## Standard Deployment

```bash
RELEASE_REF=<tag-or-commit> deployment/scripts/deploy.sh
```

The deployment script runs:

```text
git fetch
checkout optional release ref
pnpm install --frozen-lockfile --prod=false
pnpm lint
pnpm typecheck
pnpm test
pnpm build
prisma migrate deploy
pm2 reload
health checks
```

Reference-data seeds are not run automatically during production deployment.

## Post-Deploy Verification

```bash
deployment/scripts/health-check.sh
pm2 status
pm2 logs doctobook-api --lines 50
pm2 logs doctobook-worker --lines 50
```

Verify:

- `GET /health/live`
- `GET /health/ready`
- Patient homepage
- Admin session restoration
- Worker heartbeat logs
- Redis queue connectivity
- Payment webhook endpoint reachable from provider sandbox

## Release Notes

Record for every release:

- Git commit or tag
- Migration names applied
- Provider configuration changes
- Manual operational actions
- Verification owner and timestamp
