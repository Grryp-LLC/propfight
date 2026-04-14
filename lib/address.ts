const STREET_TYPE_MAP: Record<string, string> = {
  ALY: "Aly",
  AVE: "Ave",
  BLVD: "Blvd",
  CIR: "Cir",
  CT: "Ct",
  CV: "Cv",
  DR: "Dr",
  HWY: "Hwy",
  LN: "Ln",
  PKWY: "Pkwy",
  PL: "Pl",
  RD: "Rd",
  SQ: "Sq",
  ST: "St",
  TER: "Ter",
  TRL: "Trl",
  WAY: "Way",
};

const DIRECTIONAL_MAP: Record<string, string> = {
  N: "N",
  S: "S",
  E: "E",
  W: "W",
  NE: "NE",
  NW: "NW",
  SE: "SE",
  SW: "SW",
};

function toTitleWord(word: string) {
  if (!word) return word;
  const upper = word.toUpperCase();
  if (DIRECTIONAL_MAP[upper]) return DIRECTIONAL_MAP[upper];
  if (STREET_TYPE_MAP[upper]) return STREET_TYPE_MAP[upper];
  return upper.charAt(0) + upper.slice(1).toLowerCase();
}

export function formatStreetAddress(raw: string | null | undefined) {
  if (!raw) return "";

  const cleaned = raw.replace(/^Situs:\s*/i, "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const tokens = cleaned.split(" ");
  const trailingNumber = tokens.at(-1);

  if (trailingNumber && /^\d+[A-Z]?$/.test(trailingNumber)) {
    const streetParts = tokens.slice(0, -1).map(toTitleWord);
    return `${trailingNumber} ${streetParts.join(" ")}`.trim();
  }

  return tokens.map(toTitleWord).join(" ");
}

export function formatCityState(city: string | null | undefined, state = "Texas") {
  if (!city) return state;
  return `${city
    .split(/\s+/)
    .filter(Boolean)
    .map(toTitleWord)
    .join(" ")}, ${state}`;
}
