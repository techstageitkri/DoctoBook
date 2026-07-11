#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${API_URL:-http://127.0.0.1:4001}"
WEB_URL="${WEB_URL:-http://127.0.0.1:3002}"
PUBLIC_URL="${PUBLIC_URL:-}"
RETRIES="${RETRIES:-20}"
SLEEP_SECONDS="${SLEEP_SECONDS:-3}"

command -v curl >/dev/null 2>&1 || {
  echo "Missing required command: curl" >&2
  exit 1
}

check_url() {
  local label="$1"
  local url="$2"
  local attempt

  for attempt in $(seq 1 "${RETRIES}"); do
    if curl --fail --silent --show-error --max-time 10 "${url}" >/dev/null; then
      echo "ok: ${label} ${url}"
      return 0
    fi

    echo "waiting: ${label} ${url} (${attempt}/${RETRIES})" >&2
    sleep "${SLEEP_SECONDS}"
  done

  echo "failed: ${label} ${url}" >&2
  return 1
}

check_pm2_process() {
  local name="$1"

  if ! command -v pm2 >/dev/null 2>&1; then
    echo "skip: pm2 not installed, cannot verify ${name}" >&2
    return 0
  fi

  pm2 describe "${name}" >/dev/null
  echo "ok: pm2 ${name}"
}

check_url "api live" "${API_URL}/health/live"
check_url "api ready" "${API_URL}/health/ready"
check_url "web home" "${WEB_URL}/"

if [[ -n "${PUBLIC_URL}" ]]; then
  check_url "public home" "${PUBLIC_URL}/"
  check_url "public api ready" "${PUBLIC_URL}/health/ready"
fi

check_pm2_process "doctobook-web"
check_pm2_process "doctobook-api"
check_pm2_process "doctobook-worker"

echo "Health checks completed"
