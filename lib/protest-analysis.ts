export interface Property {
  property_id: string;
  situs_address: string;
  situs_city: string | null;
  subdivision: string | null;
  improvement_sqft: number;
  year_built: number | null;
  building_class: string | null;
  total_appraised: number;
  land_value: number;
  improvement_value: number;
}

export interface Comparable extends Property {
  assessed_per_sqft: number;
  sqft_diff_pct: number;
  year_diff: number;
}

export interface ProtestAnalysis {
  subject: Property;
  subjectPPSF: number;
  medianCompPPSF: number;
  meanCompPPSF: number;
  suggestedValue: number;
  potentialReduction: number;
  estimatedTaxSavings: number;
  isOverappraised: boolean;
  comparables: Comparable[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function findComparables(
  subject: Property,
  allProperties: Property[],
  options: {
    sqftTolerancePct?: number;
    yearTolerance?: number;
    maxComps?: number;
    sameSubdivisionOnly?: boolean;
  } = {}
): Comparable[] {
  const {
    sqftTolerancePct = 0.2,
    yearTolerance = 10,
    maxComps = 20,
    sameSubdivisionOnly = false,
  } = options;

  const minSqft = subject.improvement_sqft * (1 - sqftTolerancePct);
  const maxSqft = subject.improvement_sqft * (1 + sqftTolerancePct);
  const minYear = subject.year_built
    ? subject.year_built - yearTolerance
    : null;
  const maxYear = subject.year_built
    ? subject.year_built + yearTolerance
    : null;

  const comps: Comparable[] = [];

  for (const prop of allProperties) {
    if (prop.property_id === subject.property_id) continue;
    if (prop.improvement_sqft <= 0) continue;
    if (prop.total_appraised <= 0) continue;

    // Square footage filter
    if (prop.improvement_sqft < minSqft || prop.improvement_sqft > maxSqft)
      continue;

    // Year built filter
    if (minYear && maxYear && prop.year_built) {
      if (prop.year_built < minYear || prop.year_built > maxYear) continue;
    }

    // Subdivision filter
    if (sameSubdivisionOnly && subject.subdivision) {
      if (prop.subdivision !== subject.subdivision) continue;
    }

    const assessed_per_sqft = prop.total_appraised / prop.improvement_sqft;
    const sqft_diff_pct =
      ((prop.improvement_sqft - subject.improvement_sqft) /
        subject.improvement_sqft) *
      100;
    const year_diff =
      prop.year_built && subject.year_built
        ? prop.year_built - subject.year_built
        : 0;

    comps.push({
      ...prop,
      assessed_per_sqft,
      sqft_diff_pct,
      year_diff,
    });
  }

  // Sort by assessed value per sqft ascending (best comps = lowest $/sqft)
  comps.sort((a, b) => a.assessed_per_sqft - b.assessed_per_sqft);

  return comps.slice(0, maxComps);
}

export function calculateProtestValue(
  subject: Property,
  comps: Comparable[]
): ProtestAnalysis {
  const subjectPPSF =
    subject.improvement_sqft > 0
      ? subject.total_appraised / subject.improvement_sqft
      : 0;

  const compPPSFs = comps.map((c) => c.assessed_per_sqft);
  const medianCompPPSF = median(compPPSFs);
  const meanCompPPSF = mean(compPPSFs);

  const suggestedValue = medianCompPPSF * subject.improvement_sqft;
  const potentialReduction = Math.max(
    0,
    subject.total_appraised - suggestedValue
  );
  // Parker County effective tax rate ~2.5%
  const estimatedTaxSavings = potentialReduction * 0.025;
  const isOverappraised = subjectPPSF > medianCompPPSF;

  return {
    subject,
    subjectPPSF,
    medianCompPPSF,
    meanCompPPSF,
    suggestedValue,
    potentialReduction,
    estimatedTaxSavings,
    isOverappraised,
    comparables: comps,
  };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPerSqft(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
