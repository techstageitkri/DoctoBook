#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
RELEASE_REF="${RELEASE_REF:-}"
ECOSYSTEM_FILE="${ECOSYSTEM_FILE:-${APP_DIR}/deployment/pm2/ecosystem.config.cjs}"

cd "${APP_DIR}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_command git
require_command pnpm
require_command pm2

echo "==> Fetching repository"
git fetch --all --prune

if [[ -n "${RELEASE_REF}" ]]; then
  echo "==> Checking out release ${RELEASE_REF}"
  git checkout "${RELEASE_REF}"
fi

echo "==> Installing dependencies"
pnpm install --frozen-lockfile --prod=false

echo "==> Running lint"
pnpm lint

echo "==> Running typecheck"
pnpm typecheck

echo "==> Running tests"
pnpm test

echo "==> Building applications"
pnpm build

echo "==> Applying database migrations"
"${SCRIPT_DIR}/migrate.sh"

echo "==> Reloading PM2 processes"
mkdir -p "${APP_DIR}/logs"
pm2 startOrReload "${ECOSYSTEM_FILE}" --update-env
pm2 save

echo "==> Running health checks"
"${SCRIPT_DIR}/health-check.sh"

echo "Deployment completed"
