#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
classifier="$script_dir/classify-quality-paths.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

git -C "$tmp_dir" init -q
git -C "$tmp_dir" config user.email ci@example.test
git -C "$tmp_dir" config user.name 'CI Test'
printf 'base\n' > "$tmp_dir/README.txt"
git -C "$tmp_dir" add .
git -C "$tmp_dir" commit -qm base
base_sha="$(git -C "$tmp_dir" rev-parse HEAD)"

assert_outputs() {
  local expected="$1"
  local output="$tmp_dir/output"
  : > "$output"
  (cd "$tmp_dir" && GITHUB_OUTPUT="$output" "$classifier" "${PROFILE:-incremental}")
  diff -u <(printf '%s\n' "$expected") "$output"
}

run_fixture() {
  local path="$1"
  local content="$2"
  local expected="$3"
  mkdir -p "$tmp_dir/$(dirname -- "$path")"
  printf '%s\n' "$content" > "$tmp_dir/$path"
  git -C "$tmp_dir" add .
  git -C "$tmp_dir" commit -qm fixture
  local head_sha
  head_sha="$(git -C "$tmp_dir" rev-parse HEAD)"
  export PROFILE=incremental EVENT_NAME=push BEFORE_SHA="$base_sha" HEAD_SHA="$head_sha"
  assert_outputs "$expected"
  git -C "$tmp_dir" reset -q --hard "$base_sha"
}

run_fixture 'docs/guide.md' docs $'backend=false\nfrontend=false\nsecurity=false\nsmoke=false'
run_fixture 'apps/web/src/page.tsx' web $'backend=false\nfrontend=true\nsecurity=true\nsmoke=false'
run_fixture 'apps/backend/src/Main.java' backend $'backend=true\nfrontend=false\nsecurity=true\nsmoke=true'
run_fixture '.github/workflows/changed.yml' workflow $'backend=true\nfrontend=true\nsecurity=true\nsmoke=true'
run_fixture 'docker-compose.yml' compose $'backend=true\nfrontend=true\nsecurity=true\nsmoke=true'

PROFILE=full GITHUB_OUTPUT="$tmp_dir/output" assert_outputs $'backend=true\nfrontend=true\nsecurity=true\nsmoke=true'

echo 'classifier matrix passed'
