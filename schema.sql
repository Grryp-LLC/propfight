-- PropFight schema for Neon Postgres

CREATE TABLE properties (
  property_id       TEXT PRIMARY KEY,
  geo_id            TEXT,
  owner_name        TEXT,
  situs_address     TEXT,
  situs_city        TEXT,
  situs_zip         TEXT,
  legal_description TEXT,
  acres             NUMERIC,
  land_sqft         INTEGER,
  improvement_sqft  INTEGER,
  year_built        INTEGER,
  building_class    TEXT,
  subdivision       TEXT,
  cad               TEXT DEFAULT 'PARKERCAD',
  scraped_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE property_values (
  id                SERIAL PRIMARY KEY,
  property_id       TEXT NOT NULL REFERENCES properties(property_id),
  year              INTEGER NOT NULL,
  land_value        NUMERIC,
  improvement_value NUMERIC,
  total_appraised   NUMERIC,
  market_value      NUMERIC,
  total_taxable     NUMERIC,
  UNIQUE(property_id, year)
);

CREATE TABLE property_sales (
  id                SERIAL PRIMARY KEY,
  property_id       TEXT NOT NULL REFERENCES properties(property_id),
  grantor           TEXT,
  grantee           TEXT,
  sale_date         DATE,
  deed_vol          TEXT,
  deed_page         TEXT,
  sale_price        NUMERIC
);

CREATE TABLE property_exemptions (
  id                SERIAL PRIMARY KEY,
  property_id       TEXT NOT NULL REFERENCES properties(property_id),
  year              INTEGER,
  exemption_type    TEXT,
  exemption_amount  NUMERIC
);
