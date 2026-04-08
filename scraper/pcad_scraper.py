"""
Parker County Appraisal District (PCAD) property scraper.

Fetches property data from the PCAD web portal, parses HTML pages,
and upserts records into a PostgreSQL database.
"""

import argparse
import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import psycopg2
import psycopg2.extras
import requests
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("pcad_scraper")


class PCADScraper:
    """Scraper for the Parker County Appraisal District web portal."""

    def __init__(
        self,
        db_url: str,
        base_url: str = "https://propaccess.trueautomation.com/parkercad",
        cad_key: str = "parkercad",
    ):
        self.db_url = db_url
        self.base_url = base_url.rstrip("/")
        self.cad_key = cad_key

        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Connection": "keep-alive",
            }
        )

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search_by_address(
        self, street_name: str, street_number: str = ""
    ) -> List[str]:
        """Search PCAD by situs address and return a list of property IDs."""
        timestamp = int(time.time() * 1000)
        url = (
            f"{self.base_url}/webSearchAddress.aspx"
            f"?dbkey={self.cad_key}"
            f"&stype=situs"
            f"&sdata={street_name}|{street_number}|"
            f"&time={timestamp}"
        )
        logger.info("Searching address: street=%s number=%s", street_name, street_number)

        try:
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:
            logger.error("Address search request failed: %s", exc)
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        hidden = soup.find("input", {"id": "hfPropArray"})
        if not hidden or not hidden.get("value"):
            logger.warning("No hfPropArray found in search results")
            return []

        raw = hidden["value"].strip()
        # Property IDs are 10-char strings starting with 'R', concatenated.
        property_ids = re.findall(r"R\d{9}", raw)
        logger.info("Found %d property IDs from address search", len(property_ids))
        return property_ids

    # ------------------------------------------------------------------
    # Fetch & Parse
    # ------------------------------------------------------------------

    def fetch_property(self, property_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a single property page and return parsed data."""
        url = (
            f"{self.base_url}/webProperty.aspx"
            f"?dbkey={self.cad_key}&id={property_id}"
        )
        logger.info("Fetching property %s", property_id)

        try:
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as exc:
            logger.error("Failed to fetch property %s: %s", property_id, exc)
            return None

        return self.parse_property_page(resp.text, property_id)

    def parse_property_page(
        self, html: str, property_id: str
    ) -> Optional[Dict[str, Any]]:
        """Parse a PCAD property detail page into a structured dict."""
        soup = BeautifulSoup(html, "html.parser")

        data: Dict[str, Any] = {"property_id": property_id}

        # --- Owner ---
        owner_el = soup.find(id="webprop_name")
        data["owner"] = owner_el.get_text(strip=True) if owner_el else None

        # --- Geo ID ---
        geo_el = soup.find(id="ucidentification_webprop_geoid")
        data["geo_id"] = geo_el.get_text(strip=True) if geo_el else None

        # --- Situs address ---
        situs_el = soup.find(id="webprop_situs")
        if not situs_el:
            situs_el = soup.find(id="ucidentification_webprop_situs")
        data["situs_address"] = situs_el.get_text(strip=True) if situs_el else None

        # --- Identification table rows ---
        data["identification"] = self._parse_identification(soup)

        # --- Improvement details ---
        data["improvements"] = self._parse_improvements(soup)

        # --- Land details ---
        data["land"] = self._parse_land(soup)

        # --- Appraised values (multi-year) ---
        data["appraised_values"] = self._parse_appraised_values(soup)

        # --- Sale history ---
        data["sales"] = self._parse_sales(soup)

        # --- Exemptions ---
        data["exemptions"] = self._parse_exemptions(soup)

        if not data["owner"] and not data["geo_id"]:
            logger.warning("Property %s page appears empty or unparseable", property_id)
            return None

        return data

    # ------------------------------------------------------------------
    # Section parsers (private)
    # ------------------------------------------------------------------

    @staticmethod
    def _text(el: Optional[Tag]) -> Optional[str]:
        """Safely extract stripped text from a BS4 element."""
        if el is None:
            return None
        txt = el.get_text(strip=True)
        return txt if txt else None

    def _parse_identification(self, soup: BeautifulSoup) -> Dict[str, Optional[str]]:
        """Parse the identification / property-detail rows."""
        details: Dict[str, Optional[str]] = {}
        # Common pattern: <th>Label</th><td>Value</td> inside identification section.
        section = soup.find(id="ucidentification")
        if not section:
            # Fallback: look for any table near the geo-id field.
            section = soup
        for row in section.find_all("tr"):
            cells = row.find_all(["th", "td"])
            if len(cells) >= 2:
                label = self._text(cells[0])
                value = self._text(cells[1])
                if label:
                    key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
                    details[key] = value
        return details

    def _parse_improvements(self, soup: BeautifulSoup) -> List[Dict[str, Optional[str]]]:
        """Parse the improvement details table."""
        improvements: List[Dict[str, Optional[str]]] = []
        table = (
            soup.find("table", id=re.compile(r"improvement", re.I))
            or soup.find("table", {"class": re.compile(r"improvement", re.I)})
        )
        if not table:
            # Attempt header-based lookup
            header = soup.find(string=re.compile(r"Improvement\s+Detail", re.I))
            if header:
                table = header.find_parent("table")

        if not table:
            return improvements

        rows = table.find_all("tr")
        headers: List[str] = []
        for row in rows:
            ths = row.find_all("th")
            if ths:
                headers = [self._text(th) or "" for th in ths]
                continue
            tds = row.find_all("td")
            if not tds:
                continue
            values = [self._text(td) for td in tds]
            if headers:
                record = dict(zip(headers, values))
            else:
                # Positional fallback: type, description, year_built, sqft, value
                keys = ["type", "description", "year_built", "sqft", "value"]
                record = dict(zip(keys, values))
            improvements.append(record)

        return improvements

    def _parse_land(self, soup: BeautifulSoup) -> List[Dict[str, Optional[str]]]:
        """Parse the land details table."""
        land: List[Dict[str, Optional[str]]] = []
        table = (
            soup.find("table", id=re.compile(r"land", re.I))
            or soup.find("table", {"class": re.compile(r"land", re.I)})
        )
        if not table:
            header = soup.find(string=re.compile(r"Land\s+Detail", re.I))
            if header:
                table = header.find_parent("table")

        if not table:
            return land

        rows = table.find_all("tr")
        headers: List[str] = []
        for row in rows:
            ths = row.find_all("th")
            if ths:
                headers = [self._text(th) or "" for th in ths]
                continue
            tds = row.find_all("td")
            if not tds:
                continue
            values = [self._text(td) for td in tds]
            if headers:
                record = dict(zip(headers, values))
            else:
                keys = ["land_code", "description", "acres", "sqft", "value"]
                record = dict(zip(keys, values))
            land.append(record)

        return land

    def _parse_appraised_values(
        self, soup: BeautifulSoup
    ) -> List[Dict[str, Optional[str]]]:
        """Parse the multi-year appraised values table."""
        values: List[Dict[str, Optional[str]]] = []
        table = (
            soup.find("table", id=re.compile(r"appraised|valuation", re.I))
            or soup.find("table", {"class": re.compile(r"appraised|valuation", re.I)})
        )
        if not table:
            header = soup.find(string=re.compile(r"Appraised\s+Value", re.I))
            if not header:
                header = soup.find(string=re.compile(r"Value\s+History", re.I))
            if header:
                table = header.find_parent("table")

        if not table:
            return values

        rows = table.find_all("tr")
        headers: List[str] = []
        for row in rows:
            ths = row.find_all("th")
            if ths:
                headers = [self._text(th) or "" for th in ths]
                continue
            tds = row.find_all("td")
            if not tds:
                continue
            vals = [self._text(td) for td in tds]
            if headers:
                record = dict(zip(headers, vals))
            else:
                keys = ["year", "land", "improvement", "total", "market"]
                record = dict(zip(keys, vals))
            values.append(record)

        return values

    def _parse_sales(self, soup: BeautifulSoup) -> List[Dict[str, Optional[str]]]:
        """Parse the sale / deed history table."""
        sales: List[Dict[str, Optional[str]]] = []
        table = (
            soup.find("table", id=re.compile(r"sale|deed", re.I))
            or soup.find("table", {"class": re.compile(r"sale|deed", re.I)})
        )
        if not table:
            header = soup.find(string=re.compile(r"Sale|Deed", re.I))
            if header:
                table = header.find_parent("table")

        if not table:
            return sales

        rows = table.find_all("tr")
        headers: List[str] = []
        for row in rows:
            ths = row.find_all("th")
            if ths:
                headers = [self._text(th) or "" for th in ths]
                continue
            tds = row.find_all("td")
            if not tds:
                continue
            vals = [self._text(td) for td in tds]
            if headers:
                record = dict(zip(headers, vals))
            else:
                keys = ["grantor", "grantee", "deed_vol", "deed_page", "date", "price"]
                record = dict(zip(keys, vals))
            sales.append(record)

        return sales

    def _parse_exemptions(self, soup: BeautifulSoup) -> List[str]:
        """Parse exemptions section, returning a list of exemption codes/descriptions."""
        exemptions: List[str] = []
        section = soup.find(id=re.compile(r"exemption", re.I))
        if not section:
            header = soup.find(string=re.compile(r"Exemption", re.I))
            if header:
                section = header.find_parent("table") or header.find_parent("div")

        if not section:
            return exemptions

        for row in section.find_all("tr"):
            text = row.get_text(strip=True)
            if text and text.lower() != "exemptions":
                exemptions.append(text)

        # Deduplicate while preserving order
        seen = set()
        unique: List[str] = []
        for e in exemptions:
            if e not in seen:
                seen.add(e)
                unique.append(e)
        return unique

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------

    def _get_connection(self) -> psycopg2.extensions.connection:
        """Create a new database connection."""
        conn = psycopg2.connect(self.db_url)
        conn.autocommit = False
        return conn

    def save_property(
        self, conn: psycopg2.extensions.connection, data: Dict[str, Any]
    ) -> None:
        """Upsert a property record into the database.

        Stores the core scalar fields in columns and the nested detail
        sections (improvements, land, appraised_values, sales, exemptions)
        as JSONB.
        """
        if not data:
            return

        sql = """
            INSERT INTO properties (
                property_id,
                owner,
                geo_id,
                situs_address,
                identification,
                improvements,
                land,
                appraised_values,
                sales,
                exemptions,
                raw_data,
                scraped_at
            ) VALUES (
                %(property_id)s,
                %(owner)s,
                %(geo_id)s,
                %(situs_address)s,
                %(identification)s,
                %(improvements)s,
                %(land)s,
                %(appraised_values)s,
                %(sales)s,
                %(exemptions)s,
                %(raw_data)s,
                NOW()
            )
            ON CONFLICT (property_id) DO UPDATE SET
                owner            = EXCLUDED.owner,
                geo_id           = EXCLUDED.geo_id,
                situs_address    = EXCLUDED.situs_address,
                identification   = EXCLUDED.identification,
                improvements     = EXCLUDED.improvements,
                land             = EXCLUDED.land,
                appraised_values = EXCLUDED.appraised_values,
                sales            = EXCLUDED.sales,
                exemptions       = EXCLUDED.exemptions,
                raw_data         = EXCLUDED.raw_data,
                scraped_at       = NOW();
        """

        params = {
            "property_id": data["property_id"],
            "owner": data.get("owner"),
            "geo_id": data.get("geo_id"),
            "situs_address": data.get("situs_address"),
            "identification": json.dumps(data.get("identification", {})),
            "improvements": json.dumps(data.get("improvements", [])),
            "land": json.dumps(data.get("land", [])),
            "appraised_values": json.dumps(data.get("appraised_values", [])),
            "sales": json.dumps(data.get("sales", [])),
            "exemptions": json.dumps(data.get("exemptions", [])),
            "raw_data": json.dumps(data),
        }

        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
            conn.commit()
            logger.info("Saved property %s", data["property_id"])
        except psycopg2.Error as exc:
            conn.rollback()
            logger.error("Database error saving %s: %s", data["property_id"], exc)
            raise

    # ------------------------------------------------------------------
    # High-level operations
    # ------------------------------------------------------------------

    def scrape_range(self, start_id: int, end_id: int) -> None:
        """Scrape a numeric range of property IDs (R000000001 style).

        Fetches each property, saves to the database, and rate-limits
        to 1-2 requests per second with a random delay.
        """
        conn = self._get_connection()
        total = end_id - start_id + 1
        success = 0
        errors = 0

        logger.info(
            "Starting range scrape: R%09d through R%09d (%d properties)",
            start_id,
            end_id,
            total,
        )

        try:
            for i, num in enumerate(range(start_id, end_id + 1), start=1):
                property_id = f"R{num:09d}"

                try:
                    data = self.fetch_property(property_id)
                    if data:
                        self.save_property(conn, data)
                        success += 1
                    else:
                        logger.debug("No data for %s (may not exist)", property_id)
                except Exception:
                    errors += 1
                    logger.exception("Error processing %s", property_id)

                if i % 100 == 0:
                    logger.info(
                        "Progress: %d/%d (success=%d, errors=%d)",
                        i,
                        total,
                        success,
                        errors,
                    )

                # Rate limit: random delay between 1.0 and 2.0 seconds
                time.sleep(random.uniform(1.0, 2.0))
        except KeyboardInterrupt:
            logger.warning("Scrape interrupted by user at property %d/%d", i, total)
        finally:
            conn.close()

        logger.info(
            "Range scrape complete: %d success, %d errors out of %d attempted",
            success,
            errors,
            total,
        )

    def lookup_address(self, street_name: str, street_number: str = "") -> None:
        """Search for an address, fetch each matching property, and save."""
        property_ids = self.search_by_address(street_name, street_number)
        if not property_ids:
            logger.warning("No properties found for address query")
            return

        conn = self._get_connection()
        try:
            for pid in property_ids:
                data = self.fetch_property(pid)
                if data:
                    self.save_property(conn, data)
                    logger.info("Saved property %s", pid)
                time.sleep(random.uniform(1.0, 2.0))
        finally:
            conn.close()


# ----------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parker County Appraisal District property scraper"
    )
    parser.add_argument(
        "--db-url",
        default=os.getenv("DATABASE_URL"),
        help="PostgreSQL connection string (default: $DATABASE_URL)",
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv(
            "PCAD_BASE_URL",
            "https://propaccess.trueautomation.com/parkercad",
        ),
        help="PCAD web portal base URL",
    )
    parser.add_argument(
        "--cad-key",
        default=os.getenv("PCAD_CAD_KEY", "parkercad"),
        help="CAD database key parameter",
    )

    sub = parser.add_subparsers(dest="command")

    # -- range --
    range_p = sub.add_parser("range", help="Scrape a numeric range of property IDs")
    range_p.add_argument("start", type=int, help="Start of range (numeric portion)")
    range_p.add_argument("end", type=int, help="End of range (numeric portion)")

    # -- address --
    addr_p = sub.add_parser("address", help="Look up properties by situs address")
    addr_p.add_argument("street_name", help="Street name to search")
    addr_p.add_argument("street_number", nargs="?", default="", help="Street number")

    # -- id --
    id_p = sub.add_parser("id", help="Fetch a single property by ID")
    id_p.add_argument("property_id", help="Property ID (e.g. R000034732)")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if not args.db_url:
        logger.error("DATABASE_URL is required (set via --db-url or environment)")
        sys.exit(1)

    scraper = PCADScraper(
        db_url=args.db_url,
        base_url=args.base_url,
        cad_key=args.cad_key,
    )

    if args.command == "range":
        scraper.scrape_range(args.start, args.end)
    elif args.command == "address":
        scraper.lookup_address(args.street_name, args.street_number)
    elif args.command == "id":
        data = scraper.fetch_property(args.property_id)
        if data:
            conn = scraper._get_connection()
            try:
                scraper.save_property(conn, data)
            finally:
                conn.close()
            print(json.dumps(data, indent=2, default=str))
        else:
            logger.error("No data returned for %s", args.property_id)
            sys.exit(1)


if __name__ == "__main__":
    main()
