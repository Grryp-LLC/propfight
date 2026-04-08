import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { street_name, street_number } = body;

  if (!street_name || !street_number) {
    return NextResponse.json(
      { error: "street_name and street_number are required" },
      { status: 400 }
    );
  }

  // In production, this would trigger the Python scraper to look up the address
  // from PCAD and add it to the database. For now, return a placeholder response.
  return NextResponse.json({
    message: "Lookup request queued",
    street_name,
    street_number,
    status: "pending",
    note: "In production, this triggers the PCAD scraper to fetch and store property data.",
  });
}
