#!/usr/bin/env bash
# fetch_gcp_secrets.sh — pull secrets from GCP Secret Manager into $GITHUB_ENV.
#
# Usage (inside a GitHub Actions step, after google-github-actions/auth@v3):
#
#   source scripts/fetch_gcp_secrets.sh
#   fetch_to_env PUSHOVER_USER         pushover-user PUSHOVER_USER pushover_user
#   fetch_to_env PUSHOVER_TOKEN        pushover-token PUSHOVER_TOKEN pushover_token
#   fetch_to_env ANTHROPIC_ADMIN_KEY   anthropic-admin-key anthropic-api-key
#
# Each call tries each candidate secret name in GCP Secret Manager and uses
# the first one that exists. Missing → logged warning, env var stays unset
# (the downstream script handles missing creds gracefully).
#
# Project resolution (in priority order):
#   1. $GCP_PROJECT env var (if set by the workflow)
#   2. $GOOGLE_CLOUD_PROJECT or $CLOUDSDK_CORE_PROJECT (gcloud convention)
#   3. The compiled-in default GCP_PROJECT_DEFAULT below
#
# `google-github-actions/auth@v3` does NOT set the gcloud default project on
# its own. Without an explicit --project, `gcloud secrets versions access`
# fails silently (returns no rows). This script ALWAYS passes --project.
#
# Requires:
#   - gcloud authenticated to the right GCP project (google-github-actions/auth@v3)
#   - The active service account has roles/secretmanager.secretAccessor

set -euo pipefail

# Default GCP project for Latimer-Woods-Tech Factory.
# Override per-workflow by setting GCP_PROJECT before sourcing this script.
GCP_PROJECT_DEFAULT="factory-495015"
GCP_PROJECT="${GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-${CLOUDSDK_CORE_PROJECT:-$GCP_PROJECT_DEFAULT}}}"
echo "ℹ️  fetch_gcp_secrets.sh: project=$GCP_PROJECT"

# Diagnostic: report the active identity so 'not found' errors can be traced
# to (a) wrong service account, (b) missing IAM, or (c) genuinely-absent secret.
ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null || echo unknown)"
echo "ℹ️  fetch_gcp_secrets.sh: active_account=$ACTIVE_ACCOUNT"

fetch_to_env() {
  local target_env="$1"
  shift
  local name first_err=""
  for name in "$@"; do
    # Capture stderr so a real error (permission, not-found, network) is
    # surfaced on the first attempt — but only LOG it; still iterate to the
    # next candidate name in case it's just the wrong key.
    if value=$(gcloud secrets versions access latest \
                  --secret="$name" \
                  --project="$GCP_PROJECT" \
                  --quiet 2>/tmp/.fetch_err); then
      # Strip leading UTF-8 BOM (\xEF\xBB\xBF) and trim trailing whitespace.
      # Several secrets in factory-495015 were stored from Windows editors
      # that prepended a BOM; the byte is invisible in most UIs but breaks
      # Python's latin-1/ascii encoding for HTTP headers
      # ('latin-1 codec can't encode character ﻿ in position 7').
      value="$(printf '%s' "$value" | sed $'1s/^\xEF\xBB\xBF//' | sed -E 's/[[:space:]]+$//')"
      echo "::add-mask::$value"
      {
        printf '%s<<__LWT_SECRET_EOF__\n' "$target_env"
        printf '%s\n' "$value"
        printf '__LWT_SECRET_EOF__\n'
      } >> "${GITHUB_ENV:-/dev/stdout}"
      echo "✅ $target_env ← $name"
      return 0
    fi
    # Save the FIRST error encountered for diagnostic output below.
    if [ -z "$first_err" ] && [ -s /tmp/.fetch_err ]; then
      first_err="$(head -c 200 /tmp/.fetch_err | tr '\n' ' ')"
    fi
  done
  echo "⚠️  $target_env not found in GCP Secret Manager project=$GCP_PROJECT (tried: $*)"
  [ -n "$first_err" ] && echo "    first_err: $first_err"
  return 0  # never fail the workflow on a missing secret; let the script decide
}
