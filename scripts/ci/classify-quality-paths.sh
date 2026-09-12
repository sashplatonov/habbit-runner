#!/usr/bin/env bash
set -Eeuo pipefail

profile="${1:-incremental}"
case "$profile" in
  incremental|full) ;;
  *)
    echo "Unsupported quality profile: $profile" >&2
    exit 2
    ;;
esac

: "${GITHUB_OUTPUT:?GITHUB_OUTPUT must point to an output file}"

backend=false
frontend=false
security=false
smoke=false

if [[ "$profile" == "full" ]]; then
  backend=true
  frontend=true
  security=true
  smoke=true
else
  event_name="${EVENT_NAME:?EVENT_NAME is required for incremental classification}"
  before_sha="${BEFORE_SHA:-}"
  base_sha="${BASE_SHA:-}"
  head_sha="${HEAD_SHA:?HEAD_SHA is required for incremental classification}"

  if [[ "$event_name" == "pull_request" ]]; then
    [[ -n "$base_sha" ]] || { echo 'BASE_SHA is required for pull_request events' >&2; exit 1; }
    changed_files="$(git diff --name-only "$base_sha" "$head_sha")"
  elif [[ "$before_sha" =~ ^0+$ ]] || ! git cat-file -e "$before_sha^{commit}" 2>/dev/null; then
    changed_files="$(git diff-tree --no-commit-id --name-only -r "$head_sha")"
  else
    changed_files="$(git diff --name-only "$before_sha" "$head_sha")"
  fi

  has_path() {
    grep -Eq "$1" <<<"$changed_files"
  }

  if has_path '^(apps/backend/|spec/openapi/|\.github/workflows/|\.github/renovate\.json|pom\.xml)'; then
    backend=true
  fi
  if has_path '^(apps/web/|\.github/workflows/|\.github/renovate\.json|package(-lock)?\.json)'; then
    frontend=true
  fi
  if has_path '^(apps/(backend|web)/|docker-compose|apps/.*/Dockerfile|\.github/|package(-lock)?\.json|pom\.xml|spec/openapi/|scripts/ci/)'; then
    security=true
  fi
  if has_path '^(apps/backend/|apps/web/(Dockerfile|tests/e2e/stack-contract\.spec\.ts)|docker-compose|apps/.*/Dockerfile|scripts/ci/|\.github/workflows/|\.github/renovate\.json|spec/openapi/|pom\.xml|package(-lock)?\.json)'; then
    smoke=true
  fi

  # Runtime/build-boundary changes must exercise every dependent quality lane.
  if has_path '^(docker-compose|apps/.*/Dockerfile|scripts/ci/|\.github/workflows/|\.github/renovate\.json)'; then
    backend=true
    frontend=true
    security=true
    smoke=true
  fi
fi

for output in backend frontend security smoke; do
  value="${!output}"
  [[ "$value" == true || "$value" == false ]] || { echo "Invalid $output output" >&2; exit 1; }
  printf '%s=%s\n' "$output" "$value" >> "$GITHUB_OUTPUT"
done
