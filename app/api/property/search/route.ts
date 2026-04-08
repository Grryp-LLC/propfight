import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address || address.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  const result = await query(
    `SELECT property_id, situs_address, situs_city, situs_zip,
            owner_name, improvement_sqft, year_built
     FROM properties
     WHERE situs_address ILIKE $1
     ORDER BY situs_address
     LIMIT 25`,
    [`%${address.trim()}%`]
  );

  return NextResponse.json({ results: result.rows, query: address });
}
