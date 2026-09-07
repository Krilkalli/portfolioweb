#!/bin/sh
set -eu

BACKUP_FILE="/portfolio-seed/portfolio_backup.dump"

if [ ! -f "$BACKUP_FILE" ] || [ ! -s "$BACKUP_FILE" ]; then
  echo "Initial backup was not provided. PostgreSQL will start empty; the application will create its schema and initial data."
  exit 0
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
