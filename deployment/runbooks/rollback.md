# Rollback Runbook

Application rollback is supported by checking out a previous Git ref, rebuilding, and reloading PM2.

Database migrations are forward-only. Do not assume application rollback reverses schema changes.

## When To Roll Back

- Deployment health checks fail
- Critical booking, payment, or authentication flow is broken
- Worker jobs are failing repeatedly after deployment
- Provider webhook processing becomes unreliable

## Before Rolling Back

Capture current state:

```bash
git rev-parse HEAD
pm2 status
pm2 logs doctobook-api --lines 100
pm2 logs doctobook-worker --lines 100
pnpm --filter @doctobook/database exec prisma migrate status
```

Check whether the release applied migrations. If migrations changed tables used by the previous application version, prefer a hotfix over rollback unless the rollback target is known compatible.

## Roll Back Application

```bash
ROLLBACK_REF=<previous-tag-or-commit> deployment/scripts/rollback.sh
```

By default, rollback does not run migrations. To apply forward-compatible migrations for the rollback target:

```bash
RUN_MIGRATIONS_ON_ROLLBACK=true ROLLBACK_REF=<previous-tag-or-commit> deployment/scripts/rollback.sh
```

## Post-Rollback Checks

```bash
deployment/scripts/health-check.sh
pm2 status
```

Verify:

- API readiness is healthy
- Web homepage loads
- Worker heartbeat logs resume
- Payment webhooks are still accepted
- Booking and login flows are not regressed

## If Rollback Fails

1. Stop traffic at Nginx or upstream load balancer.
2. Restore the last known good application ref.
3. If database corruption or incompatible migrations are suspected, follow `backup-restore.md`.
4. Preserve logs and migration status for incident review.
