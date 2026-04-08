import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedProperty {
  property_id: string;
  geo_id: string;
  owner_name: string;
  situs_address: string;
  situs_city: string;
  situs_zip: string;
  legal_description: string;
  acres: number;
  land_sqft: number;
  improvement_sqft: number;
  year_built: number;
  building_class: string;
  subdivision: string;
  values: { year: number; land: number; improvement: number; total: number; market: number }[];
}

const SUBDIVISIONS = [
  "CLEAR CREEK TOWN HOMES",
  "YEOMANS",
  "ALEDO ESTATES",
  "WEATHERFORD HEIGHTS",
];

const STREETS: Record<string, string[]> = {
  "CLEAR CREEK TOWN HOMES": ["100 Clear Creek Dr", "102 Clear Creek Dr", "104 Clear Creek Dr", "106 Clear Creek Dr", "108 Clear Creek Dr", "110 Clear Creek Dr", "112 Clear Creek Dr", "200 Clear Creek Dr", "202 Clear Creek Dr", "204 Clear Creek Dr", "206 Clear Creek Dr", "208 Clear Creek Dr", "210 Clear Creek Dr"],
  "YEOMANS": ["301 Santa Fe Dr", "305 Santa Fe Dr", "309 Santa Fe Dr", "313 Santa Fe Dr", "317 Santa Fe Dr", "321 Santa Fe Dr", "325 Santa Fe Dr", "329 Santa Fe Dr", "333 Santa Fe Dr", "337 Santa Fe Dr", "341 Santa Fe Dr", "345 Santa Fe Dr", "349 Santa Fe Dr"],
  "ALEDO ESTATES": ["1001 Bethel Rd", "1005 Bethel Rd", "1009 Bethel Rd", "1013 Bethel Rd", "1017 Bethel Rd", "1021 Bethel Rd", "1025 Bethel Rd", "1029 Bethel Rd", "1033 Bethel Rd", "1037 Bethel Rd", "1041 Bethel Rd", "1045 Bethel Rd", "1049 Bethel Rd"],
  "WEATHERFORD HEIGHTS": ["500 Tin Top Rd", "504 Tin Top Rd", "508 Tin Top Rd", "512 Tin Top Rd", "516 Tin Top Rd", "520 Tin Top Rd", "524 Tin Top Rd", "528 Tin Top Rd", "532 Tin Top Rd", "536 Tin Top Rd", "540 Tin Top Rd"],
};

const FIRST_NAMES = ["JOHN", "MARY", "JAMES", "PATRICIA", "ROBERT", "JENNIFER", "MICHAEL", "LINDA", "WILLIAM", "ELIZABETH", "DAVID", "BARBARA", "RICHARD", "SUSAN", "THOMAS", "JESSICA", "CHARLES", "SARAH", "DANIEL", "KAREN"];
const LAST_NAMES = ["SMITH", "JOHNSON", "WILLIAMS", "BROWN", "JONES", "GARCIA", "MILLER", "DAVIS", "RODRIGUEZ", "MARTINEZ", "HERNANDEZ", "LOPEZ", "GONZALEZ", "WILSON", "ANDERSON", "THOMAS", "TAYLOR", "MOORE", "JACKSON", "MARTIN"];

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function generateProperties(): SeedProperty[] {
  const properties: SeedProperty[] = [];
  let idCounter = 34700;

  for (const subdivision of SUBDIVISIONS) {
    const streets = STREETS[subdivision];
    // Base characteristics per subdivision
    const isUpscale = subdivision === "ALEDO ESTATES";
    const isTownhome = subdivision === "CLEAR CREEK TOWN HOMES";

    for (let i = 0; i < streets.length && properties.length < 50; i++) {
      const propId = `R0000${idCounter.toString().padStart(5, "0")}`;
      idCounter++;

      const firstName = FIRST_NAMES[rand(0, FIRST_NAMES.length - 1)];
      const lastName = LAST_NAMES[rand(0, LAST_NAMES.length - 1)];

      let sqft: number, yearBuilt: number, basePPSF: number, acres: number;

      if (isTownhome) {
        sqft = rand(1200, 1800);
        yearBuilt = rand(2005, 2020);
        basePPSF = randFloat(110, 145);
        acres = randFloat(0.08, 0.15);
      } else if (isUpscale) {
        sqft = rand(2400, 3500);
        yearBuilt = rand(2000, 2022);
        basePPSF = randFloat(125, 175);
        acres = randFloat(0.5, 2.0);
      } else if (subdivision === "YEOMANS") {
        sqft = rand(1500, 2600);
        yearBuilt = rand(1985, 2010);
        basePPSF = randFloat(100, 140);
        acres = randFloat(0.2, 0.5);
      } else {
        // WEATHERFORD HEIGHTS
        sqft = rand(1400, 2200);
        yearBuilt = rand(1980, 2005);
        basePPSF = randFloat(95, 135);
        acres = randFloat(0.15, 0.4);
      }

      const landSqft = Math.round(acres * 43560);

      // Intentionally make some properties "overappraised" (higher $/sqft than neighbors)
      let ppsfMultiplier = 1.0;
      if (i % 5 === 0) {
        // Every 5th property is overappraised by 15-30%
        ppsfMultiplier = randFloat(1.15, 1.30);
      } else if (i % 7 === 0) {
        // Some are underappraised
        ppsfMultiplier = randFloat(0.80, 0.92);
      }

      const effectivePPSF = basePPSF * ppsfMultiplier;
      const improvementValue2026 = Math.round(effectivePPSF * sqft);
      const landValue2026 = Math.round(acres * (isUpscale ? 120000 : isTownhome ? 50000 : 75000));
      const total2026 = landValue2026 + improvementValue2026;

      // Generate 5 years of history with ~5-8% annual increases
      const values = [];
      for (let y = 2026; y >= 2022; y--) {
        const yearFactor = Math.pow(0.94, 2026 - y);
        const landVal = Math.round(landValue2026 * yearFactor);
        const improvVal = Math.round(improvementValue2026 * yearFactor);
        const totalVal = landVal + improvVal;
        values.push({
          year: y,
          land: landVal,
          improvement: improvVal,
          total: totalVal,
          market: Math.round(totalVal * randFloat(1.0, 1.05)),
        });
      }

      properties.push({
        property_id: propId,
        geo_id: `PC${propId.slice(1)}`,
        owner_name: `${lastName}, ${firstName}`,
        situs_address: streets[i],
        situs_city: "WEATHERFORD",
        situs_zip: "76086",
        legal_description: `${subdivision} LOT ${i + 1}`,
        acres,
        land_sqft: landSqft,
        improvement_sqft: sqft,
        year_built: yearBuilt,
        building_class: "RESIDENTIAL",
        subdivision,
        values,
      });
    }
  }

  return properties;
}

async function seed() {
  console.log("Seeding sample data...");
  const properties = generateProperties();

  for (const prop of properties) {
    await prisma.property.upsert({
      where: { property_id: prop.property_id },
      update: {
        geo_id: prop.geo_id,
        owner_name: prop.owner_name,
        situs_address: prop.situs_address,
        situs_city: prop.situs_city,
        situs_zip: prop.situs_zip,
        legal_description: prop.legal_description,
        acres: prop.acres,
        land_sqft: prop.land_sqft,
        improvement_sqft: prop.improvement_sqft,
        year_built: prop.year_built,
        building_class: prop.building_class,
        subdivision: prop.subdivision,
      },
      create: {
        property_id: prop.property_id,
        geo_id: prop.geo_id,
        owner_name: prop.owner_name,
        situs_address: prop.situs_address,
        situs_city: prop.situs_city,
        situs_zip: prop.situs_zip,
        legal_description: prop.legal_description,
        acres: prop.acres,
        land_sqft: prop.land_sqft,
        improvement_sqft: prop.improvement_sqft,
        year_built: prop.year_built,
        building_class: prop.building_class,
        subdivision: prop.subdivision,
      },
    });

    for (const val of prop.values) {
      await prisma.propertyValue.upsert({
        where: {
          property_id_year: {
            property_id: prop.property_id,
            year: val.year,
          },
        },
        update: {
          land_value: val.land,
          improvement_value: val.improvement,
          total_appraised: val.total,
          market_value: val.market,
        },
        create: {
          property_id: prop.property_id,
          year: val.year,
          land_value: val.land,
          improvement_value: val.improvement,
          total_appraised: val.total,
          market_value: val.market,
        },
      });
    }

    console.log(`  Seeded: ${prop.situs_address} (${prop.property_id})`);
  }

  console.log(`\nDone! Seeded ${properties.length} properties with value history.`);
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
