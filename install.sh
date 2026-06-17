#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bash install.sh [options]

Install this repository into the Pi global agent directory.

Options:
  --target DIR     Target Pi agent directory (default: ~/.pi/agent or $PI_AGENT_DIR)
  --dry-run        Show what would be copied/installed without changing files
  --skip-npm       Copy files but skip npm install in extensions
  --no-backup      Do not create backups of existing target files before replacing them
  -h, --help       Show this help

Examples:
  bash install.sh
  bash install.sh --dry-run
  bash install.sh --target "$HOME/.pi/agent" --skip-npm
USAGE
}

log() { printf '%s\n' "$*"; }
fail() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
TARGET_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
DRY_RUN=0
SKIP_NPM=0
BACKUP=1

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
    --no-backup)
      BACKUP=0
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

command -v tar >/dev/null 2>&1 || fail "tar is required"
if [ "$SKIP_NPM" -eq 0 ]; then
  command -v npm >/dev/null 2>&1 || fail "npm is required unless --skip-npm is used"
fi

case "$TARGET_DIR" in
  "") fail "target directory is empty" ;;
esac

# Avoid installing into the repository checkout itself.
if [ -d "$TARGET_DIR" ]; then
  TARGET_PHYSICAL="$(CDPATH= cd -- "$TARGET_DIR" && pwd -P)"
else
  TARGET_PARENT="$(dirname -- "$TARGET_DIR")"
  if [ -d "$TARGET_PARENT" ]; then
    TARGET_PHYSICAL="$(CDPATH= cd -- "$TARGET_PARENT" && pwd -P)/$(basename -- "$TARGET_DIR")"
  else
    TARGET_PHYSICAL="$TARGET_DIR"
  fi
fi
[ "$TARGET_PHYSICAL" != "$SCRIPT_DIR" ] || fail "target directory must not be the repository checkout"

ITEMS=(
  "extensions"
  "skills"
  "subagents"
  "AGENTS.md"
  "permissions.json"
)

BACKUP_DIR=""
if [ "$BACKUP" -eq 1 ]; then
  BACKUP_DIR="$TARGET_DIR/.install-backups/$(date +%Y%m%d-%H%M%S)"
fi

backup_existing() {
  rel="$1"
  dest="$TARGET_DIR/$rel"
  [ -e "$dest" ] || return 0
  [ "$BACKUP" -eq 1 ] || return 0
  backup_path="$BACKUP_DIR/$rel"
  log "backup $dest -> $backup_path"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$(dirname -- "$backup_path")"
    mv "$dest" "$backup_path"
  fi
}

copy_file() {
  rel="$1"
  src="$SCRIPT_DIR/$rel"
  dest="$TARGET_DIR/$rel"
  [ -f "$src" ] || fail "missing file: $rel"
  backup_existing "$rel"
  log "copy file $rel -> $dest"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$(dirname -- "$dest")"
    cp "$src" "$dest"
  fi
}

copy_dir() {
  rel="$1"
  src="$SCRIPT_DIR/$rel"
  dest="$TARGET_DIR/$rel"
  [ -d "$src" ] || fail "missing directory: $rel"
  backup_existing "$rel"
  if [ "$BACKUP" -eq 0 ] && [ -e "$dest" ]; then
    log "replace existing directory without backup: $dest"
    if [ "$DRY_RUN" -eq 0 ]; then
      rm -rf "$dest"
    fi
  fi
  log "copy dir  $rel -> $dest (excluding node_modules, .git, runtime data)"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$dest"
    (
      cd "$src"
      tar \
        --exclude='node_modules' \
        --exclude='.git' \
        --exclude='.pi' \
        --exclude='sessions' \
        --exclude='*.log' \
        -cf - .
    ) | (
      cd "$dest"
      tar -xf -
    )
  fi
}

log "Installing j0k3r Pi agent config"
log "source: $SCRIPT_DIR"
log "target: $TARGET_DIR"
[ "$DRY_RUN" -eq 1 ] && log "mode: dry-run"
[ "$SKIP_NPM" -eq 1 ] && log "npm: skipped"

if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$TARGET_DIR"
fi

for rel in "${ITEMS[@]}"; do
  if [ -d "$SCRIPT_DIR/$rel" ]; then
    copy_dir "$rel"
  else
    copy_file "$rel"
  fi
done

if [ "$SKIP_NPM" -eq 0 ]; then
  for pkg in "$TARGET_DIR"/extensions/*/package.json; do
    [ -f "$pkg" ] || continue
    ext_dir="$(dirname -- "$pkg")"
    log "npm install: $ext_dir"
    if [ "$DRY_RUN" -eq 0 ]; then
      (cd "$ext_dir" && npm install)
    fi
  done
else
  log "Skipping npm install in extensions. Run later with: find '$TARGET_DIR/extensions' -maxdepth 2 -name package.json -execdir npm install \\;"
fi

log "Install complete. Restart Pi or run /reload in an active session."
if [ -n "$BACKUP_DIR" ] && [ "$DRY_RUN" -eq 0 ] && [ -d "$BACKUP_DIR" ]; then
  log "Backups saved under: $BACKUP_DIR"
fi
