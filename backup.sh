#!/usr/bin/env bash
# Snapshot the DeepSkyLog SQLite database and uploads directory into a
# timestamped tar.gz under ./backups (or $BACKUP_DIR).
#
# Usage:
#   ./backup.sh                          # default paths
#   BACKUP_DIR=/mnt/nas/dsl ./backup.sh  # custom destination
#   DB_PATH=./data/deepskylog.sqlite UPLOAD_DIR=./uploads ./backup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

DB_PATH="${DB_PATH:-./data/deepskylog.sqlite}"
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP:-14}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$BACKUP_DIR"

if [[ ! -f "$DB_PATH" ]]; then
  echo "ERROR: database not found at $DB_PATH" >&2
  exit 1
fi

echo "→ Snapshotting database: $DB_PATH"
if command -v sqlite3 >/dev/null 2>&1; then
  # Hot backup via the SQLite online-backup API — safe with WAL + concurrent writers.
  sqlite3 "$DB_PATH" ".backup '$WORK/deepskylog.sqlite'"
else
  # Fallback: copy the db file plus any WAL/SHM sidecars.
  cp "$DB_PATH" "$WORK/deepskylog.sqlite"
  for ext in -wal -shm; do
    if [[ -f "${DB_PATH}${ext}" ]]; then cp "${DB_PATH}${ext}" "$WORK/deepskylog.sqlite${ext}"; fi
  done
  echo "  (sqlite3 CLI not found — used file copy; consider installing sqlite3 for safer snapshots)"
fi

if [[ -d "$UPLOAD_DIR" ]]; then
  echo "→ Including uploads: $UPLOAD_DIR"
  cp -R "$UPLOAD_DIR" "$WORK/uploads"
  # Skip the scratch directory used for in-flight admin uploads.
  rm -rf "$WORK/uploads/.stage"
else
  echo "  (no uploads directory at $UPLOAD_DIR — skipping)"
fi

OUT="$BACKUP_DIR/deepskylog-$STAMP.tar.gz"
echo "→ Writing archive: $OUT"
tar -C "$WORK" -czf "$OUT" .

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256")
fi

if [[ "$KEEP" -gt 0 ]]; then
  mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/deepskylog-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" || true)
  for f in "${OLD[@]-}"; do
    [[ -z "$f" ]] && continue
    echo "→ Pruning $f"
    rm -f "$f" "${f}.sha256"
  done
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✓ Backup complete ($SIZE) at $OUT"
