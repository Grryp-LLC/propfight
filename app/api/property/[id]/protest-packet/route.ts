import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
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

  const propResult = await query(
    `SELECT p.*, pv.year, pv.land_value, pv.improvement_value,
            pv.total_appraised, pv.market_value
     FROM properties p
     LEFT JOIN property_values pv ON p.property_id = pv.property_id
     WHERE p.property_id = $1
     ORDER BY pv.year DESC
     LIMIT 1`,
    [id]
  );

  if (propResult.rows.length === 0) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const row = propResult.rows[0];
  if (!row.total_appraised) {
    return NextResponse.json({ error: "No value data available" }, { status: 404 });
  }

  const subject: Property = {
    property_id: row.property_id,
    situs_address: row.situs_address || "",
    situs_city: row.situs_city,
    subdivision: row.subdivision,
    improvement_sqft: row.improvement_sqft || 0,
    year_built: row.year_built,
    building_class: row.building_class,
    total_appraised: Number(row.total_appraised) || 0,
    land_value: Number(row.land_value) || 0,
    improvement_value: Number(row.improvement_value) || 0,
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
    [row.year, row.subdivision, id]
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
  const analysis = comps.length > 0 ? calculateProtestValue(subject, comps) : null;

  const property = row;
  const latestValue = { year: row.year, total_appraised: row.total_appraised };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Property Tax Protest - ${property.situs_address}</title>
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
    <p>Prepared for ARB Hearing -- Parker County Appraisal District</p>
    <p>Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
  </div>
  <h2>Subject Property</h2>
  <dl class="info-grid">
    <dt>Address</dt><dd>${property.situs_address}, ${property.situs_city || "Weatherford"}, TX ${property.situs_zip || ""}</dd>
    <dt>Property ID</dt><dd>${property.property_id}</dd>
    <dt>Subdivision</dt><dd>${property.subdivision || "N/A"}</dd>
    <dt>Year Built</dt><dd>${property.year_built || "N/A"}</dd>
    <dt>Improvement Sq Ft</dt><dd>${property.improvement_sqft?.toLocaleString() || "N/A"}</dd>
    <dt>Total Appraised (${latestValue.year})</dt><dd>${formatCurrency(Number(latestValue.total_appraised))}</dd>
    <dt>Assessed $/Sq Ft</dt><dd>${analysis ? formatPerSqft(analysis.subjectPPSF) : "N/A"}</dd>
  </dl>
  <h2>Basis of Protest: Unequal Appraisal</h2>
  <div class="basis">
    <p>Pursuant to Texas Property Tax Code S41.43(b)(3), this protest is based on <strong>unequal appraisal</strong>.
    The subject property's appraised value per square foot is higher than the median of comparable properties
    in the same area, indicating the property is not appraised equally and uniformly.</p>
    ${analysis ? `
    <p style="margin-top:12px;"><strong>Subject assessed $/sqft:</strong> ${formatPerSqft(analysis.subjectPPSF)}</p>
    <p><strong>Median of ${analysis.comparables.length} comps:</strong> ${formatPerSqft(analysis.medianCompPPSF)}</p>
    <p><strong>Suggested value:</strong> ${formatCurrency(analysis.suggestedValue)} (${formatPerSqft(analysis.medianCompPPSF)} x ${subject.improvement_sqft.toLocaleString()} sqft)</p>
    ` : "<p>Insufficient comparable data available.</p>"}
  </div>
  ${analysis && analysis.isOverappraised ? `
  <div class="savings">
    <p>Potential Appraisal Reduction</p>
    <p class="amount">${formatCurrency(analysis.potentialReduction)}</p>
    <p style="font-size:14px;color:#666;">Est. annual tax savings: ${formatCurrency(analysis.estimatedTaxSavings)} (at 2.5% effective rate)</p>
  </div>` : ""}
  ${analysis ? `
  <h2>Comparable Properties Analysis</h2>
  <table>
    <thead><tr><th>Address</th><th>Sq Ft</th><th>Year Built</th><th>Total Appraised</th><th>$/Sq Ft</th></tr></thead>
    <tbody>
      <tr class="highlight">
        <td>${property.situs_address} (SUBJECT)</td>
        <td class="num">${subject.improvement_sqft.toLocaleString()}</td>
        <td class="num">${property.year_built || "--"}</td>
        <td class="num">${formatCurrency(subject.total_appraised)}</td>
        <td class="num">${formatPerSqft(analysis.subjectPPSF)}</td>
      </tr>
      ${analysis.comparables.map((c) => `<tr>
        <td>${c.situs_address}</td>
        <td class="num">${c.improvement_sqft.toLocaleString()}</td>
        <td class="num">${c.year_built || "--"}</td>
        <td class="num">${formatCurrency(c.total_appraised)}</td>
        <td class="num">${formatPerSqft(c.assessed_per_sqft)}</td>
      </tr>`).join("")}
    </tbody>
  </table>
  <p style="font-size:13px;color:#666;margin-top:8px;">Median $/sqft: ${formatPerSqft(analysis.medianCompPPSF)} | Mean $/sqft: ${formatPerSqft(analysis.meanCompPPSF)}</p>
  ` : ""}
  <h2>Filing Instructions</h2>
  <ol style="padding-left:20px;margin:12px 0;">
    <li>File a Notice of Protest with PCAD by <strong>May 15</strong> (or 30 days after notice mailed, whichever is later).</li>
    <li>Attend your informal hearing with this packet.</li>
    <li>If unresolved, request a formal ARB hearing.</li>
    <li>Contact PCAD: (817) 596-0077 | 1108 Santa Fe Dr, Weatherford, TX 76086</li>
  </ol>
  <div class="footer">
    <p>Generated by PropFight</p>
    <p>For informational purposes only -- not legal or tax advice.</p>
    <p>Data from Parker County Appraisal District public records.</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
