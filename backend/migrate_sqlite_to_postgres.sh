#!/usr/bin/env bash
# Move data from SQLite to Postgres. Run from backend/.
#
# Docker Postgres (compose): host port 5433, user/password/db = budget
#   export POSTGRES_URL='postgres://budget:budget@localhost:5433/budget'
#
# From inside the backend container (hostname postgres):
#   export POSTGRES_URL='postgres://budget:budget@postgres:5432/budget'
#
# Usage:
#   cd backend
#   ./migrate_sqlite_to_postgres.sh

set -e
BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BACKEND_DIR"
BACKUP_JSON="$BACKEND_DIR/data.json"

if [ -z "$POSTGRES_URL" ]; then
  POSTGRES_URL='postgres://budget:budget@localhost:5433/budget'
  echo "POSTGRES_URL not set; using default: $POSTGRES_URL"
fi

echo "1. Dumping data from SQLite..."
unset DATABASE_URL
python3 manage.py dumpdata \
  --natural-foreign --natural-primary \
  --exclude contenttypes --exclude auth.Permission \
  --indent 2 \
  -o "$BACKUP_JSON"
echo "   Saved to $BACKUP_JSON ($(wc -c < "$BACKUP_JSON" | tr -d ' ') bytes)"

echo "2. Running migrations on Postgres..."
DATABASE_URL="$POSTGRES_URL" python3 manage.py migrate
echo "   Done."

echo "3. Loading data into Postgres..."
DATABASE_URL="$POSTGRES_URL" python3 manage.py loaddata "$BACKUP_JSON"
echo "   Done."

echo ""
echo "Migration complete. Set DATABASE_URL in backend/.env:"
echo "  DATABASE_URL=$POSTGRES_URL"
echo "For Docker Compose, use postgres://budget:budget@postgres:5432/budget (see docker-compose.yml)."
