#!/bin/sh
set -e

# Run migrations if DATABASE_URL is postgres and migrations not skipped
if [ -n "$DATABASE_URL" ] && echo "$DATABASE_URL" | grep -q "^postgres" && [ "$SKIP_DB_MIGRATIONS" != "true" ]; then
    echo "[entrypoint] Running migrations..."
    ph switchboard --migrate
fi

echo "[entrypoint] Starting switchboard on port ${PORT:-3000}..."
exec ph switchboard --port ${PORT:-3000}
