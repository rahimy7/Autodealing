// The customer's quote page (/cotizacion/<token>, server/quote-page.js): its print button.
document.querySelector("[data-print]")?.addEventListener("click", () => window.print());
