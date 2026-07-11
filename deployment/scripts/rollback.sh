#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
ROLLBACK_REF="${ROLLBACK_REF:-}"
ECOSYSTEM_FILE="${ECOSYSTEM_FILE:-${APP_DIR}/deployment/pm2/ecosystem.config.cjs}"

if [[ -z "${ROLLBACK_REF}" ]]; then
  echo "ROLLBACK_REF is required, for example: ROLLBACK_REF=v1.2.3 $0" >&2
  exit 1
fi

cd "${APP_DIR}"

command -v git >/dev/null 2>&1 || {
  echo "Missing required command: git" >&2
  exit 1
}
command -v pnpm >/dev/null 2>&1 || {
  echo "Missing required command: pnpm" >&2
  exit 1
}
command -v pm2 >/dev/null 2>&1 || {
  echo "Missing required command: pm2" >&2
  exit 1
}

CURRENT_REF="$(git rev-parse --short HEAD)"

echo "==> Rolling back from ${CURRENT_REF} to ${ROLLBACK_REF}"
git fetch --all --prune
git checkout "${ROLLBACK_REF}"

echo "==> Installing dependencies"
pnpm install --frozen-lockfile --prod=false

echo "==> Building rollback target"
pnpm build

if [[ "${RUN_MIGRATIONS_ON_ROLLBACK:-false}" == "true" ]]; then
  echo "==> Applying forward-compatible migrations for rollback target"
  "${SCRIPT_DIR}/migrate.sh"
else
  echo "==> Skipping migrations during rollback"
  echo "    Prisma migrations are forward-only. Review database state before forcing migration changes."
fi

echo "==> Reloading PM2 processes"
pm2 startOrReload "${ECOSYSTEM_FILE}" --update-env
pm2 save

echo "==> Running health checks"
"${SCRIPT_DIR}/health-check.sh"

echo "Rollback completed from ${CURRENT_REF} to ${ROLLBACK_REF}"
