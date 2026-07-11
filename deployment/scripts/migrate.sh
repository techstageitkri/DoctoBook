#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"

cd "${APP_DIR}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set before running migrations" >&2
  exit 1
fi

command -v pnpm >/dev/null 2>&1 || {
  echo "Missing required command: pnpm" >&2
  exit 1
}

echo "==> Generating Prisma client"
pnpm --filter @doctobook/database exec prisma generate

echo "==> Deploying Prisma migrations"
pnpm --filter @doctobook/database exec prisma migrate deploy

echo "Database migration completed"
