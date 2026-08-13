#!/bin/sh
set -eu

BACKUP_FILE="/docker-entrypoint-initdb.d/portfolio_backup.dump"

if [ ! -s "$BACKUP_FILE" ]; then
  echo "ERROR: PostgreSQL backup is missing or empty: $BACKUP_FILE" >&2
  exit 1
fi

echo "Restoring the initial portfolio database from portfolio_backup.dump..."
pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  "$BACKUP_FILE"
echo "Initial portfolio database restored successfully."
