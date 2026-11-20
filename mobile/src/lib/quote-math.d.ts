// Types for quote-math.js, a copy of ../../js/quote-math.js (npm run sync:quote-math).
export const QUOTE_TERMS: number[];
export function monthlyPayment(principal: number, apr: number, months: number): number;
export interface QuoteFigures {
  price: number;
  fees: number;
  taxRate: number;
  tax: number;
  total: number;
  tradeIn: number;
  down: number;
  balance: number;
  apr: number;
  termMonths: number;
  financed: number;
  monthly: number;
  totalOfPayments: number;
  interest: number;
}
export function quoteFigures(input: {
  price: number;
  fees?: number;
  taxRate?: number;
  down?: number;
  tradeIn?: number;
  apr?: number;
  termMonths?: number;
}): QuoteFigures;
