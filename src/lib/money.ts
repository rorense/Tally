/** Currency symbols for the currencies this trip is likely to touch. */
const SYMBOLS: Record<string, string> = {
  NZD: '$',
  AUD: '$',
  USD: '$',
  EUR: '\u20AC',
  GBP: '\u00A3',
  CHF: 'CHF ',
  CZK: 'K\u010D',
  PLN: 'z\u0142',
  HUF: 'Ft',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  ISK: 'kr',
  BGN: '\u043B\u0432',
  RON: 'lei',
  TRY: '\u20BA',
  ALL: 'L',
  RSD: 'din',
  SGD: '$',
  AED: 'AED ',
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? `${code} `;
}

export function formatMoney(amount: number, currency: string): string {
  const symbol = currencySymbol(currency);
  const n = Math.abs(amount).toLocaleString('en-NZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? '-' : ''}${symbol}${n}`;
}

export function formatNzd(amount: number): string {
  return formatMoney(amount, 'NZD');
}

/** Compact form for chart axes and tiles, where two decimals are just noise. */
export function formatNzdCompact(amount: number): string {
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
  return `$${Math.round(amount)}`;
}

/**
 * Converts a foreign amount to NZD.
 *
 * `rateToNzd` is how many NZD one unit of the foreign currency buys. The card
 * markup is added on top because ECB mid-market rates are not what a bank
 * actually charges; Visa and Mastercard typically add 1-3%.
 */
export function convertToNzd(amount: number, rateToNzd: number, cardMarkupPct = 0): number {
  const converted = amount * rateToNzd;
  return round2(converted * (1 + cardMarkupPct / 100));
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Tolerant of the comma decimal separator used across most of Europe. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,-]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
