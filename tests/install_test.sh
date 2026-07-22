#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'install_test.sh: %s\n' "$*" >&2
  exit 1
}

assert_empty() {
  file="$1"
  label="$2"
  [ ! -s "$file" ] || fail "$label should not run"
}

FAKE_BIN="$TMP_DIR/bin"
TARGET_DIR="$TMP_DIR/agent"
PI_LOG="$TMP_DIR/pi.log"
NPM_LOG="$TMP_DIR/npm.log"
mkdir -p "$FAKE_BIN" "$TMP_DIR/home"
: > "$PI_LOG"
: > "$NPM_LOG"

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

chmod +x "$FAKE_BIN/pi" "$FAKE_BIN/npm"

run_installer() {
  HOME="$TMP_DIR/home" \
  PATH="$FAKE_BIN:$PATH" \
  EXPECTED_PI_AGENT_DIR="$TARGET_DIR" \
  TEST_PI_LOG="$PI_LOG" \
  TEST_NPM_LOG="$NPM_LOG" \
    bash "$ROOT_DIR/install.sh" --target "$TARGET_DIR" --no-backup "$@"
}

run_installer > "$TMP_DIR/install.out"

cmp -s "$ROOT_DIR/subagents.json" "$TARGET_DIR/subagents.json" \
  || fail "installer should copy subagents.json"

expected_pi_calls="$(cat <<EOF
$TARGET_DIR|install npm:pi-subagents-j0k3r
$TARGET_DIR|install npm:gentle-engram
EOF
)"
actual_pi_calls="$(cat "$PI_LOG")"
[ "$actual_pi_calls" = "$expected_pi_calls" ] || {
  printf 'Expected Pi package calls:\n%s\nActual Pi package calls:\n%s\n' \
    "$expected_pi_calls" "$actual_pi_calls" >&2
  exit 1
}

expected_npm_dirs="$TMP_DIR/expected-npm-dirs"
actual_npm_dirs="$TMP_DIR/actual-npm-dirs"
for package_json in "$ROOT_DIR"/extensions/*/package.json; do
  [ -f "$package_json" ] || continue
  printf '%s/extensions/%s|install\n' "$TARGET_DIR" "$(basename -- "$(dirname -- "$package_json")")"
done | sort > "$expected_npm_dirs"
sort "$NPM_LOG" > "$actual_npm_dirs"
cmp -s "$expected_npm_dirs" "$actual_npm_dirs" || {
  printf 'npm install calls did not match extension manifests\n' >&2
  diff -u "$expected_npm_dirs" "$actual_npm_dirs" >&2 || true
  exit 1
}

: > "$PI_LOG"
: > "$NPM_LOG"
run_installer --dry-run > "$TMP_DIR/dry-run.out"
assert_empty "$PI_LOG" "pi install during --dry-run"
assert_empty "$NPM_LOG" "npm install during --dry-run"
grep -F 'pi install: npm:pi-subagents-j0k3r' "$TMP_DIR/dry-run.out" >/dev/null \
  || fail "dry-run should report pi-subagents installation"
grep -F 'pi install: npm:gentle-engram' "$TMP_DIR/dry-run.out" >/dev/null \
  || fail "dry-run should report gentle-engram installation"

: > "$PI_LOG"
: > "$NPM_LOG"
run_installer --skip-npm > "$TMP_DIR/skip-npm.out"
assert_empty "$PI_LOG" "pi install during --skip-npm"
assert_empty "$NPM_LOG" "npm install during --skip-npm"

printf 'install_test.sh: ok\n'
