#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'update_test.sh: %s\n' "$*" >&2
  exit 1
}

assert_empty() {
  file="$1"
  label="$2"
  [ ! -s "$file" ] || fail "$label should not run"
}

assert_file_content() {
  file="$1"
  expected="$2"
  label="$3"
  [ -f "$file" ] || fail "$label is missing"
  actual="$(cat "$file")"
  [ "$actual" = "$expected" ] || fail "$label content mismatch"
}

[ -f "$ROOT_DIR/update.sh" ] || fail "update.sh should exist"

SOURCE_DIR="$TMP_DIR/source checkout"
TARGET_DIR="$TMP_DIR/agent target"
DRY_TARGET="$TMP_DIR/dry agent"
SKIP_TARGET="$TMP_DIR/skip agent"
FAKE_BIN="$TMP_DIR/bin"
PI_LOG="$TMP_DIR/pi.log"
NPM_LOG="$TMP_DIR/npm.log"
GIT_LOG="$TMP_DIR/git.log"

mkdir -p \
  "$SOURCE_DIR/extensions/demo" \
  "$SOURCE_DIR/skills/example" \
  "$SOURCE_DIR/subagents" \
  "$TARGET_DIR/extensions/demo" \
  "$TARGET_DIR/subagents" \
  "$TARGET_DIR/nested" \
  "$TARGET_DIR/.update-backups/old" \
  "$DRY_TARGET" \
  "$SKIP_TARGET" \
  "$FAKE_BIN" \
  "$TMP_DIR/home"

cp "$ROOT_DIR/update.sh" "$SOURCE_DIR/update.sh"
chmod +x "$SOURCE_DIR/update.sh"

printf 'new agents\n' > "$SOURCE_DIR/AGENTS.md"
printf '{"policy":"current"}\n' > "$SOURCE_DIR/permissions.json"
printf '{"default_tools":["read"]}\n' > "$SOURCE_DIR/subagents.json"
printf '{"name":"demo","version":"1.0.0"}\n' > "$SOURCE_DIR/extensions/demo/package.json"
printf 'new extension\n' > "$SOURCE_DIR/extensions/demo/index.ts"
printf '%s\n' '---' 'name: example' 'description: example skill' '---' > "$SOURCE_DIR/skills/example/SKILL.md"
printf '%s\n' '---' 'name: example' 'description: example subagent' '---' > "$SOURCE_DIR/subagents/example.md"

printf 'old agents\n' > "$TARGET_DIR/AGENTS.md"
cp "$SOURCE_DIR/permissions.json" "$TARGET_DIR/permissions.json"
chmod 600 "$TARGET_DIR/permissions.json"
printf 'old extension\n' > "$TARGET_DIR/extensions/demo/index.ts"
printf 'keep stale extension file\n' > "$TARGET_DIR/extensions/demo/user-extra.txt"
printf 'keep custom subagent\n' > "$TARGET_DIR/subagents/user-custom.md"
printf 'keep custom root file\n' > "$TARGET_DIR/custom-root.txt"
printf 'keep nested file\n' > "$TARGET_DIR/nested/notes.txt"
printf 'pi auth secret\n' > "$TARGET_DIR/auth.json"
printf 'pi trust secret\n' > "$TARGET_DIR/trust.json"
printf 'environment secret\n' > "$TARGET_DIR/.env"
printf 'environment local secret\n' > "$TARGET_DIR/.env.local"
printf 'nested environment secret\n' > "$TARGET_DIR/nested/.env.production"
printf 'private key\n' > "$TARGET_DIR/nested/private.key"
printf 'certificate\n' > "$TARGET_DIR/nested/certificate.pem"
printf 'old backup\n' > "$TARGET_DIR/.update-backups/old/previous.tar.gz"

cat > "$FAKE_BIN/git" <<'FAKE_GIT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_GIT_LOG"
exit 91
FAKE_GIT

cat > "$FAKE_BIN/pi" <<'FAKE_PI'
#!/usr/bin/env bash
set -euo pipefail
[ "${PI_CODING_AGENT_DIR:-}" = "$EXPECTED_PI_AGENT_DIR" ] || {
  printf 'unexpected PI_CODING_AGENT_DIR: %s\n' "${PI_CODING_AGENT_DIR:-<unset>}" >&2
  exit 70
}
printf '%s|%s\n' "$PI_CODING_AGENT_DIR" "$*" >> "$TEST_PI_LOG"
FAKE_PI

cat > "$FAKE_BIN/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "$PWD" "$*" >> "$TEST_NPM_LOG"
FAKE_NPM

chmod +x "$FAKE_BIN/git" "$FAKE_BIN/pi" "$FAKE_BIN/npm"
: > "$PI_LOG"
: > "$NPM_LOG"
: > "$GIT_LOG"

run_updater() {
  target="$1"
  shift
  HOME="$TMP_DIR/home" \
  PATH="$FAKE_BIN:$PATH" \
  EXPECTED_PI_AGENT_DIR="$target" \
  TEST_PI_LOG="$PI_LOG" \
  TEST_NPM_LOG="$NPM_LOG" \
  TEST_GIT_LOG="$GIT_LOG" \
    bash "$SOURCE_DIR/update.sh" --target "$target" "$@"
}

run_updater "$TARGET_DIR" > "$TMP_DIR/update.out"

cmp -s "$SOURCE_DIR/AGENTS.md" "$TARGET_DIR/AGENTS.md" \
  || fail "different AGENTS.md should be updated"
cmp -s "$SOURCE_DIR/subagents.json" "$TARGET_DIR/subagents.json" \
  || fail "missing subagents.json should be copied"
cmp -s "$SOURCE_DIR/extensions/demo/index.ts" "$TARGET_DIR/extensions/demo/index.ts" \
  || fail "different extension file should be updated"
[ "$(stat -c '%a' "$TARGET_DIR/permissions.json")" = "600" ] \
  || fail "identical files should not be rewritten"
assert_file_content "$TARGET_DIR/extensions/demo/user-extra.txt" "keep stale extension file" "extra extension file"
assert_file_content "$TARGET_DIR/subagents/user-custom.md" "keep custom subagent" "custom subagent"
assert_file_content "$TARGET_DIR/custom-root.txt" "keep custom root file" "custom root file"
assert_file_content "$TARGET_DIR/auth.json" "pi auth secret" "live auth.json"
assert_file_content "$TARGET_DIR/trust.json" "pi trust secret" "live trust.json"
assert_file_content "$TARGET_DIR/.env.local" "environment local secret" "live .env.local"
assert_file_content "$TARGET_DIR/nested/.env.production" "nested environment secret" "live nested .env.production"
assert_file_content "$TARGET_DIR/nested/private.key" "private key" "live private key"
assert_file_content "$TARGET_DIR/nested/certificate.pem" "certificate" "live certificate"

set -- "$TARGET_DIR"/.update-backups/*/agent.tar.gz
[ "$#" -eq 1 ] && [ -f "$1" ] || fail "exactly one backup archive should be created"
BACKUP_ARCHIVE="$1"
tar -tzf "$BACKUP_ARCHIVE" > "$TMP_DIR/backup.list"
grep -F './AGENTS.md' "$TMP_DIR/backup.list" >/dev/null \
  || fail "backup should contain AGENTS.md"
grep -F './custom-root.txt' "$TMP_DIR/backup.list" >/dev/null \
  || fail "backup should contain unmanaged files"
grep -F './nested/notes.txt' "$TMP_DIR/backup.list" >/dev/null \
  || fail "backup should contain nested non-secret files"
[ "$(tar -xOzf "$BACKUP_ARCHIVE" ./AGENTS.md)" = "old agents" ] \
  || fail "backup should preserve the pre-update AGENTS.md"
if grep -E '(^|/)(auth\.json|trust\.json|\.env($|\.)|[^/]+\.(key|pem))$' "$TMP_DIR/backup.list" >/dev/null; then
  fail "backup should exclude Pi keys and secret files"
fi
if grep -F './.update-backups' "$TMP_DIR/backup.list" >/dev/null; then
  fail "backup should not recursively contain previous update backups"
fi
assert_file_content "$TARGET_DIR/.update-backups/old/previous.tar.gz" "old backup" "previous backup"

expected_npm_call="$TARGET_DIR/extensions/demo|install"
[ "$(cat "$NPM_LOG")" = "$expected_npm_call" ] \
  || fail "npm install should run for copied extensions"
expected_pi_call="$TARGET_DIR|update --extensions"
[ "$(cat "$PI_LOG")" = "$expected_pi_call" ] \
  || fail "Pi extensions should be updated"
assert_empty "$GIT_LOG" "git"
grep -F 'Update complete.' "$TMP_DIR/update.out" >/dev/null \
  || fail "successful update should report completion"

printf 'old dry agents\n' > "$DRY_TARGET/AGENTS.md"
: > "$PI_LOG"
: > "$NPM_LOG"
: > "$GIT_LOG"
run_updater "$DRY_TARGET" --dry-run > "$TMP_DIR/dry-run.out"
assert_file_content "$DRY_TARGET/AGENTS.md" "old dry agents" "dry-run AGENTS.md"
[ ! -e "$DRY_TARGET/.update-backups" ] \
  || fail "dry-run should not create a backup"
assert_empty "$PI_LOG" "pi update during --dry-run"
assert_empty "$NPM_LOG" "npm install during --dry-run"
assert_empty "$GIT_LOG" "git during --dry-run"
grep -F 'mode: dry-run' "$TMP_DIR/dry-run.out" >/dev/null \
  || fail "dry-run should report its mode"

printf 'old skip agents\n' > "$SKIP_TARGET/AGENTS.md"
: > "$PI_LOG"
: > "$NPM_LOG"
: > "$GIT_LOG"
run_updater "$SKIP_TARGET" --skip-npm > "$TMP_DIR/skip-npm.out"
cmp -s "$SOURCE_DIR/AGENTS.md" "$SKIP_TARGET/AGENTS.md" \
  || fail "--skip-npm should still update managed files"
set -- "$SKIP_TARGET"/.update-backups/*/agent.tar.gz
[ "$#" -eq 1 ] && [ -f "$1" ] \
  || fail "--skip-npm should still create a backup"
assert_empty "$PI_LOG" "pi update during --skip-npm"
assert_empty "$NPM_LOG" "npm install during --skip-npm"
assert_empty "$GIT_LOG" "git during --skip-npm"

printf 'update_test.sh: ok\n'
