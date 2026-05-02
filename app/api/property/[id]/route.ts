import { NextRequest, NextResponse } from "next/server";
import { formatStreetAddress } from "@/lib/address";
import { query } from "@/lib/db";
import {
  findComparables,
  calculateProtestValue,
  findMarketComparables,
  calculateMarketValueAnalysis,
  type Property,
} from "@/lib/protest-analysis";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const propResult = await query(
    `SELECT p.*,
       (SELECT json_agg(row_to_json(v) ORDER BY v.year DESC)
        FROM (SELECT * FROM property_values WHERE property_id = p.property_id ORDER BY year DESC LIMIT 5) v
       ) AS values,
       (SELECT json_agg(row_to_json(s) ORDER BY s.sale_date DESC)
        FROM property_sales s WHERE s.property_id = p.property_id
       ) AS sales,
       (SELECT json_agg(row_to_json(e))
        FROM property_exemptions e WHERE e.property_id = p.property_id
       ) AS exemptions
     FROM properties p
     WHERE p.property_id = $1`,
    [id]
  );

  if (propResult.rows.length === 0) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const row = propResult.rows[0];
  const values = row.values || [];
  const latestValue = values[0] || null;

  const property = {
    property_id: row.property_id,
    geo_id: row.geo_id,
    owner_name: row.owner_name,
    situs_address: formatStreetAddress(row.situs_address),
    situs_city: row.situs_city,
    situs_zip: row.situs_zip,
    legal_description: row.legal_description,
    acres: row.acres,
    land_sqft: row.land_sqft,
    improvement_sqft: row.improvement_sqft,
    year_built: row.year_built,
    building_class: row.building_class,
    subdivision: row.subdivision,
    values,
    sales: row.sales || [],
    exemptions: row.exemptions || [],
  };

  if (!latestValue) {
    return NextResponse.json({ property, analysis: null });
  }

  const subject: Property = {
    property_id: row.property_id,
    situs_address: formatStreetAddress(row.situs_address),
    situs_city: row.situs_city,
    subdivision: row.subdivision,
    improvement_sqft: row.improvement_sqft || 0,
    year_built: row.year_built,
    building_class: row.building_class,
    total_appraised: Number(latestValue.total_appraised) || 0,
    land_value: Number(latestValue.land_value) || 0,
    improvement_value: Number(latestValue.improvement_value) || 0,
  };

  const compsResult = await query(
    `SELECT p.property_id, p.situs_address, p.situs_city, p.subdivision,
            p.improvement_sqft, p.year_built, p.building_class,
            pv.land_value, pv.improvement_value, pv.total_appraised
     FROM properties p
     JOIN property_values pv ON p.property_id = pv.property_id AND pv.year = $1
     WHERE p.subdivision = $2
       AND p.property_id != $3
       AND p.improvement_sqft > 0
       AND pv.total_appraised > 0
     LIMIT 500`,
    [latestValue.year, row.subdivision, id]
  );

  const allProperties: Property[] = compsResult.rows.map((r: Record<string, unknown>) => ({
    property_id: r.property_id as string,
    situs_address: formatStreetAddress(r.situs_address as string),
    situs_city: r.situs_city as string | null,
    subdivision: r.subdivision as string | null,
    improvement_sqft: r.improvement_sqft as number,
    year_built: r.year_built as number | null,
    building_class: r.building_class as string | null,
    total_appraised: Number(r.total_appraised),
    land_value: Number(r.land_value),
    improvement_value: Number(r.improvement_value),
  }));

  const comps = findComparables(subject, allProperties);
  let analysis = comps.length > 0 ? calculateProtestValue(subject, comps) : null;

  // Fetch recent market sales for market value argument
  const salesResult = await query(
    `SELECT id, address, city, zip, sale_price, sale_date, sqft,
            bedrooms, bathrooms, year_built
     FROM market_sales
     WHERE zip = $1
       AND sale_price > 0
       AND sqft > 0
       AND sale_date >= NOW() - INTERVAL '18 months'
     ORDER BY sale_date DESC
     LIMIT 200`,
    [row.situs_zip]
  );

  if (analysis && salesResult.rows.length > 0) {
    const marketSales = salesResult.rows.map((s: Record<string, unknown>) => ({
      id: s.id as number,
      address: s.address as string,
      city: s.city as string,
      zip: s.zip as string,
      sale_price: Number(s.sale_price),
      sale_date: s.sale_date as string,
      sqft: s.sqft as number,
      bedrooms: s.bedrooms as number | null,
      bathrooms: s.bathrooms as number | null,
      year_built: s.year_built as number | null,
    }));

    const marketComps = findMarketComparables(subject, marketSales);
    analysis.marketValue = calculateMarketValueAnalysis(subject, marketComps);
  } else if (analysis) {
    analysis.marketValue = null;
  }

  return NextResponse.json({ property, analysis });
}
