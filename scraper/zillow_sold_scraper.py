"""
Zillow recently-sold scraper for Parker County, TX.

Fetches recent home sales from Zillow's search API for Parker County zip codes.
Matches sold properties to our existing DB records by address normalization.

Usage:
  python zillow_sold_scraper.py              # scrape all Parker County zips
  python zillow_sold_scraper.py --zip 76087  # scrape specific zip
  python zillow_sold_scraper.py --days 180   # sales from last N days
"""

import argparse
import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta

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
log = logging.getLogger("zillow")

DB_URL = os.environ.get("DATABASE_URL", "")

# Parker County zip codes (residential areas)
PARKER_COUNTY_ZIPS = [
    "76008",  # Aledo
    "76020",  # Azle (partial)
    "76066",  # Millsap
    "76067",  # Mineral Wells (partial)
    "76071",  # Newark
    "76082",  # Springtown
    "76085",  # Weatherford
    "76086",  # Weatherford
    "76087",  # Weatherford
    "76088",  # Weatherford
    "76126",  # Fort Worth (west - partial Parker)
    "76431",  # Bridgeport (partial)
    "76449",  # Graford (partial)
    "76462",  # Lipan (partial)
    "76484",  # Palo Pinto (partial)
    "76490",  # Whitt
    "76225",  # Decatur area (partial)
]

ZILLOW_SEARCH_URL = "https://www.zillow.com/search/GetSearchPageState.htm"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.zillow.com/",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
}


def get_db():
    return psycopg2.connect(DB_URL)


def normalize_address(addr: str) -> str:
    """Normalize address for matching (lowercase, strip unit/apt, standardize)."""
    addr = addr.strip().upper()
    # Remove unit/apt/suite
    addr = re.sub(r"\s*(APT|UNIT|STE|SUITE|#)\s*\S+", "", addr)
    # Standardize directionals
    addr = re.sub(r"\bNORTH\b", "N", addr)
    addr = re.sub(r"\bSOUTH\b", "S", addr)
    addr = re.sub(r"\bEAST\b", "E", addr)
    addr = re.sub(r"\bWEST\b", "W", addr)
    # Standardize suffixes
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
    addr = re.sub(r"\bWAY\b", "WAY", addr)
    # Remove extra spaces
    addr = re.sub(r"\s+", " ", addr).strip()
    return addr


def fetch_zillow_sold(zip_code: str, page: int = 1) -> list[dict]:
    """Fetch recently sold listings from Zillow for a zip code."""
    search_query = {
        "pagination": {"currentPage": page},
        "isMapVisible": False,
        "filterState": {
            "isRecentlySold": {"value": True},
            "isForSaleByAgent": {"value": False},
            "isForSaleByOwner": {"value": False},
            "isNewConstruction": {"value": False},
            "isComingSoon": {"value": False},
            "isAuction": {"value": False},
            "isForSaleForeclosure": {"value": False},
            "isAllHomes": {"value": True},
        },
        "isListVisible": True,
        "usersSearchTerm": zip_code,
    }

    wants = {"cat1": ["listResults"]}

    params = {
        "searchQueryState": json.dumps(search_query),
        "wants": json.dumps(wants),
        "requestId": random.randint(1, 99),
    }

    try:
        resp = requests.get(
            ZILLOW_SEARCH_URL,
            headers=HEADERS,
            params=params,
            timeout=30,
        )

        if resp.status_code == 403:
            log.warning(f"Zillow returned 403 for zip {zip_code} page {page} - rate limited")
            return []

        if resp.status_code != 200:
            log.warning(f"Zillow returned {resp.status_code} for zip {zip_code}")
            return []

        data = resp.json()
        results = (
            data.get("cat1", {})
            .get("searchResults", {})
            .get("listResults", [])
        )

        sold_properties = []
        for item in results:
            detail = item.get("hdpData", {}).get("homeInfo", {})
            if not detail:
                continue

            sale_price = detail.get("price") or item.get("unformattedPrice")
            if not sale_price or sale_price <= 0:
                continue

            address = item.get("address") or detail.get("streetAddress", "")
            city = detail.get("city", "")
            zipcode = detail.get("zipcode", zip_code)
            sqft = detail.get("livingArea") or item.get("area")
            bedrooms = detail.get("bedrooms")
            bathrooms = detail.get("bathrooms")
            year_built = detail.get("yearBuilt")
            sold_date = detail.get("dateSold")
            lot_size = detail.get("lotSize")
            home_type = detail.get("homeType", "")
            zpid = detail.get("zpid") or item.get("zpid")

            # Convert epoch ms to date
            sale_date_str = None
            if sold_date:
                try:
                    sale_date_str = datetime.fromtimestamp(sold_date / 1000).strftime("%Y-%m-%d")
                except (ValueError, TypeError, OSError):
                    pass

            sold_properties.append({
                "zpid": str(zpid) if zpid else None,
                "address": address,
                "city": city,
                "zip": zipcode,
                "sale_price": sale_price,
                "sale_date": sale_date_str,
                "sqft": sqft,
                "bedrooms": bedrooms,
                "bathrooms": bathrooms,
                "year_built": year_built,
                "lot_size": lot_size,
                "home_type": home_type,
            })

        return sold_properties

    except requests.exceptions.Timeout:
        log.warning(f"Timeout for zip {zip_code}")
        return []
    except Exception as e:
        log.error(f"Error fetching zip {zip_code}: {e}")
        return []


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
            %(home_type)s, %(matched_property_id)s, 'zillow'
        )
        ON CONFLICT (zpid) WHERE zpid IS NOT NULL DO UPDATE SET
            sale_price = EXCLUDED.sale_price,
            sale_date = EXCLUDED.sale_date,
            sqft = EXCLUDED.sqft,
            matched_property_id = EXCLUDED.matched_property_id
    """, {**sale, "matched_property_id": matched_property_id})
    cur.close()


def match_to_property(conn, sale: dict) -> str | None:
    """Try to match a Zillow sale to an existing property by normalized address."""
    if not sale.get("address"):
        return None

    normalized = normalize_address(sale["address"])
    cur = conn.cursor()

    # Try exact normalized match
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

    # Try house number + street name partial match
    parts = normalized.split(" ", 1)
    if len(parts) == 2 and parts[0].isdigit():
        house_num = parts[0]
        street = parts[1]
        cur.execute("""
            SELECT property_id FROM properties
            WHERE UPPER(situs_address) LIKE %s
              AND UPPER(situs_address) LIKE %s
              AND cad = 'PARKERCAD'
            LIMIT 1
        """, (f"{house_num} %", f"%{street.split()[0]}%"))
        row = cur.fetchone()
        if row:
            cur.close()
            return row[0]

    cur.close()
    return None


def scrape_zip(conn, zip_code: str, max_pages: int = 5) -> int:
    """Scrape all sold listings for a zip code. Returns count of sales saved."""
    total = 0

    for page in range(1, max_pages + 1):
        sales = fetch_zillow_sold(zip_code, page)
        if not sales:
            break

        for sale in sales:
            matched_id = match_to_property(conn, sale)
            upsert_market_sale(conn, sale, matched_id)
            total += 1

        conn.commit()
        log.info(f"  Zip {zip_code} page {page}: {len(sales)} sales")

        if len(sales) < 40:  # Less than full page = last page
            break

        # Rate limit between pages
        time.sleep(2 + random.random() * 2)

    return total


def ensure_schema(conn):
    """Create market_sales table if it doesn't exist."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS market_sales (
            id SERIAL PRIMARY KEY,
            zpid TEXT,
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
            source TEXT DEFAULT 'zillow',
            scraped_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(zpid)
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
    parser.add_argument("--days", type=int, default=365,
                        help="Only keep sales from last N days (default 365)")
    args = parser.parse_args()

    if not DB_URL:
        log.error("DATABASE_URL not set")
        sys.exit(1)

    conn = get_db()
    ensure_schema(conn)

    zips = [args.zip] if args.zip else PARKER_COUNTY_ZIPS
    grand_total = 0

    log.info(f"=== Zillow sold scraper: {len(zips)} zip codes ===")

    for zip_code in zips:
        log.info(f"Scraping zip {zip_code}...")
        count = scrape_zip(conn, zip_code)
        grand_total += count

        # Rate limit between zips
        time.sleep(3 + random.random() * 3)

    log.info(f"=== Complete: {grand_total} total sales saved ===")

    # Report match rate
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM market_sales WHERE matched_property_id IS NOT NULL")
    matched = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM market_sales")
    total = cur.fetchone()[0]
    cur.close()
    log.info(f"Match rate: {matched}/{total} ({matched/total*100:.1f}% matched to CAD properties)" if total > 0 else "No sales in DB")

    conn.close()


if __name__ == "__main__":
    main()
