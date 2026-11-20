// The page a customer opens from a quote's link (/cotizacion/<token>): the unit, the figures the
// salesperson gave and the dealer's contact, in the site's style. It prints as a clean sheet, so
// "Imprimir / Guardar PDF" is how a customer keeps it. Spanish by default, English with ?lang=en.
import { DEALER_TZ } from "./work-hours.js";

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const usd = (n) =>
  "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

const T = {
  es: {
    quote: "Cotización",
    for: "Preparada para",
    validUntil: "Válida hasta",
    expired: "Esta cotización venció. Escríbenos y te la actualizamos con gusto.",
    gone: "Esta unidad ya no está disponible. Escríbenos y te ayudamos a encontrar otra.",
    stock: "Stock",
    vin: "VIN",
    miles: "Millaje",
    condition: "Condición",
    color: "Color",
    conditions: { used: "Usado", new: "Nuevo", certified: "Certificado" },
    perMonth: "/mes",
    months: "meses",
    apr: "APR estimado",
    cash: "Pago de contado",
    price: "Precio del vehículo",
    fees: "Cargos de documentación y registro",
    tax: "Impuesto",
    total: "Total",
    trade: "Valor de tu intercambio",
    down: "Pago inicial",
    balance: "Saldo a pagar",
    financed: "Monto a financiar",
    payments: "Total de pagos",
    interest: "Intereses estimados",
    notIncluded: "Impuestos y cargos de registro no incluidos.",
    taxNotIncluded: "Impuestos no incluidos.",
    notes: "Notas",
    whatsapp: "Escribir por WhatsApp",
    call: "Llamar",
    see: "Ver la unidad",
    print: "Imprimir / Guardar PDF",
    seller: "Te atiende",
    fine: "Estimación informativa, sin valor contractual. La tasa, el plazo y la aprobación dependen de la evaluación de crédito de la entidad financiera. Precio sujeto a la disponibilidad de la unidad.",
    hello: (code, title) => `Hola, les escribo por la cotización ${code} (${title}).`,
    other: "English",
  },
  en: {
    quote: "Quote",
    for: "Prepared for",
    validUntil: "Valid until",
    expired: "This quote has expired. Message us and we'll gladly update it.",
    gone: "This unit is no longer available. Message us and we'll help you find another one.",
    stock: "Stock",
    vin: "VIN",
    miles: "Mileage",
    condition: "Condition",
    color: "Color",
    conditions: { used: "Used", new: "New", certified: "Certified" },
    perMonth: "/mo",
    months: "months",
    apr: "estimated APR",
    cash: "Cash price",
    price: "Vehicle price",
    fees: "Documentation and registration fees",
    tax: "Tax",
    total: "Total",
    trade: "Your trade-in value",
    down: "Down payment",
    balance: "Balance due",
    financed: "Amount financed",
    payments: "Total of payments",
    interest: "Estimated interest",
    notIncluded: "Taxes and registration fees not included.",
    taxNotIncluded: "Taxes not included.",
    notes: "Notes",
    whatsapp: "Message on WhatsApp",
    call: "Call",
    see: "See the vehicle",
    print: "Print / Save PDF",
    seller: "Your advisor",
    fine: "Informational estimate, not a contract. Rate, term and approval depend on the lender's credit review. Price subject to the unit's availability.",
    hello: (code, title) => `Hi, I'm writing about quote ${code} (${title}).`,
    other: "Español",
  },
};

const digits = (p) => String(p || "").replace(/\D/g, "");

export function renderQuotePage(q, dealer, { base, lang = "es", note = "", code, published }) {
  const t = T[lang] || T.es;
  const locale = lang === "en" ? "en-US" : "es-US";
  const f = q.figures || {};
  const v = q.vehicle || {};
  const title = [v.year, v.make, v.model].filter(Boolean).join(" ");
  const longDate = (instant) =>
    new Date(instant).toLocaleDateString(locale, { timeZone: DEALER_TZ, day: "numeric", month: "long", year: "numeric" });
  const created = longDate(q.created_at);
  const valid = new Date(q.valid_until_date + "T12:00:00Z").toLocaleDateString(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const photo = published && q.photo_id ? `/media/vehicles/${q.vehicle_id}/${q.photo_id}.webp` : "";
  const ogImage = published && q.photo_id ? `${base}/media/vehicles/${q.vehicle_id}/${q.photo_id}.jpg` : `${base}/img/premier-logo.png`;
  const dealerName = dealer.name || "Premier Line Motors";
  const wa = digits(dealer.phoneNumber || dealer.phone);
  const waLink = wa.length >= 8 ? `https://wa.me/${wa}?text=${encodeURIComponent(t.hello(code, title))}` : "";
  const tel = wa.length >= 7 ? `tel:+${wa}` : "";
  const financed = f.termMonths > 0;
  const line = (label, value, cls = "") => `<tr class="${cls}"><th scope="row">${esc(label)}</th><td>${esc(value)}</td></tr>`;
  const lines = [
    line(t.price, usd(f.price)),
    f.fees > 0 ? line(t.fees, usd(f.fees)) : "",
    f.taxRate > 0 ? line(`${t.tax} (${f.taxRate}%)`, usd(f.tax)) : "",
    line(t.total, usd(f.total), "sum"),
    f.tradeIn > 0 ? line(t.trade, "− " + usd(f.tradeIn), "minus") : "",
    f.down > 0 ? line(t.down, "− " + usd(f.down), "minus") : "",
    line(financed ? t.financed : t.balance, usd(f.balance), "sum"),
    financed ? line(t.payments, usd(f.totalOfPayments)) : "",
    financed ? line(t.interest, usd(f.interest)) : "",
  ].join("");
  const fact = (label, value) => (value ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : "");
  const miles = Number(v.miles) > 0 ? `${Math.round(Number(v.miles)).toLocaleString("en-US")} mi` : "";
  const notices = [
    !published ? `<p class="q-notice">${esc(t.gone)}</p>` : "",
    published && q.expired ? `<p class="q-notice">${esc(t.expired)}</p>` : "",
  ].join("");
  const omitted = f.taxRate > 0 ? "" : f.fees > 0 ? t.taxNotIncluded : t.notIncluded;
  const otherLang = lang === "en" ? "" : "?lang=en";
  const pageTitle = `${t.quote} ${code} · ${title}`;
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#05060a">
  <title>${esc(pageTitle)}</title>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(dealerName)}">
  <meta property="og:title" content="${esc(`${t.quote} · ${title} ${v.trim || ""}`.trim())}">
  <meta property="og:description" content="${esc(`${dealerName} · ${t.validUntil} ${valid}`)}">
  <meta property="og:image" content="${esc(ogImage)}">
  <link rel="icon" href="/api/site/logo">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Unbounded:wght@500;600;700&display=swap">
  <link rel="stylesheet" href="/css/quote.css">
  <script type="module" src="/js/quote-page.js"></script>
</head>
<body>
  <header class="q-top">
    <img class="q-logo" src="/api/site/logo" alt="${esc(dealerName)}">
    <div class="q-dealer">
      <strong>${esc(dealerName)}</strong>
      <span>${esc([dealer.address, dealer.city].filter(Boolean).join(", "))}</span>
      <span>${esc(dealer.phone || "")}${dealer.email ? " · " + esc(dealer.email) : ""}</span>
    </div>
    <a class="q-lang no-print" href="${otherLang ? otherLang : "?"}" hreflang="${lang === "en" ? "es" : "en"}">${esc(t.other)}</a>
  </header>
  <main class="q-sheet">
    <section class="q-hero">
      <p class="q-eyebrow">${esc(t.quote)} · ${esc(code)}</p>
      <h1>${esc(title)}${v.trim ? ` <span>${esc(v.trim)}</span>` : ""}</h1>
      <p class="q-meta">${esc(t.for)} <strong>${esc(q.customer_name)}</strong> · ${esc(created)} · ${esc(t.validUntil)} ${esc(valid)}</p>
      ${notices}
    </section>
    <section class="q-unit">
      ${photo ? `<figure class="q-photo"><img src="${esc(photo)}" alt="${esc(title)}"></figure>` : ""}
      <dl class="q-facts">
        ${fact(t.stock, v.stock)}${fact(t.miles, miles)}${fact(t.condition, t.conditions[v.condition])}${fact(t.color, v.ext)}${fact(t.vin, v.vin)}
      </dl>
    </section>
    <section class="q-figures">
      <div class="q-headline">
        ${
          financed
            ? `<p class="q-big"><span>${esc(usd0(f.monthly))}</span><small>${esc(t.perMonth)}</small></p><p class="q-sub">${f.termMonths} ${esc(t.months)} · ${esc(String(f.apr))}% ${esc(t.apr)}</p>`
            : `<p class="q-label">${esc(t.cash)}</p><p class="q-big"><span>${esc(usd0(f.balance))}</span></p>`
        }
      </div>
      <table class="q-lines"><tbody>${lines}</tbody></table>
      ${omitted ? `<p class="q-omitted">${esc(omitted)}</p>` : ""}
    </section>
    ${q.notes ? `<section class="q-notes"><h2>${esc(t.notes)}</h2><p>${esc(q.notes)}</p></section>` : ""}
    <section class="q-actions no-print">
      ${waLink ? `<a class="q-btn primary" href="${esc(waLink)}" target="_blank" rel="noopener">${esc(t.whatsapp)}</a>` : ""}
      ${tel ? `<a class="q-btn" href="${esc(tel)}">${esc(t.call)}</a>` : ""}
      ${published ? `<a class="q-btn" href="/?v=${esc(q.vehicle_id)}${lang === "en" ? "&lang=en" : ""}">${esc(t.see)}</a>` : ""}
      <button class="q-btn" type="button" data-print>${esc(t.print)}</button>
    </section>
    <footer class="q-foot">
      <p>${esc(t.seller)}: <strong>${esc(q.seller_name)}</strong> · ${esc(dealerName)}</p>
      <p class="q-fine">${esc(t.fine)}${note ? " " + esc(note) : ""}</p>
    </footer>
  </main>
</body>
</html>`;
}
