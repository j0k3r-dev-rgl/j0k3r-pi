#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bash update.sh [options]

Update an existing Pi global agent directory from this distribution checkout.

The updater creates a full backup, excluding Pi keys and secret files, then
copies only missing or byte-different managed files. Extra target files are
never deleted.

Options:
  --target DIR     Target Pi agent directory (default: ~/.pi/agent or $PI_AGENT_DIR)
  --dry-run        Show backup, copy, and package actions without changing files
  --skip-npm       Update managed files but skip npm and Pi package updates
  -h, --help       Show this help

Examples:
  bash update.sh
  bash update.sh --dry-run
  bash update.sh --target "$HOME/.pi/agent" --skip-npm
USAGE
}

log() { printf '%s\n' "$*"; }
fail() { printf 'update.sh: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
TARGET_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
DRY_RUN=0
SKIP_NPM=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      [ "$#" -ge 2 ] || fail "--target requires a directory"
      TARGET_DIR="$2"
      shift 2
      ;;
    --target=*)
      TARGET_DIR="${1#--target=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --skip-npm)
      SKIP_NPM=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

[ -n "$TARGET_DIR" ] || fail "target directory is empty"
[ -d "$TARGET_DIR" ] || fail "target directory does not exist; run install.sh first: $TARGET_DIR"

command -v tar >/dev/null 2>&1 || fail "tar is required"
command -v cmp >/dev/null 2>&1 || fail "cmp is required"
command -v find >/dev/null 2>&1 || fail "find is required"
if [ "$SKIP_NPM" -eq 0 ]; then
  command -v npm >/dev/null 2>&1 || fail "npm is required unless --skip-npm is used"
  command -v pi >/dev/null 2>&1 || fail "pi is required unless --skip-npm is used"
fi

ITEMS=(
  "extensions"
  "skills"
  "subagents"
  "AGENTS.md"
  "subagents.json"
)

for rel in "${ITEMS[@]}"; do
  [ -e "$SCRIPT_DIR/$rel" ] || fail "missing source item: $rel"
done

BACKUP_DIR="$TARGET_DIR/.update-backups/$(date +%Y%m%d-%H%M%S)-$$"
BACKUP_ARCHIVE="$BACKUP_DIR/agent.tar.gz"
CREATED=0
UPDATED=0
UNCHANGED=0

log "Updating j0k3r Pi agent config"
log "source: $SCRIPT_DIR"
log "target: $TARGET_DIR"
[ "$DRY_RUN" -eq 1 ] && log "mode: dry-run"
[ "$SKIP_NPM" -eq 1 ] && log "npm: skipped"

log "backup $TARGET_DIR -> $BACKUP_ARCHIVE"
if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$BACKUP_DIR"
  TEMP_ARCHIVE="$BACKUP_ARCHIVE.tmp"
  (
    cd "$TARGET_DIR"
    tar \
      --exclude='./.update-backups' \
      --exclude='./auth.json' \
      --exclude='./trust.json' \
      --exclude='./.env' \
      --exclude='./.env.*' \
      --exclude='*.key' \
      --exclude='*.pem' \
      -czf "$TEMP_ARCHIVE" .
  )
  mv "$TEMP_ARCHIVE" "$BACKUP_ARCHIVE"
fi

sync_file() {
  local rel="$1"
  local src="$SCRIPT_DIR/$rel"
  local dest="$TARGET_DIR/$rel"
  local action

  [ ! -L "$src" ] || fail "source symlinks are not supported: $rel"
  [ ! -L "$dest" ] || fail "target symlinks are not overwritten: $rel"

  if [ -e "$dest" ] && [ ! -f "$dest" ]; then
    fail "target path is not a regular file and will not be removed: $rel"
  fi

  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    UNCHANGED=$((UNCHANGED + 1))
    return 0
  fi

  if [ -e "$dest" ]; then
    action="update"
    UPDATED=$((UPDATED + 1))
  else
    action="create"
    CREATED=$((CREATED + 1))
  fi

  log "$action file $rel"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$(dirname -- "$dest")"
    cp -p "$src" "$dest"
  fi
}

sync_dir() {
  local rel="$1"
  local src_dir="$SCRIPT_DIR/$rel"
  local src
  local child_rel

  while IFS= read -r -d '' src; do
    child_rel="${src#"$SCRIPT_DIR/"}"
    sync_file "$child_rel"
  done < <(
    find "$src_dir" \
      -type d \( \
        -name node_modules -o \
        -name .git -o \
        -name .pi -o \
        -name sessions \
      \) -prune -o \
      -type f ! -name '*.log' -print0
  )
}

for rel in "${ITEMS[@]}"; do
  if [ -d "$SCRIPT_DIR/$rel" ]; then
    sync_dir "$rel"
  else
    sync_file "$rel"
  fi
done

if [ "$SKIP_NPM" -eq 0 ]; then
  for source_pkg in "$SCRIPT_DIR"/extensions/*/package.json; do
    [ -f "$source_pkg" ] || continue
    extension_name="$(basename -- "$(dirname -- "$source_pkg")")"
    extension_dir="$TARGET_DIR/extensions/$extension_name"
    log "npm install: $extension_dir"
    if [ "$DRY_RUN" -eq 0 ]; then
      [ -f "$extension_dir/package.json" ] || fail "updated extension is missing package.json: $extension_name"
      (cd "$extension_dir" && npm install)
    fi
  done

  log "pi update --extensions"
  if [ "$DRY_RUN" -eq 0 ]; then
    PI_CODING_AGENT_DIR="$TARGET_DIR" pi update --extensions
  fi
else
  log "Skipping npm installs and Pi package updates."
fi

log "files created: $CREATED"
log "files updated: $UPDATED"
log "files unchanged: $UNCHANGED"
log "Update complete. Restart Pi or run /reload in an active session."
if [ "$DRY_RUN" -eq 0 ]; then
  log "Backup saved at: $BACKUP_ARCHIVE"
fi
