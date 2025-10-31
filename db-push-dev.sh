#!/bin/bash
set -euo pipefail

# Push database schema to DEVELOPMENT database (Neon)
# Uses DATABASE_URL environment variable

echo "📦 Pushing schema to DEVELOPMENT database (Neon)..."
echo ""

npx drizzle-kit push

echo ""
echo "✅ Development database schema updated"
