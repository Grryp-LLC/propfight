import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  findComparables,
  calculateProtestValue,
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
    situs_address: row.situs_address,
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
    situs_address: row.situs_address || "",
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
    situs_address: (r.situs_address as string) || "",
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
  const analysis =
    comps.length > 0 ? calculateProtestValue(subject, comps) : null;

  return NextResponse.json({ property, analysis });
}
