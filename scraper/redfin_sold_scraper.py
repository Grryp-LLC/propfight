"""
Redfin recently-sold scraper for Parker County, TX.

Uses Redfin's CSV download endpoint which is more accessible than Zillow.
Fetches recent home sales and stores them in the market_sales table.

Usage:
  python redfin_sold_scraper.py              # scrape all Parker County zips
  python redfin_sold_scraper.py --zip 76087  # scrape specific zip
"""

import argparse
import csv
import io
import logging
import os
import random
import re
import sys
import time
from datetime import datetime

import psycopg2
import psycopg2.extras
import requests
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("redfin")

DB_URL = os.environ.get("DATABASE_URL", "")

# Parker County zip codes
PARKER_COUNTY_ZIPS = [
    "76008",  # Aledo
    "76020",  # Azle (partial)
    "76066",  # Millsap
    "76071",  # Newark
    "76082",  # Springtown
    "76085",  # Weatherford
    "76086",  # Weatherford
    "76087",  # Weatherford
    "76088",  # Weatherford
    "76126",  # Fort Worth (west - partial Parker)
]

REDFIN_CSV_URL = "https://www.redfin.com/stingray/api/gis-csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.redfin.com/",
}


def get_db():
    return psycopg2.connect(DB_URL)


def normalize_address(addr: str) -> str:
    """Normalize address for matching."""
    addr = addr.strip().upper()
    addr = re.sub(r"\s*(APT|UNIT|STE|SUITE|#)\s*\S+", "", addr)
    addr = re.sub(r"\bSTREET\b", "ST", addr)
    addr = re.sub(r"\bDRIVE\b", "DR", addr)
    addr = re.sub(r"\bROAD\b", "RD", addr)
    addr = re.sub(r"\bLANE\b", "LN", addr)
    addr = re.sub(r"\bCOURT\b", "CT", addr)
    addr = re.sub(r"\bCIRCLE\b", "CIR", addr)
    addr = re.sub(r"\bBOULEVARD\b", "BLVD", addr)
    addr = re.sub(r"\bAVENUE\b", "AVE", addr)
    addr = re.sub(r"\bPLACE\b", "PL", addr)
    addr = re.sub(r"\bTRAIL\b", "TRL", addr)
    addr = re.sub(r"\s+", " ", addr).strip()
    return addr


def fetch_redfin_sold(zip_code: str) -> list[dict]:
    """Fetch recently sold listings from Redfin for a zip code."""
    params = {
        "al": 1,
        "isRentals": "false",
        "market": "austin",
        "region_id": zip_code,
        "region_type": 2,  # zip code
        "sold_within_days": 365,
        "status": 9,  # sold
        "uipt": "1,2,3",  # SFH, condo, townhouse
        "v": 8,
    }

    try:
        resp = requests.get(
            REDFIN_CSV_URL,
            headers=HEADERS,
            params=params,
            timeout=30,
        )

        if resp.status_code == 403:
            log.warning(f"Redfin returned 403 for zip {zip_code}")
            return []

        if resp.status_code != 200:
            log.warning(f"Redfin returned {resp.status_code} for zip {zip_code}")
            return []

        # Parse CSV
        content = resp.text
        if not content or "SALE TYPE" not in content:
            log.warning(f"No CSV data for zip {zip_code}")
            return []

        reader = csv.DictReader(io.StringIO(content))
        sold_properties = []

        for row in reader:
            try:
                sale_price = row.get("PRICE", "").replace("$", "").replace(",", "").strip()
                if not sale_price or float(sale_price) <= 0:
                    continue

                address = row.get("ADDRESS", "").strip()
                if not address:
                    continue

                city = row.get("CITY", "").strip()
                zipcode = row.get("ZIP OR POSTAL CODE", "").strip() or zip_code
                sqft_raw = row.get("SQUARE FEET", "").replace(",", "").strip()
                sqft = int(float(sqft_raw)) if sqft_raw else None
                beds = row.get("BEDS", "").strip()
                baths = row.get("BATHS", "").strip()
                year_raw = row.get("YEAR BUILT", "").strip()
                lot_raw = row.get("LOT SIZE", "").replace(",", "").strip()
                sold_date = row.get("SOLD DATE", "").strip()
                home_type = row.get("PROPERTY TYPE", "").strip()
                redfin_url = row.get("URL (SEE https://www.redfin.com/buy-a-home/comparative-market-analysis FOR INFO ON PRICING)", "").strip()

                # Parse sold date
                sale_date_str = None
                if sold_date:
                    try:
                        dt = datetime.strptime(sold_date, "%B-%d-%Y")
                        sale_date_str = dt.strftime("%Y-%m-%d")
                    except ValueError:
                        try:
                            dt = datetime.strptime(sold_date, "%m/%d/%Y")
                            sale_date_str = dt.strftime("%Y-%m-%d")
                        except ValueError:
                            pass

                # Generate a stable ID from address + date
                zpid = f"rf_{zipcode}_{normalize_address(address).replace(' ', '_')}_{sale_date_str or 'nodate'}"

                sold_properties.append({
                    "zpid": zpid,
                    "address": address,
                    "city": city,
                    "zip": zipcode,
                    "sale_price": float(sale_price),
                    "sale_date": sale_date_str,
                    "sqft": sqft,
                    "bedrooms": int(beds) if beds and beds.replace(".", "").isdigit() else None,
                    "bathrooms": float(baths) if baths else None,
                    "year_built": int(year_raw) if year_raw and year_raw.isdigit() else None,
                    "lot_size": float(lot_raw) if lot_raw else None,
                    "home_type": home_type,
                })
            except (ValueError, TypeError) as e:
                log.debug(f"Skipping row: {e}")
                continue

        return sold_properties

    except requests.exceptions.Timeout:
        log.warning(f"Timeout for zip {zip_code}")
        return []
    except Exception as e:
        log.error(f"Error fetching zip {zip_code}: {e}")
        return []


def match_to_property(conn, sale: dict) -> str | None:
    """Try to match a sale to an existing property by normalized address."""
    if not sale.get("address"):
        return None

    normalized = normalize_address(sale["address"])
    cur = conn.cursor()

    cur.execute("""
        SELECT property_id FROM properties
        WHERE UPPER(situs_address) = %s
          AND cad = 'PARKERCAD'
        LIMIT 1
    """, (normalized,))
    row = cur.fetchone()
    if row:
        cur.close()
        return row[0]

    # Partial match: house number + first word of street
    parts = normalized.split(" ", 1)
    if len(parts) == 2 and parts[0].isdigit():
        house_num = parts[0]
        street_words = parts[1].split()
        if street_words:
            cur.execute("""
                SELECT property_id FROM properties
                WHERE UPPER(situs_address) LIKE %s
                  AND UPPER(situs_address) LIKE %s
                  AND cad = 'PARKERCAD'
                LIMIT 1
            """, (f"{house_num} %", f"%{street_words[0]}%"))
            row = cur.fetchone()
            if row:
                cur.close()
                return row[0]

    cur.close()
    return None


def upsert_market_sale(conn, sale: dict, matched_property_id: str | None = None):
    """Insert or update a market sale record."""
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO market_sales (
            zpid, address, city, zip, sale_price, sale_date,
            sqft, bedrooms, bathrooms, year_built, lot_size,
            home_type, matched_property_id, source
        ) VALUES (
            %(zpid)s, %(address)s, %(city)s, %(zip)s, %(sale_price)s, %(sale_date)s,
            %(sqft)s, %(bedrooms)s, %(bathrooms)s, %(year_built)s, %(lot_size)s,
            %(home_type)s, %(matched_property_id)s, 'redfin'
        )
        ON CONFLICT (zpid) DO UPDATE SET
            sale_price = EXCLUDED.sale_price,
            sale_date = EXCLUDED.sale_date,
            sqft = EXCLUDED.sqft,
            matched_property_id = EXCLUDED.matched_property_id
    """, {**sale, "matched_property_id": matched_property_id})
    cur.close()


def ensure_schema(conn):
    """Create market_sales table if it doesn't exist."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS market_sales (
            id SERIAL PRIMARY KEY,
            zpid TEXT UNIQUE,
            address TEXT,
            city TEXT,
            zip TEXT,
            sale_price NUMERIC,
            sale_date DATE,
            sqft INTEGER,
            bedrooms INTEGER,
            bathrooms NUMERIC,
            year_built INTEGER,
            lot_size NUMERIC,
            home_type TEXT,
            matched_property_id TEXT REFERENCES properties(property_id),
            source TEXT DEFAULT 'redfin',
            scraped_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_market_sales_matched
            ON market_sales(matched_property_id) WHERE matched_property_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_market_sales_zip ON market_sales(zip);
        CREATE INDEX IF NOT EXISTS idx_market_sales_date ON market_sales(sale_date);
    """)
    conn.commit()
    cur.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", type=str, help="Scrape specific zip code")
    args = parser.parse_args()

    if not DB_URL:
        log.error("DATABASE_URL not set")
        sys.exit(1)

    conn = get_db()
    ensure_schema(conn)

    zips = [args.zip] if args.zip else PARKER_COUNTY_ZIPS
    grand_total = 0

    log.info(f"=== Redfin sold scraper: {len(zips)} zip codes ===")

    for zip_code in zips:
        log.info(f"Scraping zip {zip_code}...")
        sales = fetch_redfin_sold(zip_code)

        saved = 0
        for sale in sales:
            matched_id = match_to_property(conn, sale)
            upsert_market_sale(conn, sale, matched_id)
            saved += 1

        conn.commit()
        grand_total += saved
        log.info(f"  Zip {zip_code}: {saved} sales saved")

        # Rate limit between zips
        time.sleep(5 + random.random() * 5)

    log.info(f"=== Complete: {grand_total} total sales saved ===")

    # Report match rate
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM market_sales WHERE matched_property_id IS NOT NULL")
    matched = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM market_sales")
    total = cur.fetchone()[0]
    cur.close()
    if total > 0:
        log.info(f"Match rate: {matched}/{total} ({matched/total*100:.1f}% matched to CAD properties)")

    conn.close()


if __name__ == "__main__":
    main()
