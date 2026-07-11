# Payment Reconciliation Runbook

Use this runbook when payment or refund state differs between DoctoBook and the provider.

## Signals

- `payment.webhook.verification_failed`
- Reconciliation-required payment or refund in admin panel
- Successful provider payment with local pending appointment
- Local successful payment missing provider confirmation
- Refund stuck in `processing`
- Provider refund completed manually outside DoctoBook

## Immediate Checks

Search logs by:

```text
paymentId
refundId
appointmentId
providerEventId
providerPaymentId
providerRefundId
requestId
```

Check:

- `payments.status`
- `payments.provider_payment_id`
- `payment_webhook_events.processed_at`
- `refunds.status`
- `refund_status_history`
- appointment status and slot hold status

## PayHere Webhook Verification Failure

1. Confirm merchant ID and secret match the active environment.
2. Confirm provider is posting to `/v1/payments/webhooks/payhere`.
3. Compare provider amount and currency with local payment snapshot.
4. Check whether the webhook was replayed, delayed, or sent from sandbox to production.
5. Do not manually mark a payment successful from browser return parameters.

## Payment Reconciliation

If provider confirms success but local status is not successful:

1. Verify provider reference, amount, currency, and order ID.
2. Check duplicate webhook event records.
3. Confirm appointment or reschedule request is still valid.
4. If domain state cannot be safely applied automatically, mark reconciliation required and resolve through an audited admin action.

## Refund Recovery

For failed or uncertain refunds:

1. Open Admin Refund Recovery.
2. Check provider response and status history.
3. If retryable, use admin retry. The retry must reuse the existing refund record.
4. If completed manually in provider portal, use manual completion with provider reference and reason.
5. Confirm total successful and processing refunds do not exceed the successful payment amount.

## Patient Communication

Send patient notification after:

- Payment confirmation
- Payment failure
- Refund requested
- Refund completed
- Refund failed or delayed requiring manual follow-up

Never include provider secrets, internal webhook payloads, or full payment metadata in patient communication.
