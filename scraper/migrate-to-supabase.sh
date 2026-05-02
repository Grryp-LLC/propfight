#!/bin/bash
# Migrate PropFight data from Neon to Supabase
#
# Usage:
#   export NEON_URL="postgres://user:pass@neon-host/db?sslmode=require"
#   export SUPABASE_URL="postgresql://postgres.[ref]:pass@aws-host:6543/postgres"
#   ./migrate-to-supabase.sh

set -e

if [ -z "$NEON_URL" ]; then
    echo "ERROR: Set NEON_URL to your Neon connection string"
    exit 1
fi

if [ -z "$SUPABASE_URL" ]; then
    echo "ERROR: Set SUPABASE_URL to your Supabase connection string"
    exit 1
fi

DUMP_FILE="/tmp/propfight-dump.sql"

echo "=== Step 1: Dumping from Neon ==="
pg_dump "$NEON_URL" \
    --no-owner \
    --no-privileges \
    --clean \
    --if-exists \
    --schema=public \
    -f "$DUMP_FILE"

echo "  Dump size: $(du -h $DUMP_FILE | cut -f1)"

echo ""
echo "=== Step 2: Restoring to Supabase ==="
psql "$SUPABASE_URL" -f "$DUMP_FILE"

echo ""
echo "=== Step 3: Verifying ==="
psql "$SUPABASE_URL" -c "SELECT COUNT(*) as property_count FROM properties WHERE cad = 'PARKERCAD';"
psql "$SUPABASE_URL" -c "SELECT COUNT(*) as values_count FROM property_values;"

echo ""
echo "=== Migration complete ==="
echo ""
echo "Next steps:"
echo "  1. Update .env on Mac Studio:  DATABASE_URL=$SUPABASE_URL"
echo "  2. Update Vercel env var:      DATABASE_URL=$SUPABASE_URL"
echo "  3. Test the app at propfight.vercel.app"
echo "  4. Once confirmed working, you can delete the Neon project"

rm "$DUMP_FILE"
