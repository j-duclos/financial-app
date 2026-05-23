#!/usr/bin/env bash
# Move data from Postgres to SQLite. Run from backend/ with your Postgres URL.
# Usage:
#   cd backend
#   POSTGRES_URL='postgres://budget:YOUR_PASSWORD@localhost:5432/budget' ./migrate_postgres_to_sqlite.sh
# If Postgres is in Docker with host "postgres", use that host in the URL when running from the same network,
# or use localhost:5432 if port is forwarded.

set -e
BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BACKEND_DIR"
BACKUP_JSON="$BACKEND_DIR/postgres_backup.json"

if [ -z "$POSTGRES_URL" ]; then
  echo "Set POSTGRES_URL with your normal Postgres username and password, e.g.:"
  echo "  export POSTGRES_URL='postgres://cazcapone:YOUR_PASSWORD@localhost:5432/DATABASE_NAME'"
  echo "Use the database name that has your app data (e.g. budget or lfg_irl)."
  echo "Then run this script again."
  exit 1
fi

echo "1. Dumping data from Postgres..."
DATABASE_URL="$POSTGRES_URL" python3 manage.py dumpdata \
  --natural-foreign --natural-primary \
  --exclude contenttypes --exclude auth.Permission \
  --indent 2 \
  -o "$BACKUP_JSON"
echo "   Saved to $BACKUP_JSON"

echo "2. Backing up existing SQLite (if any)..."
if [ -f db.sqlite3 ]; then
  mv db.sqlite3 db.sqlite3.bak
  echo "   db.sqlite3 -> db.sqlite3.bak"
fi

echo "3. Creating fresh SQLite and running migrations..."
unset DATABASE_URL
python3 manage.py migrate --run-syncdb
echo "   Done."

echo "4. Loading data into SQLite..."
unset DATABASE_URL
python3 manage.py loaddata "$BACKUP_JSON"
echo "   Done."

echo "5. Keeping SQLite as the database (ensure .env has DATABASE_URL commented out)."
echo ""
echo "Migration complete. Your data is now in backend/db.sqlite3"
echo "Restart the backend (without DATABASE_URL) and use the app; connect DBeaver to: $BACKEND_DIR/db.sqlite3"
