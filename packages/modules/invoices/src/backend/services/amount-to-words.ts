/**
 * Amount-in-words ("słownie") for invoice PDFs (feature 047, research R7).
 *
 * Renders a monetary amount as words for Polish (`pl`) and English (`en`),
 * with the fractional part shown in the `NN/100` form used on Polish invoices
 * (e.g. "sześć tysięcy sześćset czterdzieści osiem złotych 15/100"). A small
 * self-contained util — no runtime dependency (Constitution Principle IV).
 */

export type AmountToWordsLocale = 'pl' | 'en';

const PL_ONES = [
  'zero',
  'jeden',
  'dwa',
  'trzy',
  'cztery',
  'pięć',
  'sześć',
  'siedem',
  'osiem',
  'dziewięć',
  'dziesięć',
  'jedenaście',
  'dwanaście',
  'trzynaście',
  'czternaście',
  'piętnaście',
  'szesnaście',
  'siedemnaście',
  'osiemnaście',
  'dziewiętnaście',
];
const PL_TENS = [
  '',
  '',
  'dwadzieścia',
  'trzydzieści',
  'czterdzieści',
  'pięćdziesiąt',
  'sześćdziesiąt',
  'siedemdziesiąt',
  'osiemdziesiąt',
  'dziewięćdziesiąt',
];
const PL_HUNDREDS = [
  '',
  'sto',
  'dwieście',
  'trzysta',
  'czterysta',
  'pięćset',
  'sześćset',
  'siedemset',
  'osiemset',
  'dziewięćset',
];
// Polish scale words with the three plural forms [1, 2-4, 5+].
const PL_SCALES: Array<[string, string, string]> = [
  ['', '', ''],
  ['tysiąc', 'tysiące', 'tysięcy'],
  ['milion', 'miliony', 'milionów'],
  ['miliard', 'miliardy', 'miliardów'],
];

const EN_ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
const EN_SCALES = ['', 'thousand', 'million', 'billion'];

/** Polish plural index: 1 -> 0, 2-4 (not 12-14) -> 1, else -> 2. */
function plPluralIndex(n: number): 0 | 1 | 2 {
  if (n === 1) return 0;
  const lastTwo = n % 100;
  const last = n % 10;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 1;
  return 2;
}

/** Safe array lookup — the input ranges are bounded by construction. */
function word(arr: readonly string[], i: number): string {
  return arr[i] ?? '';
}

function plThreeDigits(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) parts.push(word(PL_HUNDREDS, h));
  if (t >= 2) {
    parts.push(word(PL_TENS, t));
    if (o) parts.push(word(PL_ONES, o));
  } else {
    const rest = t * 10 + o;
    if (rest) parts.push(word(PL_ONES, rest));
  }
  return parts.filter(Boolean).join(' ');
}

function plInteger(value: number): string {
  if (value === 0) return word(PL_ONES, 0);
  const groups: number[] = [];
  let n = value;
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] ?? 0;
    if (g === 0) continue;
    if (i === 0) {
      words.push(plThreeDigits(g));
    } else {
      // "jeden tysiąc" is conventionally just "tysiąc".
      if (g !== 1) words.push(plThreeDigits(g));
      const scale = PL_SCALES[i];
      if (scale) words.push(word(scale, plPluralIndex(g)));
    }
  }
  return words.filter(Boolean).join(' ');
}

function enThreeDigits(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) {
    parts.push(`${word(EN_ONES, h)} hundred`);
  }
  if (rest) {
    if (rest < 20) {
      parts.push(word(EN_ONES, rest));
    } else {
      const t = Math.floor(rest / 10);
      const o = rest % 10;
      parts.push(o ? `${word(EN_TENS, t)}-${word(EN_ONES, o)}` : word(EN_TENS, t));
    }
  }
  return parts.filter(Boolean).join(' ');
}

function enInteger(value: number): string {
  if (value === 0) return word(EN_ONES, 0);
  const groups: number[] = [];
  let n = value;
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] ?? 0;
    if (g === 0) continue;
    words.push(enThreeDigits(g));
    if (i > 0) words.push(word(EN_SCALES, i));
  }
  return words.filter(Boolean).join(' ');
}

const PL_CURRENCY: Record<string, [string, string, string]> = {
  PLN: ['złoty', 'złote', 'złotych'],
  EUR: ['euro', 'euro', 'euro'],
  USD: ['dolar', 'dolary', 'dolarów'],
};
const EN_CURRENCY: Record<string, [string, string]> = {
  PLN: ['zloty', 'zlotys'],
  EUR: ['euro', 'euro'],
  USD: ['dollar', 'dollars'],
};

/**
 * Convert a numeric amount to words. The integer part is spelled out; the
 * fractional (minor) part is shown as `NN/100`. The currency word follows the
 * integer part (Polish: with correct plural; English: singular/plural).
 *
 * @param amount  monetary amount (major units, may have 2 decimals)
 * @param currency ISO-4217 code (PLN/EUR/USD recognised; others fall back to the code)
 * @param locale  'pl' (default) or 'en'
 */
export function amountToWords(
  amount: number,
  currency: string,
  locale: AmountToWordsLocale = 'pl',
): string {
  const safe = Number.isFinite(amount) ? Math.abs(amount) : 0;
  const integer = Math.floor(safe + 1e-9);
  const minor = Math.round((safe - integer) * 100);
  const code = currency.toUpperCase();
  const fraction = `${minor.toString().padStart(2, '0')}/100`;
  const sign = amount < 0 ? (locale === 'pl' ? 'minus ' : 'minus ') : '';

  if (locale === 'pl') {
    const words = plInteger(integer);
    const cur = PL_CURRENCY[code]?.[plPluralIndex(integer)] ?? code;
    return `${sign}${words} ${cur} ${fraction}`.trim();
  }
  const words = enInteger(integer);
  const cur = EN_CURRENCY[code]?.[integer === 1 ? 0 : 1] ?? code;
  return `${sign}${words} ${cur} ${fraction}`.trim();
}
