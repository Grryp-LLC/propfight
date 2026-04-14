"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { formatCityState } from "@/lib/address";

interface PropertyValue {
  year: number;
  land_value: string;
  improvement_value: string;
  total_appraised: string;
  market_value: string | null;
}

interface Sale {
  id: number;
  grantor: string | null;
  grantee: string | null;
  sale_date: string | null;
  sale_price: string | null;
  deed_vol: string | null;
  deed_page: string | null;
}

interface PropertyData {
  property_id: string;
  geo_id: string | null;
  owner_name: string | null;
  situs_address: string;
  situs_city: string | null;
  situs_zip: string | null;
  acres: string | null;
  land_sqft: number | null;
  improvement_sqft: number | null;
  year_built: number | null;
  building_class: string | null;
  subdivision: string | null;
  values: PropertyValue[];
  sales: Sale[];
}

interface Comparable {
  property_id: string;
  situs_address: string;
  improvement_sqft: number;
  year_built: number | null;
  total_appraised: number;
  assessed_per_sqft: number;
}

interface Analysis {
  subjectPPSF: number;
  medianCompPPSF: number;
  meanCompPPSF: number;
  suggestedValue: number;
  potentialReduction: number;
  estimatedTaxSavings: number;
  isOverappraised: boolean;
  comparables: Comparable[];
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPsf(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export default function PropertyPage() {
  const params = useParams();
  const id = params.id as string;
  const [property, setProperty] = useState<PropertyData | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/property/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Property not found");
        return r.json();
      })
      .then((data) => {
        setProperty(data.property);
        setAnalysis(data.analysis);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading property details...</p>
      </div>
    );
  }

  if (error || !property) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "Property not found"}</p>
          <Link href="/" className="text-[#1a56db] underline">
            Back to search
          </Link>
        </div>
      </div>
    );
  }

  const latestValue = property.values?.[0] || null;

  return (
    <main className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-gray-900">
            Prop<span className="text-[#1a56db]">Fight</span>
          </Link>
          <Link
            href="/"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            New Search
          </Link>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Property Header */}
        <div className="bg-white rounded-xl shadow-sm p-8 mb-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {property.situs_address}
              </h1>
              <p className="text-gray-500">
                {formatCityState(property.situs_city)}
                {property.situs_zip ? ` ${property.situs_zip}` : ""}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                Property ID: {property.property_id}
                {property.geo_id && ` | Geo ID: ${property.geo_id}`}
              </p>
            </div>
            {analysis && analysis.isOverappraised && (
              <div className="bg-[#dc2626]/5 border border-[#dc2626]/20 rounded-lg px-4 py-2">
                <p className="text-[#dc2626] font-semibold text-sm">
                  Potentially Overappraised
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Property Details Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <p className="text-sm text-gray-500">Total Appraised</p>
            <p className="text-2xl font-bold text-gray-900">
              {latestValue ? fmt(Number(latestValue.total_appraised)) : "N/A"}
            </p>
            {latestValue && (
              <p className="text-xs text-gray-400 mt-1">
                {latestValue.year} value
              </p>
            )}
          </div>
          <div className="bg-white rounded-xl shadow-sm p-6">
            <p className="text-sm text-gray-500">Improvement Sq Ft</p>
            <p className="text-2xl font-bold text-gray-900">
              {property.improvement_sqft?.toLocaleString() ?? "N/A"}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-6">
            <p className="text-sm text-gray-500">Year Built</p>
            <p className="text-2xl font-bold text-gray-900">
              {property.year_built ?? "N/A"}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-6">
            <p className="text-sm text-gray-500">$/Sq Ft</p>
            <p className="text-2xl font-bold text-gray-900">
              {latestValue && property.improvement_sqft
                ? fmtPsf(
                    Number(latestValue.total_appraised) /
                      property.improvement_sqft
                  )
                : "N/A"}
            </p>
          </div>
        </div>

        {/* Value Breakdown */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4">Value Breakdown</h2>
            {latestValue ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Land Value</span>
                  <span className="font-medium">
                    {fmt(Number(latestValue.land_value))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Improvement Value</span>
                  <span className="font-medium">
                    {fmt(Number(latestValue.improvement_value))}
                  </span>
                </div>
                <div className="border-t pt-3 flex justify-between">
                  <span className="text-gray-900 font-semibold">
                    Total Appraised
                  </span>
                  <span className="font-bold">
                    {fmt(Number(latestValue.total_appraised))}
                  </span>
                </div>
                {latestValue.market_value && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Market Value</span>
                    <span className="font-medium">
                      {fmt(Number(latestValue.market_value))}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500">No value data available.</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4">Property Details</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Subdivision</span>
                <span className="font-medium">
                  {property.subdivision ?? "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Acres</span>
                <span className="font-medium">
                  {property.acres ? Number(property.acres).toFixed(2) : "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Land Sq Ft</span>
                <span className="font-medium">
                  {property.land_sqft?.toLocaleString() ?? "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Building Class</span>
                <span className="font-medium">
                  {property.building_class ?? "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Owner</span>
                <span className="font-medium">
                  {property.owner_name ?? "N/A"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Historical Values */}
        {property.values && property.values.length > 1 && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Appraisal History</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-gray-500">
                      Year
                    </th>
                    <th className="text-right py-2 font-medium text-gray-500">
                      Land
                    </th>
                    <th className="text-right py-2 font-medium text-gray-500">
                      Improvement
                    </th>
                    <th className="text-right py-2 font-medium text-gray-500">
                      Total Appraised
                    </th>
                    <th className="text-right py-2 font-medium text-gray-500">
                      Market
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {property.values.map((v) => (
                    <tr key={v.year} className="border-b last:border-0">
                      <td className="py-2 font-medium">{v.year}</td>
                      <td className="text-right py-2">
                        {fmt(Number(v.land_value))}
                      </td>
                      <td className="text-right py-2">
                        {fmt(Number(v.improvement_value))}
                      </td>
                      <td className="text-right py-2 font-medium">
                        {fmt(Number(v.total_appraised))}
                      </td>
                      <td className="text-right py-2">
                        {v.market_value ? fmt(Number(v.market_value)) : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Protest Analysis */}
        {analysis && (
          <>
            <div className="bg-white rounded-xl shadow-sm p-8 mb-6 border-2 border-[#1a56db]/20">
              <h2 className="text-xl font-bold mb-6">
                Unequal Appraisal Analysis
              </h2>
              <div className="grid md:grid-cols-3 gap-6 mb-6">
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-1">Your $/Sq Ft</p>
                  <p
                    className={`text-3xl font-bold ${analysis.isOverappraised ? "text-[#dc2626]" : "text-gray-900"}`}
                  >
                    {fmtPsf(analysis.subjectPPSF)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-1">
                    Median Comp $/Sq Ft
                  </p>
                  <p className="text-3xl font-bold text-[#1a56db]">
                    {fmtPsf(analysis.medianCompPPSF)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-1">Suggested Value</p>
                  <p className="text-3xl font-bold text-gray-900">
                    {fmt(analysis.suggestedValue)}
                  </p>
                </div>
              </div>

              {analysis.isOverappraised && analysis.potentialReduction > 0 && (
                <div className="bg-[#16a34a]/5 rounded-lg p-6 text-center">
                  <p className="text-sm text-gray-600 mb-1">
                    Potential Tax Savings
                  </p>
                  <p className="text-4xl font-extrabold text-[#16a34a]">
                    {fmt(analysis.estimatedTaxSavings)}
                    <span className="text-lg font-normal text-gray-500">
                      /year
                    </span>
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    Based on {fmt(analysis.potentialReduction)} reduction at 2.5%
                    effective tax rate
                  </p>
                </div>
              )}

              {!analysis.isOverappraised && (
                <div className="bg-[#16a34a]/5 rounded-lg p-6 text-center">
                  <p className="text-[#16a34a] font-semibold">
                    Your property appears fairly appraised compared to comparable
                    properties.
                  </p>
                </div>
              )}
            </div>

            {/* Comparables Table */}
            <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  Comparable Properties ({analysis.comparables.length})
                </h2>
                <a
                  href={`/api/property/${id}/protest-packet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-[#1a56db] text-white text-sm font-medium rounded-lg hover:bg-[#1544b8] transition-colors"
                >
                  Download Protest Packet
                </a>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 font-medium text-gray-500">
                        Address
                      </th>
                      <th className="text-right py-2 font-medium text-gray-500">
                        Sq Ft
                      </th>
                      <th className="text-right py-2 font-medium text-gray-500">
                        Year Built
                      </th>
                      <th className="text-right py-2 font-medium text-gray-500">
                        Total Appraised
                      </th>
                      <th className="text-right py-2 font-medium text-gray-500">
                        $/Sq Ft
                      </th>
                      <th className="text-right py-2 font-medium text-gray-500">
                        vs. Yours
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.comparables.map((comp) => {
                      const diff =
                        comp.assessed_per_sqft - analysis.subjectPPSF;
                      return (
                        <tr
                          key={comp.property_id}
                          className="border-b last:border-0 hover:bg-gray-50"
                        >
                          <td className="py-2">
                            <Link
                              href={`/property/${comp.property_id}`}
                              className="text-[#1a56db] hover:underline"
                            >
                              {comp.situs_address}
                            </Link>
                          </td>
                          <td className="text-right py-2">
                            {comp.improvement_sqft.toLocaleString()}
                          </td>
                          <td className="text-right py-2">
                            {comp.year_built ?? "--"}
                          </td>
                          <td className="text-right py-2">
                            {fmt(comp.total_appraised)}
                          </td>
                          <td className="text-right py-2 font-medium">
                            {fmtPsf(comp.assessed_per_sqft)}
                          </td>
                          <td
                            className={`text-right py-2 font-medium ${diff < 0 ? "text-[#16a34a]" : "text-[#dc2626]"}`}
                          >
                            {diff < 0 ? "" : "+"}
                            {fmtPsf(diff)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!analysis && (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <p className="text-gray-500">
              Not enough comparable properties found to perform analysis. This
              may happen if the property data is still being loaded.
            </p>
          </div>
        )}

        {/* Sale History */}
        {property.sales && property.sales.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-lg font-semibold mb-4">Sale History</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-gray-500">
                      Date
                    </th>
                    <th className="text-left py-2 font-medium text-gray-500">
                      Grantor
                    </th>
                    <th className="text-left py-2 font-medium text-gray-500">
                      Grantee
                    </th>
                    <th className="text-right py-2 font-medium text-gray-500">
                      Price
                    </th>
                    <th className="text-right py-2 font-medium text-gray-500">
                      Deed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {property.sales.map((sale, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2">
                        {sale.sale_date
                          ? new Date(sale.sale_date).toLocaleDateString()
                          : "--"}
                      </td>
                      <td className="py-2">{sale.grantor ?? "--"}</td>
                      <td className="py-2">{sale.grantee ?? "--"}</td>
                      <td className="text-right py-2">
                        {sale.sale_price ? fmt(Number(sale.sale_price)) : "--"}
                      </td>
                      <td className="text-right py-2 text-gray-500">
                        {sale.deed_vol && sale.deed_page
                          ? `Vol ${sale.deed_vol} / Pg ${sale.deed_page}`
                          : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
