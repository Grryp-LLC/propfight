"""
Parker County Appraisal District (PCAD) scraper using Gemini for HTML extraction.

Fetches property pages and uses Gemini to extract structured data reliably
from the messy ASP.NET HTML, then upserts into Neon Postgres.

Usage:
  python pcad_gemini_scraper.py --start 1000 --end 200000 --workers 3
  python pcad_gemini_scraper.py --id R000034732
  python pcad_gemini_scraper.py --resume   # picks up from last scraped ID
"""

import argparse
import json
import logging
import os
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import psycopg2
import psycopg2.extras
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pcad")

DB_URL = os.environ.get("DATABASE_URL", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
BASE_URL = "https://www.southwestdatasolution.com"
CAD_KEY = "PARKERCAD"

# Gemini client
client = genai.Client(api_key=GOOGLE_API_KEY)

EXTRACT_PROMPT = """Extract property appraisal data from this Parker County Appraisal District HTML page.
Return ONLY a valid JSON object with these exact fields (use null for missing values):

{
  "property_id": "R000034732",
  "geo_id": "19925.008.001.20",
  "owner_name": "SMITH JOHN",
  "situs_address": "200 SANTA FE DR",
  "situs_city": "WEATHERFORD",
  "situs_zip": "76086",
  "legal_description": "Acres: 0.195, Lot: 1, Blk: 8, Subd: YEOMANS",
  "subdivision": "YEOMANS",
  "acres": 0.195,
  "land_sqft": 8494,
  "improvement_sqft": 1850,
  "year_built": 2001,
  "building_class": "SR",
  "appraised_values": {
    "2022": {"land": 67950, "improvement": 163670, "total": 231620, "market": 231620},
    "2023": {"land": 59460, "improvement": 178080, "total": 237540, "market": 237540},
    "2024": {"land": 59460, "improvement": 178080, "total": 237540, "market": 237540},
    "2025": {"land": 59460, "improvement": 187480, "total": 246940, "market": 246940},
    "2026": {"land": 0, "improvement": 0, "total": 0, "market": 0}
  },
  "exemptions": ["HS"],
  "sales": [
    {"grantor": "YOUNG JIM", "deed_vol": "1941", "deed_page": "1828", "sale_date": "2001-07-06"}
  ]
}

Notes:
- property_id starts with R (real) or P (personal), followed by 9 digits
- improvement_sqft is the living area / heated sqft of the main structure
- year_built is the year the main structure was built
- For appraised_values, extract all years shown (typically 2022-2026)
- exemptions: HS=Homestead, OV65=Over 65, DV=Disabled Veteran, AG=Agricultural
- Only include sales with actual dates
- subdivision: extract from legal description or situs info

HTML:
"""


def get_db():
    return psycopg2.connect(DB_URL)


def fetch_property_html(property_id: str, session: requests.Session) -> str | None:
    url = f"{BASE_URL}/webProperty.aspx?dbkey={CAD_KEY}&stype=id&sdata={property_id}&id={property_id}"
    try:
        resp = session.get(url, timeout=15)
        if resp.status_code != 200:
            return None
        html = resp.text
        # Quick check -- if no property data found, skip
        if "No results found" in html or "webprop_name" not in html:
            return None
        return html
    except Exception as e:
        log.warning(f"Fetch error {property_id}: {e}")
        return None


def extract_with_gemini(html: str, property_id: str) -> dict | None:
    # Strip down HTML to reduce tokens -- keep body text, remove scripts/styles
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "link", "meta", "head"]):
        tag.decompose()
    clean_html = soup.get_text(separator=" ", strip=True)[:8000]  # cap at 8k chars

    prompt = EXTRACT_PROMPT + clean_html

    try:
        response = client.models.generate_content(
            model="gemma-4-31b-it",
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0,
                response_mime_type="application/json",
            ),
        )
        text = response.text.strip()
        # Strip markdown code fences if present
        text = re.sub(r"^```json\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        data = json.loads(text)
        return data
    except Exception as e:
        log.warning(f"Gemini error {property_id}: {e}")
        return None


def upsert_property(conn, data: dict):
    cur = conn.cursor()

    # Upsert main property record
    cur.execute("""
        INSERT INTO properties (
            property_id, geo_id, owner_name, situs_address, situs_city, situs_zip,
            legal_description, subdivision, acres, land_sqft, improvement_sqft,
            year_built, building_class, cad, scraped_at, updated_at
        ) VALUES (
            %(property_id)s, %(geo_id)s, %(owner_name)s, %(situs_address)s,
            %(situs_city)s, %(situs_zip)s, %(legal_description)s, %(subdivision)s,
            %(acres)s, %(land_sqft)s, %(improvement_sqft)s, %(year_built)s,
            %(building_class)s, 'PARKERCAD', NOW(), NOW()
        )
        ON CONFLICT (property_id) DO UPDATE SET
            geo_id = EXCLUDED.geo_id,
            owner_name = EXCLUDED.owner_name,
            situs_address = EXCLUDED.situs_address,
            situs_city = EXCLUDED.situs_city,
            situs_zip = EXCLUDED.situs_zip,
            legal_description = EXCLUDED.legal_description,
            subdivision = EXCLUDED.subdivision,
            acres = EXCLUDED.acres,
            land_sqft = EXCLUDED.land_sqft,
            improvement_sqft = EXCLUDED.improvement_sqft,
            year_built = EXCLUDED.year_built,
            building_class = EXCLUDED.building_class,
            updated_at = NOW()
    """, {
        "property_id": data.get("property_id"),
        "geo_id": data.get("geo_id"),
        "owner_name": data.get("owner_name"),
        "situs_address": data.get("situs_address"),
        "situs_city": data.get("situs_city"),
        "situs_zip": data.get("situs_zip"),
        "legal_description": data.get("legal_description"),
        "subdivision": data.get("subdivision"),
        "acres": data.get("acres"),
        "land_sqft": data.get("land_sqft"),
        "improvement_sqft": data.get("improvement_sqft"),
        "year_built": data.get("year_built"),
        "building_class": data.get("building_class"),
    })

    # Upsert appraised values by year
    appraised = data.get("appraised_values", {})
    for year_str, vals in appraised.items():
        try:
            year = int(year_str)
            total = vals.get("total", 0) or 0
            if total <= 0:
                continue
            cur.execute("""
                INSERT INTO property_values (
                    property_id, year, land_value, improvement_value,
                    total_appraised, market_value
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (property_id, year) DO UPDATE SET
                    land_value = EXCLUDED.land_value,
                    improvement_value = EXCLUDED.improvement_value,
                    total_appraised = EXCLUDED.total_appraised,
                    market_value = EXCLUDED.market_value
            """, (
                data["property_id"], year,
                vals.get("land", 0),
                vals.get("improvement", 0),
                vals.get("total", 0),
                vals.get("market", 0),
            ))
        except (ValueError, TypeError):
            continue

    # Upsert exemptions
    exemptions = data.get("exemptions", [])
    if exemptions:
        cur.execute("DELETE FROM property_exemptions WHERE property_id = %s AND year = 2026",
                    (data["property_id"],))
        for ex in exemptions:
            cur.execute("""
                INSERT INTO property_exemptions (property_id, year, exemption_type)
                VALUES (%s, 2026, %s) ON CONFLICT DO NOTHING
            """, (data["property_id"], ex))

    # Upsert sales
    for sale in data.get("sales", []):
        if not sale.get("sale_date"):
            continue
        cur.execute("""
            INSERT INTO property_sales (property_id, grantor, deed_vol, deed_page, sale_date)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
        """, (
            data["property_id"],
            sale.get("grantor"),
            sale.get("deed_vol"),
            sale.get("deed_page"),
            sale.get("sale_date"),
        ))

    conn.commit()
    cur.close()


def get_last_scraped_id(conn) -> int:
    cur = conn.cursor()
    cur.execute("""
        SELECT property_id FROM properties
        WHERE property_id LIKE 'R%' AND cad = 'PARKERCAD'
        ORDER BY property_id DESC LIMIT 1
    """)
    row = cur.fetchone()
    cur.close()
    if row:
        try:
            return int(row[0][1:])
        except ValueError:
            return 0
    return 0


def scrape_range(start: int, end: int):
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    })

    conn = get_db()
    total = 0
    skipped = 0
    errors = 0

    log.info(f"Scraping R{start:09d} to R{end:09d}")

    for num in range(start, end + 1):
        property_id = f"R{num:09d}"

        try:
            # Fetch HTML
            html = fetch_property_html(property_id, session)
            if not html:
                skipped += 1
                if num % 500 == 0:
                    log.info(f"Progress: {num-start}/{end-start} | saved={total} skipped={skipped} errors={errors}")
                time.sleep(0.3 + random.random() * 0.3)
                continue

            # Extract with Gemini
            data = extract_with_gemini(html, property_id)
            if not data or not data.get("property_id"):
                errors += 1
                time.sleep(0.5)
                continue

            # Ensure property_id matches
            data["property_id"] = property_id

            # Only save residential/real property (skip if no improvement sqft)
            if not data.get("improvement_sqft") or data.get("improvement_sqft", 0) <= 0:
                skipped += 1
                time.sleep(0.4 + random.random() * 0.3)
                continue

            upsert_property(conn, data)
            total += 1

            if total % 50 == 0:
                log.info(f"Saved {total} properties | current: {property_id} | skipped={skipped}")

            # Rate limit: ~1-1.5 req/sec (respectful to PCAD server)
            time.sleep(0.7 + random.random() * 0.5)

        except KeyboardInterrupt:
            log.info(f"Interrupted at {property_id}. Saved {total} properties.")
            break
        except Exception as e:
            log.error(f"Error on {property_id}: {e}")
            errors += 1
            time.sleep(2)

    conn.close()
    log.info(f"Done. Total saved: {total} | Skipped: {skipped} | Errors: {errors}")


def scrape_single(property_id: str):
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    })
    conn = get_db()

    html = fetch_property_html(property_id, session)
    if not html:
        log.error(f"No data found for {property_id}")
        return

    data = extract_with_gemini(html, property_id)
    if not data:
        log.error("Gemini extraction failed")
        return

    data["property_id"] = property_id
    log.info(f"Extracted: {json.dumps(data, indent=2)}")
    upsert_property(conn, data)
    log.info(f"Saved {property_id} to database")
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PCAD scraper with Gemini extraction")
    subparsers = parser.add_subparsers(dest="command")

    # Single property
    single = subparsers.add_parser("id", help="Scrape a single property by ID")
    single.add_argument("property_id", help="e.g. R000034732")

    # Range
    range_p = subparsers.add_parser("range", help="Scrape a range of property IDs")
    range_p.add_argument("--start", type=int, default=1000)
    range_p.add_argument("--end", type=int, default=200000)

    # Resume from last scraped
    resume = subparsers.add_parser("resume", help="Resume from last scraped ID")
    resume.add_argument("--end", type=int, default=200000)

    args = parser.parse_args()

    if not DB_URL:
        log.error("DATABASE_URL not set")
        sys.exit(1)
    if not GOOGLE_API_KEY:
        log.error("GOOGLE_API_KEY not set")
        sys.exit(1)

    if args.command == "id":
        scrape_single(args.property_id)
    elif args.command == "range":
        scrape_range(args.start, args.end)
    elif args.command == "resume":
        conn = get_db()
        last = get_last_scraped_id(conn)
        conn.close()
        log.info(f"Resuming from R{last+1:09d}")
        scrape_range(last + 1, args.end)
    else:
        parser.print_help()
