// La dirección del pedido es un texto libre ("Juan Pérez, 123 Main St Apt 4,
// Miami, FL 33101" del chat, o "123 Main St, Apt 4, Miami, Florida, 33101, United
// States" de Shopify) y USPS la pide separada en calle, ciudad, estado y ZIP.
// Esto es solo una PROPUESTA para llenar el formulario: la persona la corrige y
// USPS la valida antes de comprar nada.

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "puerto rico": "PR", guam: "GU", "virgin islands": "VI", "u.s. virgin islands": "VI", "american samoa": "AS", "northern mariana islands": "MP",
};
const STATE_CODES = new Set([...Object.values(STATES), "AA", "AE", "AP"]);

const COUNTRY = /^(usa|us|u\.s\.a?\.?|united states( of america)?|estados unidos( de am[eé]rica)?|eeuu|ee\.? ?uu\.?)$/i;
const ZIP = /\b(\d{5})(?:-(\d{4}))?\b/;
const SECONDARY = /\s*,?\s+((?:apt|apartment|suite|ste|unit|bldg|building|fl|floor|rm|room|#)\.?\s*#?\s*[\w-]+)\s*$/i;

export type ParsedUsAddress = {
  /** Lo que venía antes de la calle, si parece un nombre (para usarlo si el contacto no tiene). */
  name: string | null;
  streetAddress: string;
  secondaryAddress: string | null;
  city: string;
  state: string;
  ZIPCode: string;
  ZIPPlus4: string | null;
};

/** "FL", "fl", "Florida" → "FL"; otra cosa → null. */
export function stateCode(text: string | null | undefined): string | null {
  const t = text?.trim().replace(/\.$/, "");
  if (!t) return null;
  const upper = t.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  return STATES[t.toLowerCase()] ?? null;
}

/** "María del Carmen Pérez" → nombre "María", apellido "del Carmen Pérez". */
export function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Separa una dirección de EE. UU. en sus partes. Devuelve lo que alcanzó a leer:
 * los campos que no encontró quedan vacíos para que la persona los complete.
 */
export function parseUsAddress(raw: string | null | undefined): ParsedUsAddress {
  const empty: ParsedUsAddress = { name: null, streetAddress: "", secondaryAddress: null, city: "", state: "", ZIPCode: "", ZIPPlus4: null };
  const text = raw?.replace(/\r/g, "").replace(/\s*\n+\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (!text) return empty;

  let segments = text.split(",").map((s) => s.trim()).filter(Boolean);
  while (segments.length > 1 && COUNTRY.test(segments[segments.length - 1])) segments = segments.slice(0, -1);

  // El ZIP manda: de él se saca el estado (en su segmento o en el de antes) y la ciudad.
  let zipIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (ZIP.test(segments[i])) {
      zipIndex = i;
      break;
    }
  }
  // Sin comas ("123 Main St Miami FL 33101"): no hay dónde partir con certeza; se
  // rescata el estado y el ZIP del final y el resto va a la calle.
  if (zipIndex === 0 && segments.length === 1) {
    const m = segments[0].match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5})(?:-(\d{4}))?$/);
    if (m && stateCode(m[2])) return { ...empty, streetAddress: m[1], state: stateCode(m[2])!, ZIPCode: m[3], ZIPPlus4: m[4] ?? null };
  }
  if (zipIndex < 0) return { ...empty, streetAddress: segments[0] ?? "" };

  const zipSegment = segments[zipIndex];
  const zipMatch = zipSegment.match(ZIP)!;
  const beforeZip = zipSegment.slice(0, zipMatch.index).replace(/[\s,]+$/, "");
  let stateIndex = zipIndex;
  let state = stateCode(beforeZip);
  if (!state && beforeZip === "" && zipIndex > 0) {
    // "…, Florida, 33101": el estado va solo en el segmento anterior.
    state = stateCode(segments[zipIndex - 1]);
    if (state) stateIndex = zipIndex - 1;
  }
  if (!state) {
    // "Miami FL 33101": el estado son las últimas dos letras antes del ZIP.
    const m = beforeZip.match(/^(.*?)[\s,]+([A-Za-z]{2})$/);
    if (m && stateCode(m[2])) {
      // La ciudad viene en este mismo segmento, antes del estado.
      return finish(segments.slice(0, zipIndex), m[1].trim(), stateCode(m[2])!, zipMatch);
    }
  }

  const head = segments.slice(0, stateIndex);
  const city = head.pop() ?? "";
  return finish(head, city, state ?? "", zipMatch);
}

function finish(head: string[], city: string, state: string, zip: RegExpMatchArray): ParsedUsAddress {
  const out: ParsedUsAddress = { name: null, streetAddress: "", secondaryAddress: null, city, state, ZIPCode: zip[1], ZIPPlus4: zip[2] ?? null };
  // Antes de la calle puede venir el nombre de quien recibe: el primer segmento
  // sin ningún número cuando hay otro con número después.
  const firstWithDigit = head.findIndex((s) => /\d/.test(s));
  if (firstWithDigit > 0) {
    out.name = head.slice(0, firstWithDigit).join(" ").trim() || null;
    head = head.slice(firstWithDigit);
  }
  const street = head.shift() ?? "";
  const rest = head.join(", ").trim();
  const inline = street.match(SECONDARY);
  if (inline && inline.index != null && inline.index > 0 && !rest) {
    out.streetAddress = street.slice(0, inline.index).trim();
    out.secondaryAddress = inline[1].trim();
  } else {
    out.streetAddress = street;
    out.secondaryAddress = rest || null;
  }
  return out;
}
