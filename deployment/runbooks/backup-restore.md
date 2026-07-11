# Backup And Restore Runbook

A backup is not verified until it has been restored into a separate database and the application can start against it.

## Targets

Define these before launch:

```text
RPO: maximum acceptable data loss
RTO: maximum acceptable recovery time
```

Initial MVP recommendation:

```text
RPO: 15 minutes or better where hosting supports point-in-time recovery
RTO: 4 hours or better
```

## PostgreSQL Logical Backup

```bash
export BACKUP_DIR=/var/backups/doctobook
mkdir -p "$BACKUP_DIR"

pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file="$BACKUP_DIR/doctobook-$(date +%Y%m%d-%H%M%S).dump"
```

Encrypt and copy backups to off-host storage:

```bash
gpg --symmetric --cipher-algo AES256 "$BACKUP_FILE"
aws s3 cp "$BACKUP_FILE.gpg" s3://<backup-bucket>/postgres/
```

Use equivalent object-storage tooling if not using AWS.

## Restore Into Test Database

Never restore directly into production as a first step.

```bash
createdb doctobook_restore_test
pg_restore \
  --dbname=postgresql://<user>:<password>@<host>:5432/doctobook_restore_test \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  "$BACKUP_FILE"
```

Then verify:

```bash
DATABASE_URL=postgresql://<user>:<password>@<host>:5432/doctobook_restore_test \
REDIS_URL=redis://<host>:6379 \
JWT_ACCESS_TOKEN_SECRET=test-access-token-secret \
JWT_REFRESH_TOKEN_SECRET=test-refresh-token-secret \
ENCRYPTION_KEY=test-encryption-key \
API_CORS_ORIGINS=https://doctobook.example.com \
pnpm --filter @doctobook/api start
```

Check `/health/ready` against the restored database.

## Object Storage

Doctor documents and private uploads must have:

- Versioning enabled
- Server-side encryption enabled
- Access logging where available
- Lifecycle policy matching retention requirements
- Restore test for at least one private document

## Redis Recovery

Redis stores queues and transient locks. PostgreSQL remains the source of truth.

If Redis is lost:

1. Restart Redis.
2. Restart `doctobook-api` and `doctobook-worker`.
3. Re-enqueue scheduled slot generation.
4. Verify hold expiration, refund processing, and notification reminder jobs exist.
5. Check for stale active holds and reconciliation-required payments.

## Migration Incident

If a migration fails:

1. Stop deployment.
2. Capture `prisma migrate status`.
3. Capture PostgreSQL logs.
4. Do not edit an applied migration file.
5. Create a new corrective migration or restore from backup if data integrity is affected.

## Restore Decision Checklist

- Has provider payment/refund state changed since backup time?
- Are there appointments created after backup time?
- Are object-storage files newer than the database backup?
- Can late webhooks be reconciled after restore?
- Has the business owner accepted the RPO data-loss window?
