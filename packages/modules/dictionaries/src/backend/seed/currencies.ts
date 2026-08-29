// Currency seed metadata for the Dictionary module (feature 017 / R6).
//
// The legacy migration 012 created the `currencies` table with `PLN` and
// `EUR` already present. This catalogue covers every currency referenced
// by the country seed (`countries.ts`) so the SeedReconciler can ensure
// the FK `countries.default_currency_code → currencies(code)` is
// satisfiable on a fresh install. Existing operator-edited rows are
// preserved (R6 idempotency rule).
//
// `decimalPlaces` follows ISO 4217 minor-unit convention; `symbolPosition`
// reflects common rendering practice. Operators may edit either via
// Admin UI → Dictionary → Currencies.

export interface CurrencySeedRow {
  code: string;
  label: string;
  symbol: string;
  symbolPosition?: 'prefix' | 'suffix';
  decimalPlaces?: number;
}

export const CURRENCY_SEED: readonly CurrencySeedRow[] = [
  // Already created by migration 012; the reconciler updates the new
  // columns (symbol_position, decimal_places) only when they hold the
  // default value left by the migration.
  { code: 'PLN', label: 'Polish złoty',          symbol: 'zł',  symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'EUR', label: 'Euro',                  symbol: '€',   symbolPosition: 'suffix', decimalPlaces: 2 },

  // Major non-EUR Western currencies.
  { code: 'USD', label: 'US dollar',             symbol: '$',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'GBP', label: 'Pound sterling',        symbol: '£',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'CHF', label: 'Swiss franc',           symbol: 'CHF', symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'CAD', label: 'Canadian dollar',       symbol: 'CA$', symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'AUD', label: 'Australian dollar',     symbol: 'A$',  symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'NZD', label: 'New Zealand dollar',    symbol: 'NZ$', symbolPosition: 'prefix', decimalPlaces: 2 },

  // EU non-EUR.
  { code: 'BGN', label: 'Bulgarian lev',         symbol: 'лв',  symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'CZK', label: 'Czech koruna',          symbol: 'Kč',  symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'DKK', label: 'Danish krone',          symbol: 'kr',  symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'HUF', label: 'Hungarian forint',      symbol: 'Ft',  symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'NOK', label: 'Norwegian krone',       symbol: 'kr',  symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'RON', label: 'Romanian leu',          symbol: 'lei', symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'SEK', label: 'Swedish krona',         symbol: 'kr',  symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'ISK', label: 'Icelandic króna',       symbol: 'kr',  symbolPosition: 'suffix', decimalPlaces: 0 },

  // Other Europe.
  { code: 'UAH', label: 'Ukrainian hryvnia',     symbol: '₴',   symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'RSD', label: 'Serbian dinar',         symbol: 'дин', symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'ALL', label: 'Albanian lek',          symbol: 'L',   symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'BAM', label: 'Convertible mark',      symbol: 'KM',  symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'MKD', label: 'Macedonian denar',      symbol: 'ден', symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'TRY', label: 'Turkish lira',          symbol: '₺',   symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'MDL', label: 'Moldovan leu',          symbol: 'L',   symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'RUB', label: 'Russian ruble',         symbol: '₽',   symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'BYN', label: 'Belarusian ruble',      symbol: 'Br',  symbolPosition: 'suffix', decimalPlaces: 2 },

  // Americas.
  { code: 'MXN', label: 'Mexican peso',          symbol: 'Mex$',symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'BRL', label: 'Brazilian real',        symbol: 'R$',  symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'ARS', label: 'Argentine peso',        symbol: '$',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'CLP', label: 'Chilean peso',          symbol: '$',   symbolPosition: 'prefix', decimalPlaces: 0 },
  { code: 'COP', label: 'Colombian peso',        symbol: '$',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'PEN', label: 'Peruvian sol',          symbol: 'S/',  symbolPosition: 'prefix', decimalPlaces: 2 },

  // Asia.
  { code: 'CNY', label: 'Renminbi',              symbol: '¥',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'JPY', label: 'Japanese yen',          symbol: '¥',   symbolPosition: 'prefix', decimalPlaces: 0 },
  { code: 'KRW', label: 'South Korean won',      symbol: '₩',   symbolPosition: 'prefix', decimalPlaces: 0 },
  { code: 'INR', label: 'Indian rupee',          symbol: '₹',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'SGD', label: 'Singapore dollar',      symbol: 'S$',  symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'HKD', label: 'Hong Kong dollar',      symbol: 'HK$', symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'TWD', label: 'New Taiwan dollar',     symbol: 'NT$', symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'THB', label: 'Thai baht',             symbol: '฿',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'VND', label: 'Vietnamese đồng',       symbol: '₫',   symbolPosition: 'suffix', decimalPlaces: 0 },
  { code: 'IDR', label: 'Indonesian rupiah',     symbol: 'Rp',  symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'MYR', label: 'Malaysian ringgit',     symbol: 'RM',  symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'PHP', label: 'Philippine peso',       symbol: '₱',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'ILS', label: 'Israeli new shekel',    symbol: '₪',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'AED', label: 'UAE dirham',            symbol: 'AED', symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'SAR', label: 'Saudi riyal',           symbol: 'SAR', symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'KZT', label: 'Kazakhstani tenge',     symbol: '₸',   symbolPosition: 'suffix', decimalPlaces: 2 },

  // Africa.
  { code: 'ZAR', label: 'South African rand',    symbol: 'R',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'EGP', label: 'Egyptian pound',        symbol: 'E£',  symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'MAD', label: 'Moroccan dirham',       symbol: 'DH',  symbolPosition: 'suffix', decimalPlaces: 2 },
  { code: 'NGN', label: 'Nigerian naira',        symbol: '₦',   symbolPosition: 'prefix', decimalPlaces: 2 },
  { code: 'KES', label: 'Kenyan shilling',       symbol: 'KSh', symbolPosition: 'prefix', decimalPlaces: 2 },
];
