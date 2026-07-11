# Worker Recovery Runbook

The worker is responsible for:

- Slot generation
- Payment initiation
- Refund processing
- Notification delivery
- Appointment reminders
- Payment hold expiration

Do not run these jobs from the web or API process.

## Detecting Worker Failure

Signals:

- Missing `worker.heartbeat` for 3 minutes
- `queue.job.failed` spike
- `queue.event.stalled`
- Reminder backlog increasing
- Payment holds not expiring
- Refunds stuck in `requested` or `processing`

Commands:

```bash
pm2 status doctobook-worker
pm2 logs doctobook-worker --lines 100
```

## Restart Worker

```bash
pm2 restart doctobook-worker --update-env
deployment/scripts/health-check.sh
```

Confirm `worker.heartbeat` resumes and queue counts are decreasing.

## Redis Connectivity Failure

1. Check Redis service health.
2. Restart Redis if needed.
3. Restart `doctobook-api` and `doctobook-worker`.
4. Watch worker logs for queue event errors.
5. Re-run slot generation for affected associations if schedule changes occurred during outage.

## Stalled Or Failed Jobs

BullMQ jobs are designed to be idempotent where financially or operationally sensitive.

Safe recovery checks:

- Payment initiation reuses existing payment records.
- Refund processing reuses existing refund records.
- Notification dispatch uses idempotent notification logs.
- Slot generation can regenerate future unbooked slots.
- Hold expiration reads current database state before expiring.

If jobs fail repeatedly:

1. Identify `queue`, `jobId`, `paymentId`, `refundId`, or `notificationLogId`.
2. Fix configuration or provider dependency first.
3. Restart worker.
4. Retry only through application-approved retry paths for payments/refunds.

## Reminder Backlog

If appointment reminders are delayed:

1. Check notification provider health.
2. Check `notification-dispatch` queue counts.
3. Confirm reminder schedule job exists.
4. Restart worker.
5. Do not bulk-send stale reminders without product approval.

## Slot Generation Backlog

If slot generation is delayed:

1. Confirm doctor and clinic changes are still saved in PostgreSQL.
2. Restart worker.
3. Trigger regeneration from admin slot-generation endpoint for affected clinic or association.
4. Verify public availability search after regeneration.
