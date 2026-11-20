// A shared vehicle link (/?v=<id>) carries the unit's photo, title and price in its Open Graph
// tags, so WhatsApp, Facebook and iMessage show them in the preview. The crawlers that read them
// never run the page's scripts.

const attr = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

export function priceLabel(data, lang = "es") {
  if (data.priceOnRequest || !(Number(data.price) > 0))
    return lang === "en" ? "Contact for price" : "Consultar precio";
  return "$" + Math.round(Number(data.price)).toLocaleString("en-US");
}

// vehicle: { id, data, photo } with photo the id of its first picture (or null).
export function vehiclePreview(vehicle, dealer = {}, { base, lang = "es" } = {}) {
  const d = vehicle.data || {};
  const en = lang === "en";
  const name = [d.year, d.make, d.model, d.trim].filter(Boolean).join(" ");
  const miles = Number(d.miles) > 0
    ? `${Math.round(Number(d.miles)).toLocaleString("en-US")} ${en ? "miles" : "millas"}`
    : "";
  const place = [dealer.name || "Premier Line Motors", dealer.city].filter(Boolean).join(", ");
  return {
    title: `${name} · ${priceLabel(d, lang)}`,
    description: [miles, d.drive, place].filter(Boolean).join(" · "),
    url: `${base}/?v=${vehicle.id}${en ? "&lang=en" : ""}`,
    image: vehicle.photo
      ? `${base}/media/vehicles/${vehicle.id}/${vehicle.photo}.jpg`
      : `${base}/img/premier-logo.png`,
    photo: Boolean(vehicle.photo),
    siteName: dealer.name || "Premier Line Motors",
    locale: en ? "en_US" : "es_US",
  };
}

export function injectPreview(html, p) {
  const tags = [
    ["og:type", "website"],
    ["og:site_name", p.siteName],
    ["og:locale", p.locale],
    ["og:title", p.title],
    ["og:description", p.description],
    ["og:url", p.url],
    ["og:image", p.image],
    ...(p.photo
      ? [
          ["og:image:type", "image/jpeg"],
          ["og:image:width", PREVIEW_WIDTH],
          ["og:image:height", PREVIEW_HEIGHT],
        ]
      : []),
    ["og:image:alt", p.title],
  ];
  const meta = [
    ...tags.map(([k, v]) => `<meta property="${k}" content="${attr(v)}">`),
    `<meta name="twitter:card" content="${p.photo ? "summary_large_image" : "summary"}">`,
    `<link rel="canonical" href="${attr(p.url)}">`,
  ].join("\n  ");
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${attr(p.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, (_, open) => open + attr(p.description))
    .replace("</head>", () => `  ${meta}\n</head>`);
}
