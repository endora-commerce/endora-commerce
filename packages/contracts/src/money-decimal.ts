/**
 * Exact decimal money arithmetic — issue #417, the sibling of
 * `price-book-decimal.ts` for the amounts that are *computed* from prices
 * rather than read from a price book: a line's net, its tax and its gross, an
 * order's and an invoice's totals, a correction's net backed out of a credited
 * gross, a percentage discount, a refund, an available credit.
 *
 * Every one of those used to be computed on doubles and rounded with
 * `Number#toFixed(2)` or `Math.round(x * 100) / 100`, which round the binary
 * value: 29.50 × 1.23 is the double 36.28499…, so an invoice line read 36.28
 * where the exact gross is 36.285 and half-up gives 36.29
 * (`specs/pricing/worked-examples.md` §10.16 and §10.17).
 *
 * Here every value is read as the decimal it is written as — a string
 * verbatim, a number as the shortest decimal that round-trips it
 * ({@link decimalText}) — and carried as an integer with a scale, so a sum or a
 * product is exact and the one rounding, half-up (half away from zero for a
 * negative amount), happens where the caller says. All results are decimal
 * strings: a two-place string read with `Number` is the nearest double to that
 * decimal, which `toFixed(2)`, `Intl.NumberFormat` and `String` all write back
 * as the same two places, so a caller that has to publish a number may.
 *
 * The minor unit is two places: every money column in the platform is
 * `numeric(…, 2)` and no currency with another minor unit is supported, so
 * `places` defaults to 2 rather than being looked up per currency.
 * No dependency (Constitution IV).
 */
import { decimalText } from './price-book-decimal.js';

/** `digits / 10^scale`, signed. */
interface Exact {
  readonly digits: bigint;
  readonly scale: number;
}

const SIGNED_DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;

function exact(value: string | number): Exact {
  const text = decimalText(value);
  const match = SIGNED_DECIMAL.exec(text);
  if (!match) throw new Error(`Not a decimal amount: "${String(value)}"`);
  const fraction = match[3] ?? '';
  const magnitude = BigInt(match[2]! + fraction);
  return { digits: match[1] === '-' ? -magnitude : magnitude, scale: fraction.length };
}

function rescale(value: Exact, scale: number): bigint {
  return value.digits * 10n ** BigInt(scale - value.scale);
}

function render(value: Exact): string {
  const negative = value.digits < 0n;
  const abs = (negative ? -value.digits : value.digits).toString().padStart(value.scale + 1, '0');
  const whole = abs.slice(0, abs.length - value.scale);
  const fraction = value.scale > 0 ? `.${abs.slice(abs.length - value.scale)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** `numerator / denominator` rounded half away from zero; the denominator is positive. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (2n * abs + denominator) / (2n * denominator);
  return negative ? -quotient : quotient;
}

function round(value: Exact, places: number): Exact {
  if (value.scale <= places) return { digits: rescale(value, places), scale: places };
  const digits = divideHalfUp(value.digits, 10n ** BigInt(value.scale - places));
  return { digits, scale: places };
}

function sum(values: ReadonlyArray<string | number>): Exact {
  const parsed = values.map(exact);
  const scale = parsed.reduce((max, v) => Math.max(max, v.scale), 0);
  return { digits: parsed.reduce((acc, v) => acc + rescale(v, scale), 0n), scale };
}

function product(a: Exact, b: Exact): Exact {
  return { digits: a.digits * b.digits, scale: a.scale + b.scale };
}

/** A rate as a fraction: `23` in percent is `0.23`. */
function rateFraction(rate: string | number, unit: 'fraction' | 'percent'): Exact {
  const parsed = exact(rate);
  if (parsed.digits < 0n) throw new Error(`Not a non-negative rate: "${String(rate)}"`);
  return unit === 'percent' ? { digits: parsed.digits, scale: parsed.scale + 2 } : parsed;
}

function checkPlaces(places: number): number {
  if (!Number.isInteger(places) || places < 0) throw new Error(`Not a number of places: ${places}`);
  return places;
}

/**
 * A decimal rounded to `places` (default two) **half-up on its decimal
 * digits**, half away from zero for a negative value, with exactly `places`
 * fractional digits; `-0.00` is written `0.00`. `roundHalfUp(x)` and
 * `roundAmountHalfUp(x)` agree on every input.
 */
export function roundHalfUp(value: string | number, places = 2): string {
  const rounded = round(exact(value), checkPlaces(places));
  return render(rounded.digits === 0n ? { digits: 0n, scale: rounded.scale } : rounded);
}

/** The exact sum of decimals, unrounded. */
export function decimalSum(...values: ReadonlyArray<string | number>): string {
  return render(sum(values));
}

/** The exact difference `a − b`, unrounded. */
export function decimalDifference(a: string | number, b: string | number): string {
  const x = exact(a);
  const y = exact(b);
  const scale = Math.max(x.scale, y.scale);
  return render({ digits: rescale(x, scale) - rescale(y, scale), scale });
}

/** The exact product `a × b`, unrounded. */
export function decimalProduct(a: string | number, b: string | number): string {
  return render(product(exact(a), exact(b)));
}

/** Numeric comparison of two signed decimals of any scale: −1, 0 or 1. */
export function compareDecimals(a: string | number, b: string | number): -1 | 0 | 1 {
  const x = exact(a);
  const y = exact(b);
  const scale = Math.max(x.scale, y.scale);
  const left = rescale(x, scale);
  const right = rescale(y, scale);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The sum of money amounts, rounded half-up to `places` once, at the end. */
export function moneySum(values: ReadonlyArray<string | number>, places = 2): string {
  return roundHalfUp(render(sum(values)), places);
}

/** `a − b` for money amounts, rounded half-up to `places`. */
export function moneyDifference(a: string | number, b: string | number, places = 2): string {
  return roundHalfUp(decimalDifference(a, b), places);
}

/** A line's amount: `unit price × quantity`, rounded half-up to `places`. */
export function lineAmountHalfUp(unitPrice: string | number, quantity: string | number, places = 2): string {
  return roundHalfUp(decimalProduct(unitPrice, quantity), places);
}

/**
 * The tax on a net amount: `net × rate`, rounded half-up on the exact product.
 * The rate is a fraction (`0.23`, as orders, invoices and the tax resolver
 * carry it) or a percentage (`23`) — said explicitly, because the two differ
 * by a factor of a hundred and `grossAmountHalfUp` defaults to percent.
 */
export function taxAmountHalfUp(
  net: string | number,
  rate: string | number,
  unit: 'fraction' | 'percent',
  places = 2,
): string {
  return render(round(product(exact(net), rateFraction(rate, unit)), checkPlaces(places)));
}

/**
 * The exact, unrounded tax on a net amount, for a total that rounds the sum of
 * its lines' taxes once (the order's rule) rather than each line's.
 */
export function taxAmountExact(net: string | number, rate: string | number, unit: 'fraction' | 'percent'): string {
  return render(product(exact(net), rateFraction(rate, unit)));
}

/**
 * The gross of a net amount: `net × (1 + rate)`, rounded half-up on the exact
 * product. The net may be negative (a discount line), which rounds half away
 * from zero. On a non-negative net this is `grossAmountHalfUp`.
 */
export function grossFromNetHalfUp(
  net: string | number,
  rate: string | number,
  unit: 'fraction' | 'percent',
  places = 2,
): string {
  const factor = rateFraction(rate, unit);
  const onePlusRate: Exact = { digits: 10n ** BigInt(factor.scale) + factor.digits, scale: factor.scale };
  return render(round(product(exact(net), onePlusRate), checkPlaces(places)));
}

/**
 * `dividend / divisor`, rounded half-up to `places` on the exact quotient —
 * a unit price backed out of a line amount and a quantity, for one. The
 * divisor is non-zero.
 */
export function quotientHalfUp(dividend: string | number, divisor: string | number, places = 2): string {
  const x = exact(dividend);
  const y = exact(divisor);
  if (y.digits === 0n) throw new Error('Division by zero');
  const p = checkPlaces(places);
  // x / y = (x.digits / 10^x.scale) / (y.digits / 10^y.scale); scaled to 10^p.
  let numerator = x.digits * 10n ** BigInt(y.scale + p);
  let denominator = y.digits * 10n ** BigInt(x.scale);
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  return render({ digits: divideHalfUp(numerator, denominator), scale: p });
}

/**
 * The net inside a gross amount: `gross / (1 + rate)`, rounded half-up on the
 * exact quotient — what a correction credits net when it is given a gross.
 */
export function netFromGrossHalfUp(
  gross: string | number,
  rate: string | number,
  unit: 'fraction' | 'percent',
  places = 2,
): string {
  const factor = rateFraction(rate, unit);
  const onePlusRate = render({ digits: 10n ** BigInt(factor.scale) + factor.digits, scale: factor.scale });
  return quotientHalfUp(gross, onePlusRate, places);
}

/** `amount × percent / 100`, rounded half-up on the exact product — a percentage discount. */
export function percentOfHalfUp(amount: string | number, percent: string | number, places = 2): string {
  const p = exact(percent);
  return render(round(product(exact(amount), { digits: p.digits, scale: p.scale + 2 }), checkPlaces(places)));
}

/**
 * How many whole `step`s fit in `amount` — `floor(amount / step)` on the exact
 * quotient, for a non-negative amount and a positive step ("for every 100.00
 * spent"). On doubles, `Math.floor(0.3 / 0.1)` is 2.
 */
export function wholeMultiples(amount: string | number, step: string | number): number {
  const x = exact(amount);
  const y = exact(step);
  if (x.digits < 0n) throw new Error(`Not a non-negative amount: "${String(amount)}"`);
  if (y.digits <= 0n) throw new Error(`Not a positive step: "${String(step)}"`);
  const scale = Math.max(x.scale, y.scale);
  return Number(rescale(x, scale) / rescale(y, scale));
}

/** A rate as a fraction with no trailing zeros — the key two notations of one rate share. */
function rateKey(rate: Exact): Exact {
  let { digits, scale } = rate;
  while (scale > 0 && digits % 10n === 0n) {
    digits /= 10n;
    scale -= 1;
  }
  return { digits, scale };
}

/**
 * `total` shared over `parts` at `places`: each part rounded half-up, and the
 * cents the rounding gained or lost handed back one at a time — to the parts
 * rounded furthest below their exact value when cents are missing, to those
 * rounded furthest above when there are too many, the earlier part first on a
 * tie. The result adds up to `total` exactly. Used where exact shares are owed:
 * a refund of a rate group split over the lines it came from.
 */
export function allocateHalfUp(
  total: string | number,
  parts: ReadonlyArray<string | number>,
  places = 2,
): string[] {
  const p = checkPlaces(places);
  const exacts = parts.map(exact);
  const scale = Math.max(p, ...exacts.map((e) => e.scale));
  const unit = 10n ** BigInt(scale - p);
  const rounded = exacts.map((e) => round(e, p).digits);
  // The remainder of each part, at the common scale: exact − rounded.
  const remainders = exacts.map((e, i) => rescale(e, scale) - rounded[i]! * unit);
  let missing = round(exact(total), p).digits - rounded.reduce((a, b) => a + b, 0n);
  const order = remainders.map((r, i) => ({ r, i }));
  if (missing > 0n) {
    order.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
    for (let k = 0; missing > 0n && order.length > 0; k = (k + 1) % order.length, missing -= 1n) {
      rounded[order[k]!.i]! += 1n;
    }
  } else if (missing < 0n) {
    order.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r < b.r ? -1 : 1));
    for (let k = 0; missing < 0n && order.length > 0; k = (k + 1) % order.length, missing += 1n) {
      rounded[order[k]!.i]! -= 1n;
    }
  }
  return rounded.map((digits) => render({ digits, scale: p }));
}

/** One rate's row of a VAT summary: the rate as a fraction, and two-place amounts. */
export interface VatRateRow {
  rate: string;
  net: string;
  vat: string;
  gross: string;
}

/** {@link vatByRate}'s answer. */
export interface VatByRate {
  /** One row per rate, ascending. */
  rows: VatRateRow[];
  /**
   * Per input line, in input order: its own gross, `round(net × (1 + rate))`, and that minus its
   * net — informational: the line grosses may differ from the total by a cent.
   */
  lines: Array<{ vat: string; gross: string }>;
  net: string;
  vat: string;
  gross: string;
}

/**
 * **The VAT method — one, everywhere** (owner ruling of 2026-10-24, issue
 * #417; art. 106e ust. 1 pkt 13–14 of the Polish VAT Act): per rate, the VAT
 * is the sum of the nets at that rate times the rate, rounded half-up **once**;
 * the rate's gross is its net plus its VAT; the totals are the sums of the
 * rows. Every document an order produces computes its VAT with this function —
 * the checkout preview, the order, the invoice, a correction, a refund — so
 * they cannot disagree.
 *
 * A line's gross (`lines`) is informational and is **the line's own rounding**,
 * `round(net × (1 + rate))` — what the shop shows (owner ruling of
 * 2026-10-24): 29.50 at 23 % shows 36.29 even beside 16.50 at the same rate,
 * whose rate VAT is 10.58. A document's line grosses may therefore add up to a
 * cent more or less than its total; the VAT and the totals are the rows'.
 * Nets are two-place amounts; a 0 % line (delivery, a discount) is a row of its
 * own with no VAT.
 */
export function vatByRate(
  lines: ReadonlyArray<{ net: string | number; rate: string | number }>,
  unit: 'fraction' | 'percent',
): VatByRate {
  const groups = new Map<string, { rate: Exact; indexes: number[] }>();
  lines.forEach((line, index) => {
    const rate = rateKey(rateFraction(line.rate, unit));
    const key = render(rate);
    const group = groups.get(key) ?? { rate, indexes: [] };
    group.indexes.push(index);
    groups.set(key, group);
  });
  const lineShares: Array<{ vat: string; gross: string }> = lines.map(() => ({ vat: '0.00', gross: '0.00' }));
  const rows = [...groups.entries()]
    .sort((a, b) => compareDecimals(a[0], b[0]))
    .map(([key, group]) => {
      const nets = group.indexes.map((i) => roundHalfUp(lines[i]!.net));
      const net = moneySum(nets);
      const vat = render(round(product(exact(net), group.rate), 2));
      const onePlusRate: Exact = { digits: 10n ** BigInt(group.rate.scale) + group.rate.digits, scale: group.rate.scale };
      group.indexes.forEach((lineIndex, k) => {
        // The line's own rounding — informational (owner ruling of 2026-10-24).
        const gross = render(round(product(exact(nets[k]!), onePlusRate), 2));
        lineShares[lineIndex] = { vat: moneyDifference(gross, nets[k]!), gross };
      });
      return { rate: key, net, vat, gross: moneySum([net, vat]) };
    });
  return {
    rows,
    lines: lineShares,
    net: moneySum(rows.map((r) => r.net)),
    vat: moneySum(rows.map((r) => r.vat)),
    gross: moneySum(rows.map((r) => r.gross)),
  };
}

/**
 * The net behind a gross at one rate, under {@link vatByRate}'s rule: the net
 * `N` with `N + round(N × rate) = gross`, so a gross that rule produced gives
 * back exactly the net it came from (`exact: true`). A gross the rule cannot
 * produce — at 23 %, no net gives 0.03 — answers the nearest net,
 * `round(gross ÷ (1 + rate))`, with the VAT as the remainder (`exact: false`).
 * What a correction credits net when it is handed a gross.
 */
export function netForGrossAtRate(
  gross: string | number,
  rate: string | number,
  unit: 'fraction' | 'percent',
): { net: string; vat: string; exact: boolean } {
  const target = roundHalfUp(gross);
  const nearest = netFromGrossHalfUp(target, rate, unit);
  const factor = rateFraction(rate, unit);
  const centsOf = (value: string) => exact(value).digits;
  for (const delta of [0n, -1n, 1n]) {
    const net = render({ digits: centsOf(nearest) + delta, scale: 2 });
    const vat = render(round(product(exact(net), factor), 2));
    if (compareDecimals(moneySum([net, vat]), target) === 0) return { net, vat, exact: true };
  }
  return { net: nearest, vat: moneyDifference(target, nearest), exact: false };
}
