#!/bin/bash
set -euo pipefail

# Push database schema to PRODUCTION database (External PostgreSQL)
# Uses PG_HOST, PG_USER, PG_PASSWORD, PG_DATABASE environment variables

echo "🚀 Pushing schema to PRODUCTION database..."
MASKED_HOST="${PG_HOST:0:3}***${PG_HOST: -3}"
echo "Database: $MASKED_HOST:${PG_PORT:-5432}/$PG_DATABASE"
echo ""

# Confirm before pushing to production
read -p "⚠️  This will modify PRODUCTION database. Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "❌ Cancelled"
    exit 1
fi

npx drizzle-kit push --config=drizzle.production.config.ts

echo ""
echo "✅ Production database schema updated"
