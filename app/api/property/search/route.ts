import { NextRequest, NextResponse } from "next/server";
import { formatStreetAddress } from "@/lib/address";
import { query } from "@/lib/db";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address || address.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  const normalized = address.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  const parts = normalized.split(" ");
  const searchPatterns = new Set([`%${normalized}%`]);

  if (/^\d+[A-Z]?$/i.test(parts[0] || "") && parts.length > 1) {
    const [houseNumber, ...streetParts] = parts;
    searchPatterns.add(`%${streetParts.join(" ")}%${houseNumber}%`);
  }

  const patterns = Array.from(searchPatterns);
  const whereClause = patterns
    .map((_, index) => `situs_address ILIKE $${index + 1}`)
    .join(" OR ");

  const result = await query(
    `SELECT property_id, situs_address, situs_city, situs_zip,
            owner_name, improvement_sqft, year_built
     FROM properties
     WHERE ${whereClause}
     ORDER BY situs_address
     LIMIT 25`,
    patterns
  );

  const results = result.rows.map((row) => ({
    ...row,
    situs_address: formatStreetAddress(row.situs_address),
  }));

  return NextResponse.json({ results, query: address });
}
