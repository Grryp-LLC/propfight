import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

const SUBDIVISIONS = [
  "CLEAR CREEK TOWN HOMES",
  "YEOMANS",
  "ALEDO ESTATES",
  "WEATHERFORD HEIGHTS",
  "WILLOW PARK ESTATES",
];

const STREETS = [
  "Santa Fe Dr",
  "Fort Worth Hwy",
  "Tin Top Rd",
  "Bethel Rd",
  "Oak St",
  "Mockingbird Ln",
  "Pecan St",
  "Cedar Creek Dr",
  "Elm Ave",
  "Mesquite Trl",
];

const CITIES = ["Weatherford", "Willow Park", "Aledo", "Hudson Oaks"];

const FIRST_NAMES = [
  "Johnson", "Smith", "Williams", "Brown", "Davis", "Miller", "Wilson",
  "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris",
  "Martin", "Thompson", "Garcia", "Martinez", "Robinson", "Clark",
];

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface SeedProperty {
  property_id: string;
  owner_name: string;
  situs_address: string;
  situs_city: string;
  situs_zip: string;
  subdivision: string;
  improvement_sqft: number;
  year_built: number;
  building_class: string;
  acres: number;
  land_sqft: number;
  base_ppsf: number; // base price per sqft for value generation
  overappraised: boolean;
}

function generateProperties(): SeedProperty[] {
  const properties: SeedProperty[] = [];
  const usedAddresses = new Set<string>();

  for (let i = 0; i < 80; i++) {
    const subdivision = SUBDIVISIONS[i % SUBDIVISIONS.length];
    const street = pick(STREETS);
    let streetNum: number;
    let address: string;

    do {
      streetNum = rand(100, 9999);
      address = `${streetNum} ${street}`;
    } while (usedAddresses.has(address));
    usedAddresses.add(address);

    const city = pick(CITIES);
    const zip = pick(["76086", "76087", "76008", "76088"]);
    const sqft = rand(1200, 3800);
    const yearBuilt = rand(1975, 2022);
    const acres = parseFloat((sqft * 4 / 43560 + Math.random() * 0.3).toFixed(2));
    const landSqft = Math.round(acres * 43560);
    const overappraised = i < 18; // first 18 properties are overappraised

    // Base price per sqft varies by subdivision and age
    const ageFactor = 1 + (yearBuilt - 1975) * 0.005;
    const subdivisionBase: Record<string, number> = {
      "CLEAR CREEK TOWN HOMES": 135,
      "YEOMANS": 125,
      "ALEDO ESTATES": 165,
      "WEATHERFORD HEIGHTS": 120,
      "WILLOW PARK ESTATES": 150,
    };
    let basePpsf = (subdivisionBase[subdivision] || 130) * ageFactor;
    // Add some random variation (+-10%)
    basePpsf *= 0.9 + Math.random() * 0.2;

    if (overappraised) {
      // Make these 25-50% higher than normal
      basePpsf *= 1.25 + Math.random() * 0.25;
    }

    const propertyId = `R${String(rand(1, 999999)).padStart(9, "0")}`;

    properties.push({
      property_id: propertyId,
      owner_name: `${pick(FIRST_NAMES)}, ${pick(FIRST_NAMES).charAt(0)}`,
      situs_address: address,
      situs_city: city,
      situs_zip: zip,
      subdivision,
      improvement_sqft: sqft,
      year_built: yearBuilt,
      building_class: "Residential",
      acres,
      land_sqft: landSqft,
      base_ppsf: Math.round(basePpsf * 100) / 100,
      overappraised,
    });
  }

  return properties;
}

async function seed() {
  const client = await pool.connect();

  try {
    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS properties (
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

      CREATE TABLE IF NOT EXISTS property_values (
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

      CREATE TABLE IF NOT EXISTS property_sales (
        id                SERIAL PRIMARY KEY,
        property_id       TEXT NOT NULL REFERENCES properties(property_id),
        grantor           TEXT,
        grantee           TEXT,
        sale_date         DATE,
        deed_vol          TEXT,
        deed_page         TEXT,
        sale_price        NUMERIC
      );

      CREATE TABLE IF NOT EXISTS property_exemptions (
        id                SERIAL PRIMARY KEY,
        property_id       TEXT NOT NULL REFERENCES properties(property_id),
        year              INTEGER,
        exemption_type    TEXT,
        exemption_amount  NUMERIC
      );
    `);

    // Clear existing seed data
    await client.query("DELETE FROM property_exemptions");
    await client.query("DELETE FROM property_sales");
    await client.query("DELETE FROM property_values");
    await client.query("DELETE FROM properties");

    const properties = generateProperties();
    console.log(`Seeding ${properties.length} properties...`);

    for (const p of properties) {
      // Insert property
      await client.query(
        `INSERT INTO properties (property_id, owner_name, situs_address, situs_city, situs_zip,
           subdivision, improvement_sqft, year_built, building_class, acres, land_sqft, cad, scraped_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PARKERCAD', NOW())`,
        [
          p.property_id, p.owner_name, p.situs_address, p.situs_city, p.situs_zip,
          p.subdivision, p.improvement_sqft, p.year_built, p.building_class, p.acres, p.land_sqft,
        ]
      );

      // Insert values for years 2022-2026
      for (let year = 2022; year <= 2026; year++) {
        const yearGrowth = 1 + (year - 2022) * 0.06; // ~6% annual growth
        const ppsf = p.base_ppsf * yearGrowth;
        const improvementValue = Math.round(ppsf * p.improvement_sqft);
        const landValue = Math.round(p.land_sqft * 3.5 * yearGrowth);
        const totalAppraised = improvementValue + landValue;
        const marketValue = Math.round(totalAppraised * (1 + Math.random() * 0.05));

        await client.query(
          `INSERT INTO property_values (property_id, year, land_value, improvement_value, total_appraised, market_value, total_taxable)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (property_id, year) DO UPDATE SET
             land_value = EXCLUDED.land_value,
             improvement_value = EXCLUDED.improvement_value,
             total_appraised = EXCLUDED.total_appraised,
             market_value = EXCLUDED.market_value,
             total_taxable = EXCLUDED.total_taxable`,
          [p.property_id, year, landValue, improvementValue, totalAppraised, marketValue, totalAppraised]
        );
      }

      // Add a sale record for some properties
      if (Math.random() > 0.5) {
        const saleYear = rand(2015, 2024);
        const saleMonth = rand(1, 12);
        const saleDay = rand(1, 28);
        const salePrice = Math.round(p.base_ppsf * p.improvement_sqft * (0.9 + Math.random() * 0.3));

        await client.query(
          `INSERT INTO property_sales (property_id, grantor, grantee, sale_date, deed_vol, deed_page, sale_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            p.property_id,
            `${pick(FIRST_NAMES)}, ${pick(FIRST_NAMES).charAt(0)}`,
            p.owner_name,
            `${saleYear}-${String(saleMonth).padStart(2, "0")}-${String(saleDay).padStart(2, "0")}`,
            String(rand(1000, 9999)),
            String(rand(1, 500)),
            salePrice,
          ]
        );
      }

      // Add homestead exemption for some
      if (Math.random() > 0.3) {
        await client.query(
          `INSERT INTO property_exemptions (property_id, year, exemption_type, exemption_amount)
           VALUES ($1, 2026, 'Homestead', 100000)`,
          [p.property_id]
        );
      }
    }

    console.log("Seed complete!");

    // Print summary
    const countResult = await client.query("SELECT COUNT(*) FROM properties");
    const overResult = await client.query(`
      SELECT COUNT(*) FROM properties p
      JOIN property_values pv ON p.property_id = pv.property_id AND pv.year = 2026
      WHERE pv.total_appraised / NULLIF(p.improvement_sqft, 0) > (
        SELECT AVG(pv2.total_appraised / NULLIF(p2.improvement_sqft, 0))
        FROM properties p2
        JOIN property_values pv2 ON p2.property_id = pv2.property_id AND pv2.year = 2026
        WHERE p2.subdivision = p.subdivision AND p2.improvement_sqft > 0
      ) * 1.15
    `);

    console.log(`Total properties: ${countResult.rows[0].count}`);
    console.log(`Overappraised (>15% above subdivision avg): ${overResult.rows[0].count}`);

    // Show subdivision breakdown
    const subdResult = await client.query(`
      SELECT p.subdivision, COUNT(*) as count,
             ROUND(AVG(pv.total_appraised / NULLIF(p.improvement_sqft, 0))::numeric, 2) as avg_ppsf
      FROM properties p
      JOIN property_values pv ON p.property_id = pv.property_id AND pv.year = 2026
      WHERE p.improvement_sqft > 0
      GROUP BY p.subdivision
      ORDER BY p.subdivision
    `);
    console.log("\nSubdivision breakdown:");
    for (const row of subdResult.rows) {
      console.log(`  ${row.subdivision}: ${row.count} properties, avg $${row.avg_ppsf}/sqft`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
