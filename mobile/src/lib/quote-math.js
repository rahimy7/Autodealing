// The figures of a quote. One source for the server, which stores them when the quote is made,
// and for the mobile app, which shows them while the salesperson types. Pure: no DOM, no I/O.
//
// Taxes are charged on the price minus the trade-in, as most US states do. Fees (documentation,
// registration) are added untaxed. A term of 0 months is a cash quote.
export const QUOTE_TERMS = [0, 24, 36, 48, 60, 72, 84];

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function monthlyPayment(principal, apr, months) {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = apr / 100 / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}

export function quoteFigures({ price, fees = 0, taxRate = 0, down = 0, tradeIn = 0, apr = 0, termMonths = 0 }) {
  price = cents(price);
  fees = cents(fees);
  down = cents(down);
  tradeIn = cents(tradeIn);
  const tax = cents((Math.max(0, price - tradeIn) * (Number(taxRate) || 0)) / 100);
  const total = cents(price + fees + tax);
  // What is left after the trade-in and the down payment: paid in cash, or financed.
  const balance = cents(Math.max(0, total - tradeIn - down));
  const term = Number(termMonths) || 0;
  const financed = term ? balance : 0;
  const monthly = term ? cents(monthlyPayment(financed, Number(apr) || 0, term)) : 0;
  const totalOfPayments = cents(monthly * term);
  return {
    price,
    fees,
    taxRate: Number(taxRate) || 0,
    tax,
    total,
    tradeIn,
    down,
    balance,
    apr: term ? Number(apr) || 0 : 0,
    termMonths: term,
    financed,
    monthly,
    totalOfPayments,
    interest: cents(Math.max(0, totalOfPayments - financed)),
  };
}
