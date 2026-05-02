#!/bin/bash
# PropFight scraper setup for Mac Studio
# Run this once after cloning the repo

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== PropFight Scraper Setup ==="

# 1. Create Python venv
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv .venv
fi

echo "Installing dependencies..."
source .venv/bin/activate
pip install -q -r requirements.txt

# 2. Check for .env
if [ ! -f ".env" ]; then
    echo ""
    echo "ERROR: No .env file found."
    echo "Create scraper/.env with:"
    echo "  DATABASE_URL=postgres://user:pass@host/dbname?sslmode=require"
    echo ""
    exit 1
fi

# 3. Test DB connection
echo "Testing database connection..."
python3 -c "
import psycopg2
from dotenv import load_dotenv
import os
load_dotenv()
conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()
cur.execute('SELECT COUNT(*) FROM properties WHERE cad = %s', ('PARKERCAD',))
count = cur.fetchone()[0]
print(f'  Connected OK. {count:,} Parker County properties in DB.')
conn.close()
"

# 4. Install launchd plist
PLIST="com.grryp.propfight-scraper.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST"

echo ""
echo "Installing launchd job (weekly Sunday 2:00 AM)..."

# Update plist path to actual repo location
sed "s|~/propfight/scraper|$SCRIPT_DIR|g" "$PLIST" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Schedule: Every Sunday at 2:00 AM"
echo "Log file: ~/propfight-scraper.log"
echo ""
echo "Manual run:  cd $SCRIPT_DIR && source .venv/bin/activate && python refresh.py"
echo "Check job:   launchctl list | grep propfight"
echo "Uninstall:   launchctl unload $PLIST_DEST && rm $PLIST_DEST"
