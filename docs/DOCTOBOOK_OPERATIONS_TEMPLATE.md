# DoctoBook Operations Template

> TEMPLATE ONLY — DO NOT PUT LIVE CREDENTIALS IN THIS FILE.
>
> Keep the real master reference in `docs/private/DOCTOBOOK_MASTER_REFERENCE.md`, which must stay ignored by Git.

## 1. Document Metadata

| Field | Value |
| --- | --- |
| Document creation date | `<date>` |
| Last updated date | `<date>` |
| Prepared by | `<name/team>` |
| Project version | `<version>` |
| Environment | `<staging/production>` |
| Deployed commit | `<git-sha>` |
| Confidentiality | Replace placeholders in a private, ignored document only. |

## 2. Project Overview

| Field | Value |
| --- | --- |
| Project name | DoctoBook |
| Company name | `<company>` |
| Business purpose | Doctor booking marketplace and clinic operations platform. |
| Supported roles | Super Admin, Clinic Admin, Doctor, Receptionist, Patient |
| Main modules | Auth, RBAC, clinics, doctors, services, availability, slots, booking, payments, appointments, rescheduling, refunds, notifications, reviews, reports |
| Completed features | `<summary>` |
| Pending features | `<summary>` |

Workflow:

```text
patient registration
→ doctor onboarding
→ clinic management
→ services
→ availability
→ slots
→ booking
→ payments
→ appointments
→ rescheduling
→ refunds
→ notifications
→ reviews
→ reports
→ admin operations
```

## 3. Source-Code Repository

| Field | Value |
| --- | --- |
| GitHub repository URL | `<repo-url>` |
| Repository visibility | `<public/private>` |
| Default branch | `<branch>` |
| Current deployed commit | `<git-sha>` |
| Local repository path | `<local-path>` |
| Server repository path | `<server-path>` |
| Deployment branch | `<branch>` |
| GitHub organisation/account | `<owner>` |
| GitHub authentication method | `<https/deploy-key/token>` |
| Token/deploy-key details | `<store actual values only in private reference>` |

```bash
git clone <repo-url> doctobook
cd doctobook
git pull --ff-only origin <branch>
git push origin <branch>
```

## 4. Monorepo Structure

| Path | Purpose | Build | Start | Test | Important config |
| --- | --- | --- | --- | --- | --- |
| `apps/web` | Next.js web app | `pnpm --filter @doctobook/web build` | `pnpm --filter @doctobook/web exec next start -H $WEB_HOST -p $WEB_PORT` | `<command>` | `next.config.ts`, root `.env` |
| `apps/api` | NestJS API | `pnpm --filter @doctobook/api build` | `pnpm --filter @doctobook/api start` | `<command>` | `src/main.ts`, config package |
| `apps/worker` | BullMQ worker | `pnpm --filter @doctobook/worker build` | `pnpm --filter @doctobook/worker start` | `<command>` | worker processors |
| `apps/e2e` | Playwright tests | N/A | N/A | `pnpm --filter @doctobook/e2e test` | `playwright.config.ts` |
| `packages/database` | Prisma schema, migrations, seeds, fixtures | `<command>` | N/A | `<command>` | `prisma/schema.prisma` |
| `packages/shared` | Shared enums/types | `<command>` | N/A | `<command>` | `src/index.ts` |
| `packages/config` | Environment validation | `<command>` | N/A | `<command>` | `src/index.ts` |
| `packages/slots` | Slot generation logic | `<command>` | N/A | `<command>` | `src/index.ts` |
| `packages/payments` | Payment providers | `<command>` | N/A | `<command>` | `src/index.ts` |
| `packages/notifications` | Notification providers | `<command>` | N/A | `<command>` | `src/providers.ts` |
| `packages/observability` | Logging/redaction | `<command>` | N/A | `<command>` | `src/index.ts` |
| `deployment` | PM2, Nginx, scripts, runbooks | N/A | PM2/Nginx | health checks | `deployment/*` |
| `docs` | Project docs | N/A | N/A | manual review | `docs/private/` ignored |

## 5. Technology Stack

Record actual versions in the private reference.

```bash
cat /etc/os-release
uname -a
node --version
npm --version
corepack --version
pnpm --version
pm2 --version
nginx -v
psql --version
redis-cli --version
certbot --version
pnpm list --depth 0
```

## 6. Server Details

| Field | Value |
| --- | --- |
| Provider | `<provider>` |
| Public IP | `<ip>` |
| Hostname | `<hostname>` |
| SSH command | `ssh <user>@<host>` |
| SSH username | `<user>` |
| SSH password | `<private reference only>` |
| SSH key details | `<private reference only>` |
| OS/timezone | `<values>` |
| CPU/RAM/disk/swap | `<values>` |
| Repository directory | `<path>` |
| Sudo/root method | `<private reference only>` |

## 7. Existing Non-DoctoBook Services

> Do not stop, restart, delete, change, or reuse existing service ports during DoctoBook deployment.

| Process | Port | Binding | Directory | Start command | Purpose | Dependencies |
| --- | --- | --- | --- | --- | --- | --- |
| `<existing-service>` | `<port>` | `<binding>` | `<path>` | `<command>` | `<purpose>` | `<dependencies>` |

## 8. Network Ports

| Port | Purpose | Binding | Public/private | Process | Firewall expectation | Nginx routing |
| --- | --- | --- | --- | --- | --- | --- |
| `22` | SSH | `<binding>` | Public | SSH | restricted | none |
| `80` | HTTP | `<binding>` | Public | Nginx | open | ACME/redirect |
| `443` | HTTPS | `<binding>` | Public | Nginx | open | app routes |
| `<web-port>` | DoctoBook web | `127.0.0.1:<port>` | Private | web | blocked publicly | `/` |
| `<api-port>` | DoctoBook API | `127.0.0.1:<port>` | Private | API | blocked publicly | `/v1`, `/health` |
| `5432` | PostgreSQL | `127.0.0.1:5432` | Private | PostgreSQL | blocked publicly | none |
| `6379` | Redis | `127.0.0.1:6379` | Private | Redis | blocked publicly | none |

## 9. DNS

| Field | Value |
| --- | --- |
| Domain | `<domain>` |
| Record type | `A` |
| Host/name | `<subdomain>` |
| IP/value | `<ip>` |
| TTL | `<ttl>` |
| DNS provider | `<provider>` |
| DNS credentials/API token | `<private reference only>` |

## 10. Nginx

| Field | Value |
| --- | --- |
| Version | `<version>` |
| Main config | `/etc/nginx/nginx.conf` |
| Site available | `<path>` |
| Site enabled | `<path>` |
| server_name | `<domain>` |
| Web upstream | `127.0.0.1:<web-port>` |
| API upstream | `127.0.0.1:<api-port>` |
| Health routes | `/health/live`, `/health/ready` |
| Webhook routes | `/v1/payments/webhooks/<provider>` |
| Logs | `<paths>` |

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart nginx
sudo journalctl -u nginx
```

## 11. TLS and Certbot

| Field | Value |
| --- | --- |
| Certificate domain | `<domain>` |
| Issuer | Let's Encrypt or provider |
| Certificate paths | `<paths>` |
| Private key path | `<path only; raw key in encrypted private appendix>` |
| Expiry date | `<date>` |
| Renewal method | `<method>` |
| Certbot version | `<version>` |

```bash
sudo certbot certificates
sudo certbot renew --dry-run
```

## 12. PM2

| Field | Value |
| --- | --- |
| PM2 version | `<version>` |
| PM2_HOME | `<path>` |
| PM2 binary | `<path>` |
| Systemd service | `<name>` |
| Ecosystem path | `<path>` |
| Environment loading method | `<method>` |

| Process | Status | Host/port | Working directory | Start command | Env file | Log paths |
| --- | --- | --- | --- | --- | --- | --- |
| `doctobook-web` | `<status>` | `<host:port>` | `<path>` | `<command>` | `<path>` | `<paths>` |
| `doctobook-api` | `<status>` | `<host:port>` | `<path>` | `<command>` | `<path>` | `<paths>` |
| `doctobook-worker` | `<status>` | N/A | `<path>` | `<command>` | `<path>` | `<paths>` |

## 13. Complete Environment

Copy the full real `.env` only into the private reference.

```dotenv
NODE_ENV=<environment>
DATABASE_URL=<private>
REDIS_URL=<private>
API_HOST=127.0.0.1
API_PORT=<port>
WEB_HOST=127.0.0.1
WEB_PORT=<port>
NEXT_PUBLIC_API_URL=<url>
API_CORS_ORIGINS=<url>
PAYMENT_PROVIDER=<provider>
EMAIL_PROVIDER=<provider>
SMS_PROVIDER=<provider>
PUSH_PROVIDER=<provider>
```

## 14. Authentication Credentials

| Field | Value |
| --- | --- |
| JWT/access/refresh/session secrets | `<private reference only>` |
| Cookie settings | `<values>` |
| CSRF settings | `<values>` |
| Allowed origins | `<values>` |
| Super Admin email/password | `<private reference only>` |
| Credential file | `<path>` |
| Login URL | `<url>` |

## 15. PostgreSQL

| Field | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `5432` |
| Database | `<database>` |
| Username | `<username>` |
| Password | `<private reference only>` |
| DATABASE_URL | `<private reference only>` |
| Version | `<version>` |
| Data directory | `<path>` |
| Authentication | SCRAM/password |

Extensions:

```text
pgcrypto
citext
btree_gist
pg_trgm
```

## 16. Redis

| Field | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `6379` |
| Password | `<private reference only or none>` |
| REDIS_URL | `<private reference only>` |
| Version | `<version>` |
| Binding | `<binding>` |
| Persistence | `<config>` |

## 17. Payment Provider

| Field | Value |
| --- | --- |
| PAYMENT_PROVIDER | `<provider>` |
| PayHere Merchant ID | `<private reference only>` |
| PayHere Merchant Secret | `<private reference only>` |
| PayHere App ID | `<private reference only>` |
| PayHere App Secret | `<private reference only>` |
| Checkout URL | `<url>` |
| Notify URL | `<url>` |
| Return URL | `<url>` |
| Cancel URL | `<url>` |
| Webhook route | `/v1/payments/webhooks/payhere` |
| Mode | `<sandbox/live>` |

## 18. Email and SMTP

| Field | Value |
| --- | --- |
| EMAIL_PROVIDER | `<provider>` |
| SMTP_HOST | `<host>` |
| SMTP_PORT | `<port>` |
| SMTP_SECURE | `<true/false/starttls>` |
| SMTP_USERNAME | `<private reference only>` |
| SMTP_PASSWORD | `<private reference only>` |
| SMTP_FROM_EMAIL | `<email>` |
| SMTP_FROM_NAME | `<name>` |

## 19. SMS

| Field | Value |
| --- | --- |
| SMS_PROVIDER | `<provider/mock>` |
| TWILIO_ACCOUNT_SID | `<private reference only>` |
| TWILIO_AUTH_TOKEN | `<private reference only>` |
| TWILIO_FROM_NUMBER | `<number>` |
| Generic HTTP URL/token | `<private reference only>` |
| Validation status | `<status>` |

## 20. Firebase/FCM

| Field | Value |
| --- | --- |
| PUSH_PROVIDER | `<provider/mock>` |
| Firebase project ID | `<id>` |
| Firebase client email | `<email>` |
| Firebase private key | `<encrypted appendix or private reference only>` |
| Service-account JSON | `<encrypted appendix or private reference only>` |
| Validation status | `<status>` |

## 21. Storage and Uploads

| Field | Value |
| --- | --- |
| Provider | `<provider>` |
| Bucket | `<bucket>` |
| Region | `<region>` |
| Endpoint | `<endpoint>` |
| Access key | `<private reference only>` |
| Secret key | `<private reference only>` |
| Public/private setting | Private for protected documents |
| Signed URL expiry | `<duration>` |
| Upload limits/types | `<values>` |

## 22. E2E Credentials and Fixtures

Record real fixture credentials only in the private reference.

```bash
ALLOW_E2E_FIXTURES=true pnpm --filter @doctobook/database fixture:booking-e2e
ALLOW_E2E_FIXTURE_CLEANUP=true pnpm --filter @doctobook/database fixture:booking-e2e:cleanup
E2E_RUN=true E2E_BASE_URL=<url> E2E_API_URL=<url> pnpm --filter @doctobook/e2e test
```

Fixture services:

```text
E2E_GENERAL_CONSULTATION
E2E_ONLINE_CONSULTATION
```

## 23. Database Seed

```bash
pnpm --filter @doctobook/database prisma:seed
```

Seed covers roles, permissions, settings, specialties, services, templates, and optional Super Admin.

## 24. Deployment Procedure

```bash
cd <repo-path>
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
set -a
. ./.env
set +a
pnpm build
pnpm --filter @doctobook/database prisma migrate deploy
pnpm --filter @doctobook/database prisma:seed
pm2 start deployment/pm2/ecosystem.config.cjs --env production
pm2 save
```

Include pre-deployment backup, migration checks, seed checks, PM2 reload strategy, Nginx verification, health verification, log inspection, and rollback notes in the private reference.

## 25. Backup and Restore

| Field | Value |
| --- | --- |
| Backup directory | `<path>` |
| Latest backup | `<path>` |
| Backup DB user | `<username>` |
| Backup command | `<command>` |
| Checksum command | `<command>` |
| Restore command | `<command>` |
| Restore-test database | `<name>` |
| Restore-test API port | `<port>` |
| Cleanup procedure | `<steps>` |

## 26. Monitoring and Logs

Record actual log paths and provider health endpoints in the private reference.

```bash
pm2 logs doctobook-api --lines 100
pm2 logs doctobook-web --lines 100
pm2 logs doctobook-worker --lines 100
curl -f <url>/health/live
curl -f <url>/health/ready
```

Redact authorization, cookies, passwords, tokens, provider secrets, and patient-sensitive data.

## 27. E2E Results

| Field | Value |
| --- | --- |
| Playwright version | `<version>` |
| Browser dependencies | `<status>` |
| Current result | `<summary>` |
| Validated flows | `<list>` |

## 28. Completed Git Commits

| Hash | Message | Purpose | Deployment relevance |
| --- | --- | --- | --- |
| `<hash>` | `<message>` | `<purpose>` | `<relevance>` |

Use:

```bash
git log --oneline --decorate
```

## 29. Pending Work

```text
SMS validation
Firebase validation
Worker restart/recovery evidence
Final operations evidence report
Provider secret rotation
Production provider credentials
Production database
Production storage
Production DNS/TLS
Load testing
Final launch approval
Known certificate or renewal issues
```

## 30. Production Launch Checklist

```text
[ ] Production server
[ ] Production domain
[ ] Database
[ ] Redis
[ ] Backups
[ ] Restore test
[ ] PayHere live approval
[ ] Provider secret rotation
[ ] SMTP
[ ] SMS
[ ] FCM
[ ] Storage
[ ] Firewall
[ ] Port binding
[ ] Nginx
[ ] TLS
[ ] Monitoring
[ ] Alerts
[ ] E2E
[ ] Load test
[ ] Security test
[ ] Final approval
```

## 31. Rebuild-From-Scratch Procedure

```text
Provision server
Install runtime
Clone repository
Create database
Configure Redis
Create .env
Build
Migrate
Seed
Start PM2
Configure Nginx
Configure TLS
Restore data
Validate providers
Run E2E
Run health checks
```

## Private-Key Appendix Template

Keep raw SSH/TLS/server private keys out of ordinary Markdown. Store them in an encrypted ignored appendix.

| Field | Value |
| --- | --- |
| Encrypted file path | `docs/private/DOCTOBOOK_PRIVATE_KEYS.md.age` |
| Encryption method | `age` or approved equivalent |
| Decryption command | `<command>` |
| Key fingerprint | `<fingerprint>` |
| Key purpose | `<purpose>` |
| Associated public key | `<public key/cert>` |
| Original server path | `<path>` |
