# Log Retention And Alerts

DoctoBook emits structured JSON logs to stdout/stderr. PM2 writes process logs under `logs/` by default in `deployment/pm2/ecosystem.config.cjs`.

## Minimum Retention

- API logs: 30 days
- Worker logs: 30 days
- Web logs: 14 days
- Nginx access logs: 14 days
- Nginx error logs: 30 days
- Payment and refund incident exports: 180 days

Do not store raw provider secrets, cookies, authorization headers, reset tokens, or patient visit notes in log systems.

## PM2 Log Rotation

Install and configure `pm2-logrotate` on each production host:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
pm2 save
```

If logs are forwarded to a managed service, keep local retention short enough to avoid disk exhaustion.

## Fields To Preserve

Alerting and search should preserve:

```text
timestamp
level
service
environment
requestId
route
method
statusCode
durationMs
userId
role
queue
jobId
attempt
appointmentId
paymentId
refundId
provider
providerEventId
errorCode
```

## Required Alerts

- API readiness failure for 2 consecutive minutes
- API 5xx rate above normal baseline
- API p95 latency above agreed threshold
- PostgreSQL connectivity failure
- Redis connectivity failure
- Missing `worker.heartbeat` for 3 minutes
- BullMQ failed job spike
- BullMQ stalled job event
- Payment webhook verification failures above baseline
- Payment or refund reconciliation required
- Refund processing failures
- Notification failure spike
- Appointment reminder backlog above acceptable threshold

## Suggested Queries

Worker heartbeat:

```text
service=worker message=worker.heartbeat
```

Failed queue jobs:

```text
service=worker message=queue.job.failed
```

Payment webhook failures:

```text
service=api message=payment.webhook.verification_failed
```

Readiness failures:

```text
service=api message=api.readiness_failed
```
