// Static country seed for the Dictionary module (feature 017 / R6 / T007).
//
// Source: ISO 3166-1 alpha-2 (public domain). The catalogue intentionally
// covers the everyday-commerce subset the platform's first deployments
// need (full EU + major non-EU trading partners) plus the platform's
// historical bias (PL is `isDefault=true`). The long tail of ISO 3166-1
// can be added in follow-up PRs without code changes — the SeedReconciler
// is idempotent and operator edits are sticky (FR-019).
//
// Sort order convention:
//   - PL gets sortOrder=0 (the platform default).
//   - Other actively traded countries: 100..999 (alphabetical by English label).
//   - Long tail: 1000..  (inactive by default).

export interface CountrySeedRow {
  code: string;
  alpha3Code: string;
  numericCode: string;
  label: string;
  region: 'Africa' | 'Americas' | 'Asia' | 'Europe' | 'Oceania' | 'Antarctic';
  subregion?: string | null;
  dialCode?: string | null;
  isEuMember?: boolean;
  defaultCurrencyCode?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
}

/**
 * Seed catalogue. Add new rows freely — the reconciler inserts only those
 * whose `code` is missing in `countries`. Re-runs against an installed
 * platform never overwrite operator edits.
 */
export const COUNTRY_SEED: readonly CountrySeedRow[] = [
  // ── Platform default ──────────────────────────────────────────────
  {
    code: 'PL',
    alpha3Code: 'POL',
    numericCode: '616',
    label: 'Poland',
    region: 'Europe',
    subregion: 'Eastern Europe',
    dialCode: '+48',
    isEuMember: true,
    defaultCurrencyCode: 'PLN',
    isDefault: true,
    sortOrder: 0,
  },

  // ── EU 27 (excl. PL) ──────────────────────────────────────────────
  { code: 'AT', alpha3Code: 'AUT', numericCode: '040', label: 'Austria',         region: 'Europe',   subregion: 'Western Europe',   dialCode: '+43',  isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 110 },
  { code: 'BE', alpha3Code: 'BEL', numericCode: '056', label: 'Belgium',         region: 'Europe',   subregion: 'Western Europe',   dialCode: '+32',  isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 120 },
  { code: 'BG', alpha3Code: 'BGR', numericCode: '100', label: 'Bulgaria',        region: 'Europe',   subregion: 'Eastern Europe',   dialCode: '+359', isEuMember: true, defaultCurrencyCode: 'BGN', sortOrder: 130 },
  { code: 'HR', alpha3Code: 'HRV', numericCode: '191', label: 'Croatia',         region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+385', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 140 },
  { code: 'CY', alpha3Code: 'CYP', numericCode: '196', label: 'Cyprus',          region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+357', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 150 },
  { code: 'CZ', alpha3Code: 'CZE', numericCode: '203', label: 'Czechia',         region: 'Europe',   subregion: 'Eastern Europe',   dialCode: '+420', isEuMember: true, defaultCurrencyCode: 'CZK', sortOrder: 160 },
  { code: 'DK', alpha3Code: 'DNK', numericCode: '208', label: 'Denmark',         region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+45',  isEuMember: true, defaultCurrencyCode: 'DKK', sortOrder: 170 },
  { code: 'EE', alpha3Code: 'EST', numericCode: '233', label: 'Estonia',         region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+372', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 180 },
  { code: 'FI', alpha3Code: 'FIN', numericCode: '246', label: 'Finland',         region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+358', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 190 },
  { code: 'FR', alpha3Code: 'FRA', numericCode: '250', label: 'France',          region: 'Europe',   subregion: 'Western Europe',   dialCode: '+33',  isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 200 },
  { code: 'DE', alpha3Code: 'DEU', numericCode: '276', label: 'Germany',         region: 'Europe',   subregion: 'Western Europe',   dialCode: '+49',  isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 210 },
  { code: 'GR', alpha3Code: 'GRC', numericCode: '300', label: 'Greece',          region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+30',  isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 220 },
  { code: 'HU', alpha3Code: 'HUN', numericCode: '348', label: 'Hungary',         region: 'Europe',   subregion: 'Eastern Europe',   dialCode: '+36',  isEuMember: true, defaultCurrencyCode: 'HUF', sortOrder: 230 },
  { code: 'IE', alpha3Code: 'IRL', numericCode: '372', label: 'Ireland',         region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+353', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 240 },
  { code: 'IT', alpha3Code: 'ITA', numericCode: '380', label: 'Italy',           region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+39',  isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 250 },
  { code: 'LV', alpha3Code: 'LVA', numericCode: '428', label: 'Latvia',          region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+371', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 260 },
  { code: 'LT', alpha3Code: 'LTU', numericCode: '440', label: 'Lithuania',       region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+370', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 270 },
  { code: 'LU', alpha3Code: 'LUX', numericCode: '442', label: 'Luxembourg',      region: 'Europe',   subregion: 'Western Europe',   dialCode: '+352', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 280 },
  { code: 'MT', alpha3Code: 'MLT', numericCode: '470', label: 'Malta',           region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+356', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 290 },
  { code: 'NL', alpha3Code: 'NLD', numericCode: '528', label: 'Netherlands',     region: 'Europe',   subregion: 'Western Europe',   dialCode: '+31',  isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 300 },
  { code: 'PT', alpha3Code: 'PRT', numericCode: '620', label: 'Portugal',        region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+351', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 310 },
  { code: 'RO', alpha3Code: 'ROU', numericCode: '642', label: 'Romania',         region: 'Europe',   subregion: 'Eastern Europe',   dialCode: '+40',  isEuMember: true, defaultCurrencyCode: 'RON', sortOrder: 320 },
  { code: 'SK', alpha3Code: 'SVK', numericCode: '703', label: 'Slovakia',        region: 'Europe',   subregion: 'Eastern Europe',   dialCode: '+421', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 330 },
  { code: 'SI', alpha3Code: 'SVN', numericCode: '705', label: 'Slovenia',        region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+386', isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 340 },
  { code: 'ES', alpha3Code: 'ESP', numericCode: '724', label: 'Spain',           region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+34',  isEuMember: true, defaultCurrencyCode: 'EUR', sortOrder: 350 },
  { code: 'SE', alpha3Code: 'SWE', numericCode: '752', label: 'Sweden',          region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+46',  isEuMember: true, defaultCurrencyCode: 'SEK', sortOrder: 360 },

  // ── Major non-EU European partners ────────────────────────────────
  { code: 'CH', alpha3Code: 'CHE', numericCode: '756', label: 'Switzerland',     region: 'Europe',   subregion: 'Western Europe',   dialCode: '+41',  defaultCurrencyCode: 'CHF', sortOrder: 400 },
  { code: 'GB', alpha3Code: 'GBR', numericCode: '826', label: 'United Kingdom',  region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+44',  defaultCurrencyCode: 'GBP', sortOrder: 410 },
  { code: 'NO', alpha3Code: 'NOR', numericCode: '578', label: 'Norway',          region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+47',  defaultCurrencyCode: 'NOK', sortOrder: 420 },
  { code: 'IS', alpha3Code: 'ISL', numericCode: '352', label: 'Iceland',         region: 'Europe',   subregion: 'Northern Europe',  dialCode: '+354', defaultCurrencyCode: 'ISK', sortOrder: 430 },
  { code: 'UA', alpha3Code: 'UKR', numericCode: '804', label: 'Ukraine',         region: 'Europe',   subregion: 'Eastern Europe',   dialCode: '+380', defaultCurrencyCode: 'UAH', sortOrder: 440 },
  { code: 'RS', alpha3Code: 'SRB', numericCode: '688', label: 'Serbia',          region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+381', defaultCurrencyCode: 'RSD', sortOrder: 450 },
  { code: 'AL', alpha3Code: 'ALB', numericCode: '008', label: 'Albania',         region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+355', defaultCurrencyCode: 'ALL', sortOrder: 460 },
  { code: 'BA', alpha3Code: 'BIH', numericCode: '070', label: 'Bosnia and Herzegovina', region: 'Europe', subregion: 'Southern Europe', dialCode: '+387', defaultCurrencyCode: 'BAM', sortOrder: 470 },
  { code: 'MK', alpha3Code: 'MKD', numericCode: '807', label: 'North Macedonia', region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+389', defaultCurrencyCode: 'MKD', sortOrder: 480 },
  { code: 'ME', alpha3Code: 'MNE', numericCode: '499', label: 'Montenegro',      region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+382', defaultCurrencyCode: 'EUR', sortOrder: 490 },
  { code: 'TR', alpha3Code: 'TUR', numericCode: '792', label: 'Türkiye',         region: 'Asia',     subregion: 'Western Asia',     dialCode: '+90',  defaultCurrencyCode: 'TRY', sortOrder: 500 },
  { code: 'MD', alpha3Code: 'MDA', numericCode: '498', label: 'Moldova',         region: 'Europe',   subregion: 'Eastern Europe',   dialCode: '+373', defaultCurrencyCode: 'MDL', sortOrder: 510 },

  // ── Americas ──────────────────────────────────────────────────────
  { code: 'US', alpha3Code: 'USA', numericCode: '840', label: 'United States',   region: 'Americas', subregion: 'Northern America', dialCode: '+1',   defaultCurrencyCode: 'USD', sortOrder: 600 },
  { code: 'CA', alpha3Code: 'CAN', numericCode: '124', label: 'Canada',          region: 'Americas', subregion: 'Northern America', dialCode: '+1',   defaultCurrencyCode: 'CAD', sortOrder: 610 },
  { code: 'MX', alpha3Code: 'MEX', numericCode: '484', label: 'Mexico',          region: 'Americas', subregion: 'Central America',  dialCode: '+52',  defaultCurrencyCode: 'MXN', sortOrder: 620 },
  { code: 'BR', alpha3Code: 'BRA', numericCode: '076', label: 'Brazil',          region: 'Americas', subregion: 'South America',    dialCode: '+55',  defaultCurrencyCode: 'BRL', sortOrder: 630 },
  { code: 'AR', alpha3Code: 'ARG', numericCode: '032', label: 'Argentina',       region: 'Americas', subregion: 'South America',    dialCode: '+54',  defaultCurrencyCode: 'ARS', sortOrder: 640 },
  { code: 'CL', alpha3Code: 'CHL', numericCode: '152', label: 'Chile',           region: 'Americas', subregion: 'South America',    dialCode: '+56',  defaultCurrencyCode: 'CLP', sortOrder: 650 },
  { code: 'CO', alpha3Code: 'COL', numericCode: '170', label: 'Colombia',        region: 'Americas', subregion: 'South America',    dialCode: '+57',  defaultCurrencyCode: 'COP', sortOrder: 660 },
  { code: 'PE', alpha3Code: 'PER', numericCode: '604', label: 'Peru',            region: 'Americas', subregion: 'South America',    dialCode: '+51',  defaultCurrencyCode: 'PEN', sortOrder: 670 },

  // ── Asia ──────────────────────────────────────────────────────────
  { code: 'CN', alpha3Code: 'CHN', numericCode: '156', label: 'China',           region: 'Asia',     subregion: 'Eastern Asia',     dialCode: '+86',  defaultCurrencyCode: 'CNY', sortOrder: 700 },
  { code: 'JP', alpha3Code: 'JPN', numericCode: '392', label: 'Japan',           region: 'Asia',     subregion: 'Eastern Asia',     dialCode: '+81',  defaultCurrencyCode: 'JPY', sortOrder: 710 },
  { code: 'KR', alpha3Code: 'KOR', numericCode: '410', label: 'South Korea',     region: 'Asia',     subregion: 'Eastern Asia',     dialCode: '+82',  defaultCurrencyCode: 'KRW', sortOrder: 720 },
  { code: 'IN', alpha3Code: 'IND', numericCode: '356', label: 'India',           region: 'Asia',     subregion: 'Southern Asia',    dialCode: '+91',  defaultCurrencyCode: 'INR', sortOrder: 730 },
  { code: 'SG', alpha3Code: 'SGP', numericCode: '702', label: 'Singapore',       region: 'Asia',     subregion: 'South-eastern Asia', dialCode: '+65', defaultCurrencyCode: 'SGD', sortOrder: 740 },
  { code: 'HK', alpha3Code: 'HKG', numericCode: '344', label: 'Hong Kong',       region: 'Asia',     subregion: 'Eastern Asia',     dialCode: '+852', defaultCurrencyCode: 'HKD', sortOrder: 750 },
  { code: 'TW', alpha3Code: 'TWN', numericCode: '158', label: 'Taiwan',          region: 'Asia',     subregion: 'Eastern Asia',     dialCode: '+886', defaultCurrencyCode: 'TWD', sortOrder: 760 },
  { code: 'TH', alpha3Code: 'THA', numericCode: '764', label: 'Thailand',        region: 'Asia',     subregion: 'South-eastern Asia', dialCode: '+66', defaultCurrencyCode: 'THB', sortOrder: 770 },
  { code: 'VN', alpha3Code: 'VNM', numericCode: '704', label: 'Vietnam',         region: 'Asia',     subregion: 'South-eastern Asia', dialCode: '+84', defaultCurrencyCode: 'VND', sortOrder: 780 },
  { code: 'ID', alpha3Code: 'IDN', numericCode: '360', label: 'Indonesia',       region: 'Asia',     subregion: 'South-eastern Asia', dialCode: '+62', defaultCurrencyCode: 'IDR', sortOrder: 790 },
  { code: 'MY', alpha3Code: 'MYS', numericCode: '458', label: 'Malaysia',        region: 'Asia',     subregion: 'South-eastern Asia', dialCode: '+60', defaultCurrencyCode: 'MYR', sortOrder: 800 },
  { code: 'PH', alpha3Code: 'PHL', numericCode: '608', label: 'Philippines',     region: 'Asia',     subregion: 'South-eastern Asia', dialCode: '+63', defaultCurrencyCode: 'PHP', sortOrder: 810 },
  { code: 'IL', alpha3Code: 'ISR', numericCode: '376', label: 'Israel',          region: 'Asia',     subregion: 'Western Asia',     dialCode: '+972', defaultCurrencyCode: 'ILS', sortOrder: 820 },
  { code: 'AE', alpha3Code: 'ARE', numericCode: '784', label: 'United Arab Emirates', region: 'Asia', subregion: 'Western Asia',    dialCode: '+971', defaultCurrencyCode: 'AED', sortOrder: 830 },
  { code: 'SA', alpha3Code: 'SAU', numericCode: '682', label: 'Saudi Arabia',    region: 'Asia',     subregion: 'Western Asia',     dialCode: '+966', defaultCurrencyCode: 'SAR', sortOrder: 840 },
  { code: 'KZ', alpha3Code: 'KAZ', numericCode: '398', label: 'Kazakhstan',      region: 'Asia',     subregion: 'Central Asia',     dialCode: '+7',   defaultCurrencyCode: 'KZT', sortOrder: 850 },

  // ── Africa ────────────────────────────────────────────────────────
  { code: 'ZA', alpha3Code: 'ZAF', numericCode: '710', label: 'South Africa',    region: 'Africa',   subregion: 'Southern Africa',  dialCode: '+27',  defaultCurrencyCode: 'ZAR', sortOrder: 900 },
  { code: 'EG', alpha3Code: 'EGY', numericCode: '818', label: 'Egypt',           region: 'Africa',   subregion: 'Northern Africa',  dialCode: '+20',  defaultCurrencyCode: 'EGP', sortOrder: 910 },
  { code: 'MA', alpha3Code: 'MAR', numericCode: '504', label: 'Morocco',         region: 'Africa',   subregion: 'Northern Africa',  dialCode: '+212', defaultCurrencyCode: 'MAD', sortOrder: 920 },
  { code: 'NG', alpha3Code: 'NGA', numericCode: '566', label: 'Nigeria',         region: 'Africa',   subregion: 'Western Africa',   dialCode: '+234', defaultCurrencyCode: 'NGN', sortOrder: 930 },
  { code: 'KE', alpha3Code: 'KEN', numericCode: '404', label: 'Kenya',           region: 'Africa',   subregion: 'Eastern Africa',   dialCode: '+254', defaultCurrencyCode: 'KES', sortOrder: 940 },

  // ── Oceania ───────────────────────────────────────────────────────
  { code: 'AU', alpha3Code: 'AUS', numericCode: '036', label: 'Australia',       region: 'Oceania',  subregion: 'Australia and New Zealand', dialCode: '+61', defaultCurrencyCode: 'AUD', sortOrder: 950 },
  { code: 'NZ', alpha3Code: 'NZL', numericCode: '554', label: 'New Zealand',     region: 'Oceania',  subregion: 'Australia and New Zealand', dialCode: '+64', defaultCurrencyCode: 'NZD', sortOrder: 960 },

  // ── Long tail (inactive by default — operators activate as needed) ─
  { code: 'RU', alpha3Code: 'RUS', numericCode: '643', label: 'Russian Federation', region: 'Europe', subregion: 'Eastern Europe', dialCode: '+7',   defaultCurrencyCode: 'RUB', isActive: false, sortOrder: 1000 },
  { code: 'BY', alpha3Code: 'BLR', numericCode: '112', label: 'Belarus',         region: 'Europe',   subregion: 'Eastern Europe',   dialCode: '+375', defaultCurrencyCode: 'BYN', isActive: false, sortOrder: 1010 },
  { code: 'XK', alpha3Code: 'XKX', numericCode: '983', label: 'Kosovo',          region: 'Europe',   subregion: 'Southern Europe',  dialCode: '+383', defaultCurrencyCode: 'EUR', isActive: false, sortOrder: 1020 },
];

/**
 * Currency codes referenced by the country seed. Exposed so the
 * SeedReconciler can ensure these currencies exist in the `currencies`
 * table before the country FK is resolved (defensive — the late-FK
 * pattern in the migration also covers this).
 */
export const COUNTRY_SEED_CURRENCIES: ReadonlyArray<string> = Array.from(
  new Set(
    COUNTRY_SEED.map((c) => c.defaultCurrencyCode).filter(
      (v): v is string => typeof v === 'string',
    ),
  ),
).sort();
