"""
PropFight weekly maintenance scraper.

Re-scrapes all existing Parker County properties to pick up:
- Updated appraised values (new tax year notices)
- New sales records
- Ownership changes
- CAD corrections

Designed to run unattended via launchd on Mac Studio.
Logs to ~/propfight-scraper.log

Usage:
  python refresh.py              # refresh all properties in DB
  python refresh.py --batch 5000 # limit to N properties per run
"""

import logging
import os
import random
import sys
import time
from datetime import datetime

import psycopg2
from dotenv import load_dotenv

# Import from the main scraper
from pcad_scraper_v2 import (
    fetch_html,
    make_session,
    parse_property,
    upsert_property,
)

load_dotenv()

LOG_FILE = os.path.expanduser("~/propfight-scraper.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("refresh")

DB_URL = os.environ.get("DATABASE_URL", "")


def get_stale_properties(conn, batch: int | None = None) -> list[str]:
    """Get property IDs ordered by oldest updated_at first."""
    cur = conn.cursor()
    query = """
        SELECT property_id FROM properties
        WHERE cad = 'PARKERCAD'
        ORDER BY updated_at ASC NULLS FIRST
    """
    if batch:
        query += f" LIMIT {batch}"
    cur.execute(query)
    rows = cur.fetchall()
    cur.close()
    return [r[0] for r in rows]


def refresh(batch: int | None = None):
    if not DB_URL:
        log.error("DATABASE_URL not set")
        sys.exit(1)

    conn = psycopg2.connect(DB_URL)
    property_ids = get_stale_properties(conn, batch)
    total_count = len(property_ids)

    log.info(f"=== Refresh started: {total_count:,} properties to update ===")

    session = make_session()
    updated = 0
    errors = 0
    start_time = time.time()

    for i, pid in enumerate(property_ids):
        try:
            html = fetch_html(pid, session)

            if not html:
                # Property may have been removed from CAD
                log.debug(f"No HTML for {pid}, skipping")
                time.sleep(0.3 + random.random() * 0.2)
                continue

            data = parse_property(html, pid)
            if not data:
                errors += 1
                time.sleep(0.5)
                continue

            upsert_property(conn, data)
            updated += 1

            if updated % 100 == 0:
                elapsed = time.time() - start_time
                rate = updated / elapsed * 3600 if elapsed > 0 else 0
                remaining = total_count - i
                eta_hrs = remaining / (rate / 3600) / 3600 if rate > 0 else 0
                log.info(
                    f"[{i+1}/{total_count}] updated={updated:,} "
                    f"errors={errors} rate={rate:.0f}/hr ETA={eta_hrs:.1f}hrs"
                )

            # Rate limit: ~1 req/sec with jitter
            time.sleep(0.8 + random.random() * 0.5)

        except KeyboardInterrupt:
            log.info(f"Interrupted. Updated {updated:,} of {total_count:,}")
            break
        except Exception as e:
            log.error(f"Error on {pid}: {e}")
            errors += 1
            time.sleep(2)
            if errors % 20 == 0:
                session = make_session()

    conn.close()
    elapsed = time.time() - start_time
    log.info(
        f"=== Refresh complete: updated={updated:,} errors={errors} "
        f"elapsed={elapsed/3600:.1f}hrs ==="
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=None,
                        help="Limit to N properties per run (oldest first)")
    args = parser.parse_args()
    refresh(batch=args.batch)
