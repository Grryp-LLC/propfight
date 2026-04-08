import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
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

  const property = await prisma.property.findUnique({
    where: { property_id: id },
    include: {
      values: { orderBy: { year: "desc" }, take: 5 },
      sales: { orderBy: { sale_date: "desc" } },
      exemptions: true,
    },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const latestValue = property.values[0];
  if (!latestValue) {
    return NextResponse.json({ property, analysis: null });
  }

  const subject: Property = {
    property_id: property.property_id,
    situs_address: property.situs_address || "",
    situs_city: property.situs_city,
    subdivision: property.subdivision,
    improvement_sqft: property.improvement_sqft || 0,
    year_built: property.year_built,
    building_class: property.building_class,
    total_appraised: Number(latestValue.total_appraised) || 0,
    land_value: Number(latestValue.land_value) || 0,
    improvement_value: Number(latestValue.improvement_value) || 0,
  };

  const compCandidates = await prisma.property.findMany({
    where: {
      property_id: { not: id },
      improvement_sqft: { gt: 0 },
      ...(property.subdivision ? { subdivision: property.subdivision } : {}),
    },
    include: {
      values: { where: { year: latestValue.year }, take: 1 },
    },
    take: 500,
  });

  const allProperties: Property[] = compCandidates
    .filter((p) => p.values.length > 0)
    .map((p) => ({
      property_id: p.property_id,
      situs_address: p.situs_address || "",
      situs_city: p.situs_city,
      subdivision: p.subdivision,
      improvement_sqft: p.improvement_sqft || 0,
      year_built: p.year_built,
      building_class: p.building_class,
      total_appraised: Number(p.values[0].total_appraised) || 0,
      land_value: Number(p.values[0].land_value) || 0,
      improvement_value: Number(p.values[0].improvement_value) || 0,
    }));

  const comps = findComparables(subject, allProperties);
  const analysis =
    comps.length > 0 ? calculateProtestValue(subject, comps) : null;

  return NextResponse.json({ property, analysis });
}
