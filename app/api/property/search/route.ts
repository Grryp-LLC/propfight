import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json(
      { error: "address parameter is required" },
      { status: 400 }
    );
  }

  const searchTerm = address.trim();

  const results = await prisma.property.findMany({
    where: {
      situs_address: {
        contains: searchTerm,
        mode: "insensitive",
      },
    },
    select: {
      property_id: true,
      situs_address: true,
      situs_city: true,
      situs_zip: true,
      owner_name: true,
      improvement_sqft: true,
      year_built: true,
    },
    take: 25,
  });

  return NextResponse.json({ results, query: address });
}
