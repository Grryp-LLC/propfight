import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  findComparables,
  calculateProtestValue,
  formatCurrency,
  formatPerSqft,
  type Property,
} from "@/lib/protest-analysis";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const dbProperty = await prisma.property.findUnique({
    where: { property_id: id },
    include: {
      values: { orderBy: { year: "desc" }, take: 1 },
    },
  });

  if (!dbProperty) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const latestValue = dbProperty.values[0];
  if (!latestValue) {
    return NextResponse.json(
      { error: "No value data available" },
      { status: 404 }
    );
  }

  const subject: Property = {
    property_id: dbProperty.property_id,
    situs_address: dbProperty.situs_address || "",
    situs_city: dbProperty.situs_city,
    subdivision: dbProperty.subdivision,
    improvement_sqft: dbProperty.improvement_sqft || 0,
    year_built: dbProperty.year_built,
    building_class: dbProperty.building_class,
    total_appraised: Number(latestValue.total_appraised) || 0,
    land_value: Number(latestValue.land_value) || 0,
    improvement_value: Number(latestValue.improvement_value) || 0,
  };

  const compCandidates = await prisma.property.findMany({
    where: {
      property_id: { not: id },
      improvement_sqft: { gt: 0 },
      ...(dbProperty.subdivision
        ? { subdivision: dbProperty.subdivision }
        : {}),
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

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Property Tax Protest - ${dbProperty.situs_address}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; line-height: 1.5; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    h2 { font-size: 18px; margin: 24px 0 12px; border-bottom: 2px solid #1a56db; padding-bottom: 4px; }
    .header { text-align: center; margin-bottom: 32px; border-bottom: 3px solid #1a1a1a; padding-bottom: 16px; }
    .header p { color: #666; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 16px; }
    .info-grid dt { color: #666; font-size: 13px; }
    .info-grid dd { font-weight: bold; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    th, td { padding: 8px 12px; text-align: left; border: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: 600; }
    td.num { text-align: right; }
    .highlight { background: #fef3c7; font-weight: bold; }
    .savings { text-align: center; padding: 20px; background: #f0fdf4; border: 2px solid #16a34a; border-radius: 8px; margin: 16px 0; }
    .savings .amount { font-size: 32px; font-weight: bold; color: #16a34a; }
    .basis { background: #eff6ff; padding: 16px; border-radius: 8px; margin: 16px 0; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 12px; color: #666; text-align: center; }
    @media print { body { padding: 20px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="no-print" style="background:#1a56db;color:white;padding:12px 20px;margin:-40px -40px 24px;text-align:center;">
    <button onclick="window.print()" style="background:white;color:#1a56db;border:none;padding:8px 24px;border-radius:4px;font-weight:bold;cursor:pointer;">Print / Save as PDF</button>
  </div>

  <div class="header">
    <h1>Property Tax Protest Packet</h1>
    <p>Prepared for ARB Hearing &mdash; Parker County Appraisal District</p>
    <p>Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
  </div>

  <h2>Subject Property</h2>
  <dl class="info-grid">
    <dt>Address</dt><dd>${dbProperty.situs_address}, ${dbProperty.situs_city || "Weatherford"}, TX ${dbProperty.situs_zip || ""}</dd>
    <dt>Property ID</dt><dd>${dbProperty.property_id}</dd>
    <dt>Subdivision</dt><dd>${dbProperty.subdivision || "N/A"}</dd>
    <dt>Year Built</dt><dd>${dbProperty.year_built || "N/A"}</dd>
    <dt>Improvement Sq Ft</dt><dd>${dbProperty.improvement_sqft?.toLocaleString() || "N/A"}</dd>
    <dt>Total Appraised (${latestValue.year})</dt><dd>${formatCurrency(Number(latestValue.total_appraised))}</dd>
    <dt>Assessed $/Sq Ft</dt><dd>${analysis ? formatPerSqft(analysis.subjectPPSF) : "N/A"}</dd>
  </dl>

  <h2>Basis of Protest: Unequal Appraisal</h2>
  <div class="basis">
    <p>Pursuant to Texas Property Tax Code &sect;41.43(b)(3), this protest is based on <strong>unequal appraisal</strong>.
    The subject property&rsquo;s appraised value per square foot is higher than the median of comparable properties
    in the same area, indicating the property is not appraised equally and uniformly.</p>
    ${analysis ? `
    <p style="margin-top:12px;"><strong>Subject property assessed value per sq ft:</strong> ${formatPerSqft(analysis.subjectPPSF)}</p>
    <p><strong>Median of ${analysis.comparables.length} comparable properties:</strong> ${formatPerSqft(analysis.medianCompPPSF)}</p>
    <p><strong>Suggested appraised value:</strong> ${formatCurrency(analysis.suggestedValue)} (${formatPerSqft(analysis.medianCompPPSF)} &times; ${subject.improvement_sqft.toLocaleString()} sq ft)</p>
    ` : "<p>Insufficient comparable data available.</p>"}
  </div>

  ${analysis && analysis.isOverappraised ? `
  <div class="savings">
    <p>Potential Appraisal Reduction</p>
    <p class="amount">${formatCurrency(analysis.potentialReduction)}</p>
    <p style="font-size:14px;color:#666;">Estimated annual tax savings: ${formatCurrency(analysis.estimatedTaxSavings)} (at 2.5% effective rate)</p>
  </div>
  ` : ""}

  ${analysis ? `
  <h2>Comparable Properties Analysis</h2>
  <table>
    <thead>
      <tr>
        <th>Address</th>
        <th>Sq Ft</th>
        <th>Year Built</th>
        <th>Total Appraised</th>
        <th>$/Sq Ft</th>
      </tr>
    </thead>
    <tbody>
      <tr class="highlight">
        <td>${dbProperty.situs_address} (SUBJECT)</td>
        <td class="num">${subject.improvement_sqft.toLocaleString()}</td>
        <td class="num">${dbProperty.year_built || "&mdash;"}</td>
        <td class="num">${formatCurrency(subject.total_appraised)}</td>
        <td class="num">${formatPerSqft(analysis.subjectPPSF)}</td>
      </tr>
      ${analysis.comparables.map((c) => `
      <tr>
        <td>${c.situs_address}</td>
        <td class="num">${c.improvement_sqft.toLocaleString()}</td>
        <td class="num">${c.year_built || "&mdash;"}</td>
        <td class="num">${formatCurrency(c.total_appraised)}</td>
        <td class="num">${formatPerSqft(c.assessed_per_sqft)}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  <p style="font-size:13px;color:#666;margin-top:8px;">
    Median $/sq ft of comparables: ${formatPerSqft(analysis.medianCompPPSF)} |
    Mean $/sq ft of comparables: ${formatPerSqft(analysis.meanCompPPSF)}
  </p>
  ` : ""}

  <h2>Filing Instructions</h2>
  <ol style="padding-left:20px;margin:12px 0;">
    <li>File a Notice of Protest with Parker County Appraisal District by <strong>May 15</strong> (or 30 days after your notice was mailed, whichever is later).</li>
    <li>Attend your informal hearing with this packet. Present the comparable properties showing your property is assessed above the median $/sq ft.</li>
    <li>If the informal hearing does not resolve the issue, request a formal ARB hearing.</li>
    <li>Contact PCAD: (817) 596-0077 | 1108 Santa Fe Dr, Weatherford, TX 76086</li>
  </ol>

  <div class="footer">
    <p>Generated by PropFight</p>
    <p>This document is for informational purposes only and does not constitute legal or tax advice.</p>
    <p>Data sourced from Parker County Appraisal District public records.</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
