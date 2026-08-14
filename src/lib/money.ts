/** Currency symbols for the currencies this trip is likely to touch. */
const SYMBOLS: Record<string, string> = {
  // NZ$ so home-currency totals are not mistaken for USD/AUD.
  NZD: 'NZ$',
  AUD: 'A$',
  USD: 'US$',
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
  SGD: 'S$',
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
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 1000) return `${sign}NZ$${(abs / 1000).toFixed(1)}k`;
  return `${sign}NZ$${Math.round(abs)}`;
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

/**
 * True when the digits before `index` could be the leading group of a
 * thousands-separated number.
 *
 * `1.234` is one thousand two hundred and thirty-four, but `0.005` is five
 * thousandths: no notation writes a leading thousands group as `0`, or as
 * nothing at all. Without this check the three-trailing-digits rule read
 * `0.005` as `0005` and returned 5 — a thousandfold overstatement, and only on
 * the amounts small enough that nobody would think to check.
 */
function looksLikeThousandsGroup(cleaned: string, index: number): boolean {
  const head = cleaned.slice(0, index).replace('-', '');
  return head.length > 0 && !head.startsWith('0');
}

/** Tolerant of European number formats: `12,50`, `1.234,56`, and `1,234.56`. */
export function parseAmount(input: string): number | null {
  let cleaned = input.replace(/[^0-9.,-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === ',') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator appears last is the decimal; the other is thousands.
    if (lastComma > lastDot) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (lastComma >= 0) {
    const commas = cleaned.split(',').length - 1;
    const after = cleaned.length - lastComma - 1;
    // Multiple commas, or a single comma with three trailing digits, are thousands.
    const thousands =
      commas > 1 || (after === 3 && looksLikeThousandsGroup(cleaned, lastComma));
    cleaned = thousands ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  } else if (lastDot >= 0) {
    const dots = cleaned.split('.').length - 1;
    const after = cleaned.length - lastDot - 1;
    // `1.234.567` or `1.234` (exactly three fraction digits) read as thousands.
    // `12.5` / `12.50` / `0.005` keep the decimal point.
    if (dots > 1 || (after === 3 && looksLikeThousandsGroup(cleaned, lastDot))) {
      cleaned = cleaned.replace(/\./g, '');
    }
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
