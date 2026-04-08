"""
Parker County Appraisal District (PCAD) bulk property scraper.

Uses BeautifulSoup to parse structured HTML from PCAD portal.
Stores residential properties in Neon Postgres.

Usage:
  python pcad_scraper_v2.py range --start 1000 --end 200000
  python pcad_scraper_v2.py id R000034732
  python pcad_scraper_v2.py resume --end 200000
"""

import argparse
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
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("pcad")

DB_URL = os.environ.get("DATABASE_URL", "")
BASE_URL = "https://www.southwestdatasolution.com"
CAD_KEY = "PARKERCAD"


def get_db():
    return psycopg2.connect(DB_URL)


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
    })
    return s


def fetch_html(property_id: str, session: requests.Session) -> str | None:
    url = (f"{BASE_URL}/webProperty.aspx?dbkey={CAD_KEY}"
           f"&stype=id&sdata={property_id}&id={property_id}")
    try:
        resp = session.get(url, timeout=20)
        if resp.status_code != 200:
            return None
        html = resp.text
        if "webprop_name" not in html:
            return None
        return html
    except requests.exceptions.Timeout:
        return None
    except Exception as e:
        log.debug(f"Fetch error {property_id}: {e}")
        return None


def parse_money(s: str) -> float:
    """Parse '$1,234,567' or 'N/A' to float."""
    if not s or s.strip() in ("N/A", "n/a", "", "-"):
        return 0.0
    s = re.sub(r"[,$\s]", "", s.strip())
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_property(html: str, property_id: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")

    def text(selector, default=""):
        el = soup.find(id=selector)
        return el.get_text(" ", strip=True) if el else default

    # -- Owner & address --
    owner_name = text("webprop_name")
    mail_raw = text("webprop_mailaddress")
    situs_raw = text("webprop_situs")  # "Situs: SANTA FE DR   200"

    # Parse situs from "Situs: SANTA FE DR   200"
    situs_address = re.sub(r"^Situs:\s*", "", situs_raw).strip() if situs_raw else ""

    # Parse mailing address for city/state/zip
    situs_city, situs_zip = "", ""
    city_zip_match = re.search(r",\s*([A-Z\s]+)\s+TX\s+(\d{5})", mail_raw)
    if city_zip_match:
        situs_city = city_zip_match.group(1).strip()
        situs_zip = city_zip_match.group(2).strip()

    # -- Geo ID --
    geo_id = text("ucidentification_webprop_geoid")

    # -- Legal description --
    legal_el = soup.find(string=re.compile(r"Legal:"))
    legal_description = ""
    subdivision = ""
    acres = 0.0
    if legal_el:
        legal_text = legal_el.strip()
        legal_description = re.sub(r"^Legal:\s*", "", legal_text)
        subd_match = re.search(r"Subd:\s*([^,]+)", legal_description, re.IGNORECASE)
        if subd_match:
            subdivision = subd_match.group(1).strip()
        acres_match = re.search(r"Acres:\s*([\d.]+)", legal_description, re.IGNORECASE)
        if acres_match:
            try:
                acres = float(acres_match.group(1))
            except ValueError:
                pass

    # -- Improvement / Building details --
    improvement_sqft = 0
    year_built = None
    building_class = ""
    land_sqft = 0

    bld_table = soup.find("tbody", id="tableBld")
    if bld_table:
        rows = bld_table.find_all("tr")
        for row in rows:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) >= 5:
                class_code = cells[1].upper()
                # SR = Store/Retail, RES = Residential, etc.
                # For sqft, take the main structure row (first row or largest sqft)
                try:
                    sqft_val = int(cells[4].replace(",", ""))
                    yr_val = int(cells[3]) if cells[3].isdigit() else None
                    if sqft_val > improvement_sqft and class_code not in ("AS", "OP", "DK", "GR", "PT"):
                        improvement_sqft = sqft_val
                        year_built = yr_val
                        building_class = class_code
                except (ValueError, IndexError):
                    pass

    # Land sqft from acres
    if acres > 0:
        land_sqft = int(acres * 43560)

    # -- Valuation history table --
    # Look for the value table rows: Improvements, Land, Total Assessed
    appraised_values = {}

    # Find the years row
    year_row = None
    for row in soup.find_all("tr"):
        cells = row.find_all(["th", "td"])
        cell_texts = [c.get_text(strip=True) for c in cells]
        if "2026" in cell_texts and "2025" in cell_texts:
            # This is the header row with years
            years = [t for t in cell_texts if re.match(r"20\d\d$", t)]
            year_indices = {t: i for i, t in enumerate(cell_texts) if re.match(r"20\d\d$", t)}
            year_row = year_indices
            break

    if year_row:
        # Init dict
        for yr in year_row:
            appraised_values[yr] = {"land": 0.0, "improvement": 0.0, "total": 0.0, "market": 0.0}

        def extract_row(label_pattern):
            for row in soup.find_all("tr"):
                cells = row.find_all(["th", "td"])
                texts = [c.get_text(strip=True) for c in cells]
                first = texts[0] if texts else ""
                if re.search(label_pattern, first, re.IGNORECASE):
                    return texts
            return []

        impr_row = extract_row(r"^Improvements?\s*\+?$")
        land_row = extract_row(r"^Land\s*\+?$")
        total_row = extract_row(r"^Total (Market|Assessed)\s*=?")

        for yr, idx in year_row.items():
            if yr not in appraised_values:
                appraised_values[yr] = {}
            try:
                if impr_row and idx < len(impr_row):
                    appraised_values[yr]["improvement"] = parse_money(impr_row[idx])
                if land_row and idx < len(land_row):
                    appraised_values[yr]["land"] = parse_money(land_row[idx])
                if total_row and idx < len(total_row):
                    appraised_values[yr]["total"] = parse_money(total_row[idx])
                    appraised_values[yr]["market"] = parse_money(total_row[idx])
            except (IndexError, TypeError):
                pass

    # -- Sales --
    sales = []
    sale_table = soup.find("tbody", id="tableSale")
    if sale_table:
        for row in sale_table.find_all("tr"):
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cells) >= 4:
                sales.append({
                    "grantor": cells[0],
                    "deed_vol": cells[1],
                    "deed_page": cells[2],
                    "sale_date": parse_sale_date(cells[3]),
                })

    # -- Exemptions --
    exemptions = []
    ex_text = soup.get_text()
    if "Homestead" in ex_text and "HS" in ex_text:
        exemptions.append("HS")
    if "Over 65" in ex_text or "OV65" in ex_text:
        exemptions.append("OV65")
    if "Disabled Veteran" in ex_text or "DV" in ex_text:
        exemptions.append("DV")

    return {
        "property_id": property_id,
        "geo_id": geo_id,
        "owner_name": owner_name,
        "situs_address": situs_address,
        "situs_city": situs_city,
        "situs_zip": situs_zip,
        "legal_description": legal_description,
        "subdivision": subdivision,
        "acres": acres,
        "land_sqft": land_sqft,
        "improvement_sqft": improvement_sqft,
        "year_built": year_built,
        "building_class": building_class,
        "appraised_values": appraised_values,
        "exemptions": exemptions,
        "sales": sales,
    }


def parse_sale_date(raw: str) -> str | None:
    raw = raw.strip()
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return None


def upsert_property(conn, data: dict):
    cur = conn.cursor()

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
    """, {k: data.get(k) for k in [
        "property_id","geo_id","owner_name","situs_address","situs_city","situs_zip",
        "legal_description","subdivision","acres","land_sqft","improvement_sqft",
        "year_built","building_class"
    ]})

    for yr_str, vals in data.get("appraised_values", {}).items():
        try:
            yr = int(yr_str)
            total = vals.get("total", 0) or 0
            if total <= 0:
                continue
            cur.execute("""
                INSERT INTO property_values (
                    property_id, year, land_value, improvement_value, total_appraised, market_value
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (property_id, year) DO UPDATE SET
                    land_value = EXCLUDED.land_value,
                    improvement_value = EXCLUDED.improvement_value,
                    total_appraised = EXCLUDED.total_appraised,
                    market_value = EXCLUDED.market_value
            """, (
                data["property_id"], yr,
                vals.get("land", 0), vals.get("improvement", 0),
                vals.get("total", 0), vals.get("market", 0),
            ))
        except (ValueError, TypeError):
            continue

    for sale in data.get("sales", []):
        if not sale.get("sale_date"):
            continue
        cur.execute("""
            INSERT INTO property_sales (property_id, grantor, deed_vol, deed_page, sale_date)
            VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING
        """, (data["property_id"], sale.get("grantor"), sale.get("deed_vol"),
              sale.get("deed_page"), sale.get("sale_date")))

    conn.commit()
    cur.close()


def scrape_single(property_id: str):
    session = make_session()
    conn = get_db()
    html = fetch_html(property_id, session)
    if not html:
        log.error(f"No HTML returned for {property_id}")
        return
    data = parse_property(html, property_id)
    if not data:
        log.error("Parse failed")
        return
    import json
    log.info(f"Parsed:\n{json.dumps(data, indent=2, default=str)}")
    upsert_property(conn, data)
    log.info(f"Saved {property_id}")
    conn.close()


def scrape_range(start: int, end: int):
    session = make_session()
    conn = get_db()
    total = 0
    skipped = 0
    errors = 0
    start_time = time.time()

    log.info(f"Starting bulk scrape: R{start:09d} to R{end:09d} (~{end-start:,} IDs)")

    for num in range(start, end + 1):
        pid = f"R{num:09d}"

        try:
            html = fetch_html(pid, session)

            if not html:
                skipped += 1
                # Short sleep for non-existent IDs
                time.sleep(0.2 + random.random() * 0.15)
                if num % 1000 == 0:
                    elapsed = time.time() - start_time
                    rate = (num - start) / elapsed * 3600 if elapsed > 0 else 0
                    log.info(f"[{pid}] saved={total:,} skipped={skipped:,} errors={errors} rate={rate:.0f}/hr")
                continue

            data = parse_property(html, pid)
            if not data:
                errors += 1
                time.sleep(0.5)
                continue

            # Skip properties with no improvement (land-only, commercial BPP)
            if not data.get("improvement_sqft") or data["improvement_sqft"] <= 0:
                skipped += 1
                time.sleep(0.3 + random.random() * 0.2)
                continue

            upsert_property(conn, data)
            total += 1

            if total % 100 == 0:
                elapsed = time.time() - start_time
                rate = total / elapsed * 3600 if elapsed > 0 else 0
                eta_hrs = (end - num) / (rate / 3600) / 3600 if rate > 0 else 0
                log.info(f"[{pid}] Saved {total:,} | rate={rate:.0f}/hr | ETA={eta_hrs:.1f}hrs")

            # Rate limit: ~1 req/sec with jitter
            time.sleep(0.8 + random.random() * 0.5)

        except KeyboardInterrupt:
            log.info(f"Interrupted at {pid}. Total saved: {total:,}")
            break
        except Exception as e:
            log.error(f"Error on {pid}: {e}")
            errors += 1
            time.sleep(2)
            # Refresh session on repeated errors
            if errors % 20 == 0:
                session = make_session()

    conn.close()
    log.info(f"Complete. Saved={total:,} | Skipped={skipped:,} | Errors={errors}")


def get_resume_id(conn) -> int:
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd")

    p_id = sub.add_parser("id")
    p_id.add_argument("property_id")

    p_range = sub.add_parser("range")
    p_range.add_argument("--start", type=int, default=1000)
    p_range.add_argument("--end", type=int, default=200000)

    p_resume = sub.add_parser("resume")
    p_resume.add_argument("--end", type=int, default=200000)

    args = parser.parse_args()

    if not DB_URL:
        log.error("DATABASE_URL not set")
        sys.exit(1)

    if args.cmd == "id":
        scrape_single(args.property_id)
    elif args.cmd == "range":
        scrape_range(args.start, args.end)
    elif args.cmd == "resume":
        conn = get_db()
        last = get_resume_id(conn)
        conn.close()
        log.info(f"Resuming from R{last+1:09d}")
        scrape_range(last + 1, args.end)
    else:
        parser.print_help()
