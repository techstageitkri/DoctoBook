# DoctoBook E2E Tests

This package contains production-oriented Playwright tests for staging and launch validation.

The suite is disabled by default to avoid accidentally mutating a shared environment. Enable it explicitly:

```bash
E2E_RUN=true pnpm --filter @doctobook/e2e test
```

## Required URLs

```bash
export E2E_BASE_URL=https://staging-doctobook.example.com
export E2E_API_URL=https://staging-doctobook.example.com
export E2E_TRUSTED_ORIGIN=https://staging-doctobook.example.com
```

For local validation:

```bash
export E2E_BASE_URL=http://127.0.0.1:3000
export E2E_API_URL=http://127.0.0.1:4000
export E2E_TRUSTED_ORIGIN=http://127.0.0.1:3000
```

## Smoke Checks

Smoke checks cover:

- API live and readiness endpoints
- Web homepage rendering
- Public marketplace response shape
- Public doctor response does not expose sensitive fields

Run:

```bash
E2E_RUN=true pnpm --filter @doctobook/e2e test -- health-and-smoke.spec.ts
```

## Auth Security Checks

Requires a verified patient test account:

```bash
export E2E_PATIENT_EMAIL=e2e.patient@example.test
export E2E_PATIENT_PASSWORD='Password123!'
E2E_RUN=true pnpm --filter @doctobook/e2e test -- auth-session-security.spec.ts
```

This validates:

- Login sets an HttpOnly refresh cookie
- Refresh rotates the refresh cookie
- Refresh tokens are not returned in JSON
- `/v1/auth/me` works with the access token
- Untrusted cookie-authenticated mutations are rejected
- Logout clears the refresh cookie

## Mutating Booking Journey

Requires a staging-only doctor/service fixture with available future slots:

```bash
export E2E_PATIENT_EMAIL=e2e.patient@example.test
export E2E_PATIENT_PASSWORD='Password123!'
export E2E_DOCTOR_ID=<approved-doctor-id>
export E2E_SERVICE_ID=<service-id>
export E2E_BOOKING_DATE=2026-07-20

E2E_RUN=true E2E_MUTATING=true pnpm --filter @doctobook/e2e test -- patient-booking-journey.spec.ts
```

This creates a real staging appointment. Use only disposable staging data.

## Provider Negative Checks

Run only when rejected webhook records are acceptable in the target environment:

```bash
E2E_RUN=true E2E_PROVIDER_NEGATIVE=true pnpm --filter @doctobook/e2e test -- provider-and-security-negative.spec.ts
```

This validates invalid webhook rejection and sanitized 404 responses.

## Browser Artifacts

Failed tests write artifacts to:

```text
apps/e2e/test-results/
apps/e2e/playwright-report/
```

These folders are ignored by Git.
