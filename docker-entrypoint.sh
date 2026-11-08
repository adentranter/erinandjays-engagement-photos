#!/bin/sh
set -e

# Apply pending Prisma migrations before the server starts. If this fails
# (database unreachable, bad migration) the container exits and Coolify
# keeps the previous deployment running.
if [ -n "$DATABASE_URL" ] && [ "${SKIP_MIGRATIONS:-}" != "1" ]; then
  echo "Applying database migrations…"
  prisma migrate deploy --schema ./prisma/schema.prisma
fi

exec "$@"
