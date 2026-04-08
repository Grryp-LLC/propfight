"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/property/search?address=${encodeURIComponent(address.trim())}`
      );
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        if (data.results.length === 1) {
          router.push(`/property/${data.results[0].property_id}`);
        } else {
          router.push(`/search?address=${encodeURIComponent(address.trim())}`);
        }
      } else {
        setError(
          "No properties found. Try a different address or check your spelling."
        );
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <span className="text-xl font-bold text-gray-900">
            Prop<span className="text-[#1a56db]">Fight</span>
          </span>
          <a
            href="/about"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            How It Works
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-20 pb-16 text-center">
        <h1 className="text-5xl md:text-6xl font-extrabold text-gray-900 tracking-tight">
          Is Your Property{" "}
          <span className="text-[#dc2626]">Overappraised</span>?
        </h1>
        <p className="mt-6 text-xl text-gray-600 max-w-2xl mx-auto">
          Texas homeowners can save hundreds — even thousands — per year by
          protesting their property tax appraisal. Find out if you&apos;re
          paying too much.
        </p>

        <form
          onSubmit={handleSearch}
          className="mt-10 max-w-xl mx-auto flex gap-3"
        >
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Enter your address (e.g. 123 Main St)"
            className="flex-1 px-5 py-4 rounded-lg border border-gray-300 text-lg focus:outline-none focus:ring-2 focus:ring-[#1a56db] focus:border-transparent"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-8 py-4 bg-[#1a56db] text-white font-semibold rounded-lg hover:bg-[#1544b8] transition-colors disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </form>
        {error && <p className="mt-4 text-[#dc2626] text-sm">{error}</p>}
      </section>

      {/* How It Works */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">
            How PropFight Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-white rounded-xl p-8 shadow-sm">
              <div className="w-12 h-12 bg-[#1a56db]/10 rounded-lg flex items-center justify-center mb-4">
                <span className="text-[#1a56db] text-2xl font-bold">1</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Search Your Property
              </h3>
              <p className="text-gray-600">
                Enter your address and we&apos;ll pull your current appraisal
                data from the Parker County Appraisal District.
              </p>
            </div>
            <div className="bg-white rounded-xl p-8 shadow-sm">
              <div className="w-12 h-12 bg-[#1a56db]/10 rounded-lg flex items-center justify-center mb-4">
                <span className="text-[#1a56db] text-2xl font-bold">2</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">
                Compare to Neighbors
              </h3>
              <p className="text-gray-600">
                We analyze comparable properties to see if your assessed value
                per square foot is higher than similar homes.
              </p>
            </div>
            <div className="bg-white rounded-xl p-8 shadow-sm">
              <div className="w-12 h-12 bg-[#16a34a]/10 rounded-lg flex items-center justify-center mb-4">
                <span className="text-[#16a34a] text-2xl font-bold">3</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">
                File Your Protest
              </h3>
              <p className="text-gray-600">
                Download a ready-to-file protest packet with equity analysis to
                present to the Appraisal Review Board.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="py-16">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <p className="text-4xl font-bold text-[#16a34a]">$600+</p>
              <p className="text-gray-600 mt-2">
                Average annual savings from a successful protest
              </p>
            </div>
            <div>
              <p className="text-4xl font-bold text-[#1a56db]">70%</p>
              <p className="text-gray-600 mt-2">
                Of Texas protests result in a reduction
              </p>
            </div>
            <div>
              <p className="text-4xl font-bold text-gray-900">Free</p>
              <p className="text-gray-600 mt-2">
                To file a protest — no lawyer needed
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>
            PropFight is not affiliated with Parker County Appraisal District.
            Data sourced from public records.
          </p>
          <p className="mt-2">
            &copy; {new Date().getFullYear()} PropFight. For informational
            purposes only — not legal or tax advice.
          </p>
        </div>
      </footer>
    </main>
  );
}
