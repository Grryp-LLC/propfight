"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { formatCityState } from "@/lib/address";

interface PropertyResult {
  property_id: string;
  situs_address: string;
  situs_city: string | null;
  situs_zip: string | null;
  owner_name: string | null;
  improvement_sqft: number | null;
  year_built: number | null;
}

function SearchResults() {
  const searchParams = useSearchParams();
  const address = searchParams.get("address") || "";
  const [results, setResults] = useState<PropertyResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    fetch(`/api/property/search?address=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((data) => {
        setResults(data.results || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [address]);

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
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Search Results
        </h1>
        <p className="text-gray-500 mb-6">
          Showing results for &ldquo;{address}&rdquo;
        </p>

        {loading ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center text-gray-500">
            Searching...
          </div>
        ) : results.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-8 text-center">
            <p className="text-gray-500 mb-4">
              No properties found matching your search.
            </p>
            <Link
              href="/"
              className="text-[#1a56db] hover:underline"
            >
              Try a different address
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left py-3 px-4 font-medium text-gray-500">
                    Address
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-gray-500">
                    Owner
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">
                    Sq Ft
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500">
                    Year Built
                  </th>
                  <th className="text-right py-3 px-4 font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((prop) => (
                  <tr
                    key={prop.property_id}
                    className="border-b last:border-0 hover:bg-gray-50"
                  >
                    <td className="py-3 px-4">
                      <div className="font-medium">{prop.situs_address}</div>
                      <div className="text-xs text-gray-400">
                        {formatCityState(prop.situs_city)}
                        {prop.situs_zip ? ` ${prop.situs_zip}` : ""}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {prop.owner_name ?? "--"}
                    </td>
                    <td className="text-right py-3 px-4">
                      {prop.improvement_sqft?.toLocaleString() ?? "--"}
                    </td>
                    <td className="text-right py-3 px-4">
                      {prop.year_built ?? "--"}
                    </td>
                    <td className="text-right py-3 px-4">
                      <Link
                        href={`/property/${prop.property_id}`}
                        className="text-[#1a56db] hover:underline font-medium"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          Loading...
        </div>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
