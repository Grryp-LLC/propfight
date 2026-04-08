import Link from "next/link";

export const metadata = {
  title: "How Property Tax Protests Work - PropFight",
  description:
    "Learn how to protest your property tax appraisal in Texas and save money on your property taxes.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white">
      <nav className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-gray-900">
            Prop<span className="text-[#1a56db]">Fight</span>
          </Link>
          <Link
            href="/"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Search Properties
          </Link>
        </div>
      </nav>

      <article className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-4xl font-extrabold text-gray-900 mb-8">
          How Property Tax Protests Work in Texas
        </h1>

        <div className="prose prose-lg max-w-none text-gray-700 space-y-6">
          <p>
            Every year, your county appraisal district determines the market
            value of your property. This appraised value is what your property
            taxes are based on. If the appraisal is too high, you&apos;re paying
            more than your fair share.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
            Your Right to Protest
          </h2>
          <p>
            Texas Property Tax Code gives every property owner the right to
            protest their appraised value. You can file a protest with the
            Appraisal Review Board (ARB) by <strong>May 15th</strong> each year
            (or 30 days after the notice is mailed, whichever is later).
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
            The &quot;Unequal Appraisal&quot; Argument
          </h2>
          <p>
            The most powerful protest strategy is <strong>unequal appraisal</strong>
            (also called &quot;equity&quot;). This argument says: &quot;My property is
            assessed at a higher value per square foot than comparable properties
            in my area.&quot;
          </p>
          <p>
            This works because Texas law requires that properties be appraised
            equally and uniformly. If your neighbor&apos;s similar home is
            assessed at $120/sqft but yours is at $150/sqft, you have a strong
            case for reduction.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
            How PropFight Helps
          </h2>
          <ol className="list-decimal list-inside space-y-3">
            <li>
              <strong>Find your property</strong> -- We pull your current
              appraisal data from the Parker County Appraisal District (PCAD).
            </li>
            <li>
              <strong>Identify comparables</strong> -- We find 10-20 similar
              properties in your area (same subdivision, similar size and age).
            </li>
            <li>
              <strong>Calculate your $/sqft</strong> -- We compare your assessed
              value per square foot against the median of comparable properties.
            </li>
            <li>
              <strong>Generate your protest packet</strong> -- Download a
              ready-to-present analysis showing the unequal appraisal with
              specific comparable properties and data.
            </li>
          </ol>

          <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
            Filing Your Protest
          </h2>
          <p>For Parker County, you can file a protest:</p>
          <ul className="list-disc list-inside space-y-2">
            <li>
              <strong>Online:</strong> Through the PCAD website
            </li>
            <li>
              <strong>By mail:</strong> Send a completed Notice of Protest form
              to the Parker County Appraisal District
            </li>
            <li>
              <strong>In person:</strong> Visit the PCAD office in Weatherford,
              TX
            </li>
          </ul>
          <p>
            The deadline is typically <strong>May 15th</strong> or 30 days after
            the date your appraisal notice was mailed, whichever is later.
          </p>

          <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4">
            What to Expect at the Hearing
          </h2>
          <p>
            After filing, you&apos;ll be scheduled for an informal hearing with
            an appraiser. Bring your PropFight protest packet showing comparable
            properties and their assessed values. Most cases are resolved at this
            informal stage. If not, you can proceed to a formal ARB hearing.
          </p>

          <div className="mt-12 bg-[#1a56db]/5 rounded-xl p-8">
            <h3 className="text-xl font-bold text-[#1a56db] mb-3">
              Ready to check your property?
            </h3>
            <p className="text-gray-700 mb-4">
              Search your address to see if you&apos;re overappraised compared
              to your neighbors.
            </p>
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-[#1a56db] text-white font-semibold rounded-lg hover:bg-[#1544b8] transition-colors"
            >
              Search Your Property
            </Link>
          </div>
        </div>
      </article>

      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>
            &copy; {new Date().getFullYear()} PropFight. For informational
            purposes only -- not legal or tax advice.
          </p>
        </div>
      </footer>
    </main>
  );
}
