// The language catalogue the Dictionary module ships: every ISO 639-1
// language, with the countries that use it.
//
// What "every language" means here. The `languages` table holds BCP-47 tags and
// the platform has always shipped two regional ones, `en-US` and `pl-PL` (the
// init migration creates them). This file adds the **183 two-letter ISO 639-1
// codes currently in the standard** — the set an operator recognises as "all
// languages" and the primary subtag every regional tag is built from. The
// codes ISO has withdrawn (`bh`, `in`, `iw`, `ji`, `jw`, `mo`, `sh`) are left
// out. A regional tag an operator needs beyond these (`de-AT`, `pt-BR`) is
// still created through Admin UI -> Dictionary -> Languages, as before.
//
// AVAILABLE IS NOT ACTIVE. The reconciler hands these rows to `languages`'
// seed port, which inserts each one `is_active = false`. Nothing here can
// switch a language on: the active set is what a storefront offers its
// visitors and what the catalogue and the product feeds translate over, and it
// stays an operator's decision. That is also why a row carries no `isActive`.
//
// Sources — static, reviewed data; nothing is fetched or computed at runtime:
//
//   * `code`        ISO 639-1.
//   * `label`       the English display name in Unicode CLDR 48, with three
//                   exceptions where CLDR does not name the ISO 639-1 language
//                   itself: `tw` (CLDR folds it into `ak`, "Akan") is "Twi",
//                   `tl` (CLDR renders it as `fil`, "Filipino") is "Tagalog",
//                   and `bn` keeps the ISO name "Bengali" (CLDR: "Bangla").
//   * `nativeLabel` the language's CLDR 48 name in itself, first letter
//                   capitalised where its script has case; for the languages
//                   CLDR ships no locale for, the autonym in common use.
//   * `isRtl`       CLDR's character order for the language's default script.
//   * `countries`   ISO 3166-1 alpha-2 codes of the countries and territories
//                   where the language is official, de facto official, or
//                   official in a region of the country — the three statuses
//                   CLDR's territory information distinguishes — plus, for a
//                   regional language with no legal status anywhere, the
//                   country it is indigenous to. Constructed, liturgical and
//                   diaspora languages (`eo`, `ia`, `ie`, `io`, `vo`, `ae`,
//                   `cu`, `pi`, `yi`) have no country and say so with `[]`.
//                   Compiled by hand against that rule, and cross-checked one
//                   way by machine: for every country listed below, the
//                   language CLDR's likely-subtags data picks for it is among
//                   the languages mapped to it, wherever that language has an
//                   ISO 639-1 code at all.
//
// The list of country codes is deliberately the standard's, not the country
// dictionary's: `seed/countries.ts` ships a commerce subset, and the
// reconciler links a language only to a country row that exists. A country an
// operator adds later is linked on the next boot, with no edit here.
//
// Adding a row: keep the array sorted by `code` and each `countries` list
// sorted — `languages.test.ts`, beside this file, holds both.

import type { LanguageSeedRow } from '@endora-commerce/contracts';
import type { LanguageCountrySeedRow } from './language-countries.js';

export interface LanguageCatalogueRow {
  /** ISO 639-1 two-letter code. */
  code: string;
  /** English name. */
  label: string;
  /** The language's name in itself. */
  nativeLabel: string;
  isRtl?: boolean;
  /** ISO 3166-1 alpha-2 codes, sorted. Empty for a language no country uses. */
  countries: readonly string[];
}

export const LANGUAGE_CATALOGUE: readonly LanguageCatalogueRow[] = [
  { code: 'aa', label: 'Afar', nativeLabel: 'Afaraf', countries: ['DJ', 'ER', 'ET'] },
  { code: 'ab', label: 'Abkhazian', nativeLabel: 'Аԥсшәа', countries: ['GE'] },
  { code: 'ae', label: 'Avestan', nativeLabel: 'Avesta', isRtl: true, countries: [] },
  { code: 'af', label: 'Afrikaans', nativeLabel: 'Afrikaans', countries: ['NA', 'ZA'] },
  { code: 'ak', label: 'Akan', nativeLabel: 'Akan', countries: ['GH'] },
  { code: 'am', label: 'Amharic', nativeLabel: 'አማርኛ', countries: ['ET'] },
  { code: 'an', label: 'Aragonese', nativeLabel: 'Aragonés', countries: ['ES'] },
  {
    code: 'ar', label: 'Arabic', nativeLabel: 'العربية', isRtl: true,
    countries: [
      'AE', 'BH', 'DJ', 'DZ', 'EG', 'EH', 'ER', 'IL', 'IQ', 'JO', 'KM', 'KW', 'LB', 'LY',
      'MA', 'MR', 'OM', 'PS', 'QA', 'SA', 'SD', 'SO', 'SY', 'TD', 'TN', 'YE',
    ],
  },
  { code: 'as', label: 'Assamese', nativeLabel: 'অসমীয়া', countries: ['IN'] },
  { code: 'av', label: 'Avaric', nativeLabel: 'Авар мацӀ', countries: ['RU'] },
  { code: 'ay', label: 'Aymara', nativeLabel: 'Aymar aru', countries: ['BO', 'PE'] },
  { code: 'az', label: 'Azerbaijani', nativeLabel: 'Azərbaycan', countries: ['AZ'] },
  { code: 'ba', label: 'Bashkir', nativeLabel: 'Башҡорт', countries: ['RU'] },
  { code: 'be', label: 'Belarusian', nativeLabel: 'Беларуская', countries: ['BY'] },
  { code: 'bg', label: 'Bulgarian', nativeLabel: 'Български', countries: ['BG'] },
  { code: 'bi', label: 'Bislama', nativeLabel: 'Bislama', countries: ['VU'] },
  { code: 'bm', label: 'Bambara', nativeLabel: 'Bamanakan', countries: ['ML'] },
  { code: 'bn', label: 'Bengali', nativeLabel: 'বাংলা', countries: ['BD', 'IN'] },
  { code: 'bo', label: 'Tibetan', nativeLabel: 'བོད་སྐད་', countries: ['CN'] },
  { code: 'br', label: 'Breton', nativeLabel: 'Brezhoneg', countries: ['FR'] },
  { code: 'bs', label: 'Bosnian', nativeLabel: 'Bosanski', countries: ['BA', 'ME'] },
  { code: 'ca', label: 'Catalan', nativeLabel: 'Català', countries: ['AD', 'ES'] },
  { code: 'ce', label: 'Chechen', nativeLabel: 'Нохчийн', countries: ['RU'] },
  { code: 'ch', label: 'Chamorro', nativeLabel: 'Chamoru', countries: ['GU', 'MP'] },
  { code: 'co', label: 'Corsican', nativeLabel: 'Corsu', countries: ['FR'] },
  { code: 'cr', label: 'Cree', nativeLabel: 'ᓀᐦᐃᔭᐍᐏᐣ', countries: ['CA'] },
  { code: 'cs', label: 'Czech', nativeLabel: 'Čeština', countries: ['CZ'] },
  { code: 'cu', label: 'Church Slavic', nativeLabel: 'Словѣньскъ', countries: [] },
  { code: 'cv', label: 'Chuvash', nativeLabel: 'Чӑваш чӗлхи', countries: ['RU'] },
  { code: 'cy', label: 'Welsh', nativeLabel: 'Cymraeg', countries: ['GB'] },
  { code: 'da', label: 'Danish', nativeLabel: 'Dansk', countries: ['DK', 'FO', 'GL'] },
  {
    code: 'de', label: 'German', nativeLabel: 'Deutsch',
    countries: ['AT', 'BE', 'CH', 'DE', 'IT', 'LI', 'LU'],
  },
  { code: 'dv', label: 'Divehi', nativeLabel: 'ދިވެހި', isRtl: true, countries: ['MV'] },
  { code: 'dz', label: 'Dzongkha', nativeLabel: 'རྫོང་ཁ', countries: ['BT'] },
  { code: 'ee', label: 'Ewe', nativeLabel: 'Eʋegbe', countries: ['GH', 'TG'] },
  { code: 'el', label: 'Greek', nativeLabel: 'Ελληνικά', countries: ['CY', 'GR'] },
  {
    code: 'en', label: 'English', nativeLabel: 'English',
    countries: [
      'AG', 'AI', 'AS', 'AU', 'BB', 'BI', 'BM', 'BS', 'BW', 'BZ', 'CA', 'CC', 'CK', 'CM',
      'CX', 'DM', 'ER', 'FJ', 'FK', 'FM', 'GB', 'GD', 'GG', 'GH', 'GI', 'GM', 'GS', 'GU',
      'GY', 'HK', 'IE', 'IM', 'IN', 'IO', 'JE', 'JM', 'KE', 'KI', 'KN', 'KY', 'LC', 'LR',
      'LS', 'MH', 'MP', 'MS', 'MT', 'MU', 'MW', 'NA', 'NF', 'NG', 'NR', 'NU', 'NZ', 'PG',
      'PH', 'PK', 'PN', 'PR', 'PW', 'RW', 'SB', 'SC', 'SD', 'SG', 'SH', 'SL', 'SS', 'SX',
      'SZ', 'TC', 'TK', 'TO', 'TT', 'TV', 'TZ', 'UG', 'UM', 'US', 'VC', 'VG', 'VI', 'VU',
      'WS', 'ZA', 'ZM', 'ZW',
    ],
  },
  { code: 'eo', label: 'Esperanto', nativeLabel: 'Esperanto', countries: [] },
  {
    code: 'es', label: 'Spanish', nativeLabel: 'Español',
    countries: [
      'AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'ES', 'GQ', 'GT', 'HN', 'MX', 'NI',
      'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE',
    ],
  },
  { code: 'et', label: 'Estonian', nativeLabel: 'Eesti', countries: ['EE'] },
  { code: 'eu', label: 'Basque', nativeLabel: 'Euskara', countries: ['ES'] },
  { code: 'fa', label: 'Persian', nativeLabel: 'فارسی', isRtl: true, countries: ['AF', 'IR'] },
  {
    code: 'ff', label: 'Fula', nativeLabel: 'Pulaar',
    countries: ['BF', 'GN', 'ML', 'MR', 'NE', 'SN'],
  },
  { code: 'fi', label: 'Finnish', nativeLabel: 'Suomi', countries: ['FI'] },
  { code: 'fj', label: 'Fijian', nativeLabel: 'Vosa Vakaviti', countries: ['FJ'] },
  { code: 'fo', label: 'Faroese', nativeLabel: 'Føroyskt', countries: ['FO'] },
  {
    code: 'fr', label: 'French', nativeLabel: 'Français',
    countries: [
      'BE', 'BF', 'BI', 'BJ', 'BL', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CM', 'DJ', 'FR',
      'GA', 'GF', 'GN', 'GP', 'GQ', 'HT', 'IT', 'JE', 'KM', 'LU', 'MC', 'MF', 'MG', 'ML',
      'MQ', 'MU', 'NC', 'NE', 'PF', 'PM', 'RE', 'RW', 'SC', 'SN', 'TD', 'TF', 'TG', 'VU',
      'WF', 'YT',
    ],
  },
  { code: 'fy', label: 'Western Frisian', nativeLabel: 'Frysk', countries: ['NL'] },
  { code: 'ga', label: 'Irish', nativeLabel: 'Gaeilge', countries: ['GB', 'IE'] },
  { code: 'gd', label: 'Scottish Gaelic', nativeLabel: 'Gàidhlig', countries: ['GB'] },
  { code: 'gl', label: 'Galician', nativeLabel: 'Galego', countries: ['ES'] },
  { code: 'gn', label: 'Guarani', nativeLabel: 'Avañe’ẽ', countries: ['BO', 'PY'] },
  { code: 'gu', label: 'Gujarati', nativeLabel: 'ગુજરાતી', countries: ['IN'] },
  { code: 'gv', label: 'Manx', nativeLabel: 'Gaelg', countries: ['IM'] },
  { code: 'ha', label: 'Hausa', nativeLabel: 'Hausa', countries: ['NE', 'NG'] },
  { code: 'he', label: 'Hebrew', nativeLabel: 'עברית', isRtl: true, countries: ['IL'] },
  { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी', countries: ['FJ', 'IN'] },
  { code: 'ho', label: 'Hiri Motu', nativeLabel: 'Hiri Motu', countries: ['PG'] },
  { code: 'hr', label: 'Croatian', nativeLabel: 'Hrvatski', countries: ['BA', 'HR', 'ME'] },
  { code: 'ht', label: 'Haitian Creole', nativeLabel: 'Kreyòl ayisyen', countries: ['HT'] },
  { code: 'hu', label: 'Hungarian', nativeLabel: 'Magyar', countries: ['HU'] },
  { code: 'hy', label: 'Armenian', nativeLabel: 'Հայերեն', countries: ['AM'] },
  { code: 'hz', label: 'Herero', nativeLabel: 'Otjiherero', countries: ['NA'] },
  { code: 'ia', label: 'Interlingua', nativeLabel: 'Interlingua', countries: [] },
  { code: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia', countries: ['ID'] },
  { code: 'ie', label: 'Interlingue', nativeLabel: 'Interlingue', countries: [] },
  { code: 'ig', label: 'Igbo', nativeLabel: 'Igbo', countries: ['NG'] },
  { code: 'ii', label: 'Sichuan Yi', nativeLabel: 'ꆈꌠꉙ', countries: ['CN'] },
  { code: 'ik', label: 'Inupiaq', nativeLabel: 'Iñupiaq', countries: ['US'] },
  { code: 'io', label: 'Ido', nativeLabel: 'Ido', countries: [] },
  { code: 'is', label: 'Icelandic', nativeLabel: 'Íslenska', countries: ['IS'] },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano', countries: ['CH', 'IT', 'SM', 'VA'] },
  { code: 'iu', label: 'Inuktitut', nativeLabel: 'ᐃᓄᒃᑎᑐᑦ', countries: ['CA'] },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', countries: ['JP'] },
  { code: 'jv', label: 'Javanese', nativeLabel: 'Jawa', countries: ['ID'] },
  { code: 'ka', label: 'Georgian', nativeLabel: 'ქართული', countries: ['GE'] },
  { code: 'kg', label: 'Kongo', nativeLabel: 'Kikongo', countries: ['AO', 'CD', 'CG'] },
  { code: 'ki', label: 'Kikuyu', nativeLabel: 'Gikuyu', countries: ['KE'] },
  { code: 'kj', label: 'Kuanyama', nativeLabel: 'Oshikwanyama', countries: ['AO', 'NA'] },
  { code: 'kk', label: 'Kazakh', nativeLabel: 'Қазақ тілі', countries: ['KZ'] },
  { code: 'kl', label: 'Kalaallisut', nativeLabel: 'Kalaallisut', countries: ['GL'] },
  { code: 'km', label: 'Khmer', nativeLabel: 'ខ្មែរ', countries: ['KH'] },
  { code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ', countries: ['IN'] },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어', countries: ['KP', 'KR'] },
  { code: 'kr', label: 'Kanuri', nativeLabel: 'Kanuri', countries: ['NE', 'NG'] },
  { code: 'ks', label: 'Kashmiri', nativeLabel: 'کٲشُر', isRtl: true, countries: ['IN'] },
  { code: 'ku', label: 'Kurdish', nativeLabel: 'Kurdî', countries: ['IQ'] },
  { code: 'kv', label: 'Komi', nativeLabel: 'Коми кыв', countries: ['RU'] },
  { code: 'kw', label: 'Cornish', nativeLabel: 'Kernewek', countries: ['GB'] },
  { code: 'ky', label: 'Kyrgyz', nativeLabel: 'Кыргызча', countries: ['KG'] },
  { code: 'la', label: 'Latin', nativeLabel: 'Latina', countries: ['VA'] },
  { code: 'lb', label: 'Luxembourgish', nativeLabel: 'Lëtzebuergesch', countries: ['LU'] },
  { code: 'lg', label: 'Ganda', nativeLabel: 'Luganda', countries: ['UG'] },
  { code: 'li', label: 'Limburgish', nativeLabel: 'Limburgs', countries: ['NL'] },
  { code: 'ln', label: 'Lingala', nativeLabel: 'Lingála', countries: ['CD', 'CG'] },
  { code: 'lo', label: 'Lao', nativeLabel: 'ລາວ', countries: ['LA'] },
  { code: 'lt', label: 'Lithuanian', nativeLabel: 'Lietuvių', countries: ['LT'] },
  { code: 'lu', label: 'Luba-Katanga', nativeLabel: 'Kiluba', countries: ['CD'] },
  { code: 'lv', label: 'Latvian', nativeLabel: 'Latviešu', countries: ['LV'] },
  { code: 'mg', label: 'Malagasy', nativeLabel: 'Malagasy', countries: ['MG'] },
  { code: 'mh', label: 'Marshallese', nativeLabel: 'Kajin M̧ajeļ', countries: ['MH'] },
  { code: 'mi', label: 'Māori', nativeLabel: 'Māori', countries: ['NZ'] },
  { code: 'mk', label: 'Macedonian', nativeLabel: 'Македонски', countries: ['MK'] },
  { code: 'ml', label: 'Malayalam', nativeLabel: 'മലയാളം', countries: ['IN'] },
  { code: 'mn', label: 'Mongolian', nativeLabel: 'Монгол', countries: ['MN'] },
  { code: 'mr', label: 'Marathi', nativeLabel: 'मराठी', countries: ['IN'] },
  { code: 'ms', label: 'Malay', nativeLabel: 'Bahasa Melayu', countries: ['BN', 'MY', 'SG'] },
  { code: 'mt', label: 'Maltese', nativeLabel: 'Malti', countries: ['MT'] },
  { code: 'my', label: 'Burmese', nativeLabel: 'မြန်မာ', countries: ['MM'] },
  { code: 'na', label: 'Nauru', nativeLabel: 'Dorerin Naoero', countries: ['NR'] },
  { code: 'nb', label: 'Norwegian Bokmål', nativeLabel: 'Norsk bokmål', countries: ['NO', 'SJ'] },
  { code: 'nd', label: 'North Ndebele', nativeLabel: 'isiNdebele', countries: ['ZW'] },
  { code: 'ne', label: 'Nepali', nativeLabel: 'नेपाली', countries: ['NP'] },
  { code: 'ng', label: 'Ndonga', nativeLabel: 'Oshindonga', countries: ['NA'] },
  {
    code: 'nl', label: 'Dutch', nativeLabel: 'Nederlands',
    countries: ['AW', 'BE', 'BQ', 'CW', 'NL', 'SR', 'SX'],
  },
  { code: 'nn', label: 'Norwegian Nynorsk', nativeLabel: 'Norsk nynorsk', countries: ['NO'] },
  { code: 'no', label: 'Norwegian', nativeLabel: 'Norsk', countries: ['BV', 'NO', 'SJ'] },
  { code: 'nr', label: 'South Ndebele', nativeLabel: 'isiNdebele', countries: ['ZA'] },
  { code: 'nv', label: 'Navajo', nativeLabel: 'Diné bizaad', countries: ['US'] },
  { code: 'ny', label: 'Nyanja', nativeLabel: 'Chichewa', countries: ['MW', 'ZM', 'ZW'] },
  { code: 'oc', label: 'Occitan', nativeLabel: 'Occitan', countries: ['ES', 'FR'] },
  { code: 'oj', label: 'Ojibwa', nativeLabel: 'ᐊᓂᔑᓈᐯᒧᐎᓐ', countries: ['CA'] },
  { code: 'om', label: 'Oromo', nativeLabel: 'Oromoo', countries: ['ET'] },
  { code: 'or', label: 'Odia', nativeLabel: 'ଓଡ଼ିଆ', countries: ['IN'] },
  { code: 'os', label: 'Ossetic', nativeLabel: 'Ирон', countries: ['GE', 'RU'] },
  { code: 'pa', label: 'Punjabi', nativeLabel: 'ਪੰਜਾਬੀ', countries: ['IN', 'PK'] },
  { code: 'pi', label: 'Pali', nativeLabel: 'Pāli', countries: [] },
  { code: 'pl', label: 'Polish', nativeLabel: 'Polski', countries: ['PL'] },
  { code: 'ps', label: 'Pashto', nativeLabel: 'پښتو', isRtl: true, countries: ['AF'] },
  {
    code: 'pt', label: 'Portuguese', nativeLabel: 'Português',
    countries: ['AO', 'BR', 'CV', 'GQ', 'GW', 'MO', 'MZ', 'PT', 'ST', 'TL'],
  },
  { code: 'qu', label: 'Quechua', nativeLabel: 'Runasimi', countries: ['BO', 'EC', 'PE'] },
  { code: 'rm', label: 'Romansh', nativeLabel: 'Rumantsch', countries: ['CH'] },
  { code: 'rn', label: 'Rundi', nativeLabel: 'Ikirundi', countries: ['BI'] },
  { code: 'ro', label: 'Romanian', nativeLabel: 'Română', countries: ['MD', 'RO'] },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский', countries: ['BY', 'KG', 'KZ', 'RU'] },
  { code: 'rw', label: 'Kinyarwanda', nativeLabel: 'Ikinyarwanda', countries: ['RW'] },
  { code: 'sa', label: 'Sanskrit', nativeLabel: 'संस्कृत भाषा', countries: ['IN'] },
  { code: 'sc', label: 'Sardinian', nativeLabel: 'Sardu', countries: ['IT'] },
  { code: 'sd', label: 'Sindhi', nativeLabel: 'سنڌي', isRtl: true, countries: ['IN', 'PK'] },
  {
    code: 'se', label: 'Northern Sami', nativeLabel: 'Davvisámegiella',
    countries: ['FI', 'NO', 'SE'],
  },
  { code: 'sg', label: 'Sango', nativeLabel: 'Sängö', countries: ['CF'] },
  { code: 'si', label: 'Sinhala', nativeLabel: 'සිංහල', countries: ['LK'] },
  { code: 'sk', label: 'Slovak', nativeLabel: 'Slovenčina', countries: ['SK'] },
  { code: 'sl', label: 'Slovenian', nativeLabel: 'Slovenščina', countries: ['SI'] },
  { code: 'sm', label: 'Samoan', nativeLabel: 'Gagana Sāmoa', countries: ['AS', 'WS'] },
  { code: 'sn', label: 'Shona', nativeLabel: 'chiShona', countries: ['ZW'] },
  { code: 'so', label: 'Somali', nativeLabel: 'Soomaali', countries: ['DJ', 'ET', 'SO'] },
  { code: 'sq', label: 'Albanian', nativeLabel: 'Shqip', countries: ['AL', 'ME', 'MK', 'XK'] },
  { code: 'sr', label: 'Serbian', nativeLabel: 'Српски', countries: ['BA', 'ME', 'RS', 'XK'] },
  { code: 'ss', label: 'Swati', nativeLabel: 'siSwati', countries: ['SZ', 'ZA'] },
  { code: 'st', label: 'Southern Sotho', nativeLabel: 'Sesotho', countries: ['LS', 'ZA', 'ZW'] },
  { code: 'su', label: 'Sundanese', nativeLabel: 'Basa Sunda', countries: ['ID'] },
  { code: 'sv', label: 'Swedish', nativeLabel: 'Svenska', countries: ['AX', 'FI', 'SE'] },
  {
    code: 'sw', label: 'Swahili', nativeLabel: 'Kiswahili',
    countries: ['CD', 'KE', 'RW', 'TZ', 'UG'],
  },
  { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்', countries: ['IN', 'LK', 'SG'] },
  { code: 'te', label: 'Telugu', nativeLabel: 'తెలుగు', countries: ['IN'] },
  { code: 'tg', label: 'Tajik', nativeLabel: 'Тоҷикӣ', countries: ['TJ'] },
  { code: 'th', label: 'Thai', nativeLabel: 'ไทย', countries: ['TH'] },
  { code: 'ti', label: 'Tigrinya', nativeLabel: 'ትግርኛ', countries: ['ER', 'ET'] },
  { code: 'tk', label: 'Turkmen', nativeLabel: 'Türkmen dili', countries: ['TM'] },
  { code: 'tl', label: 'Tagalog', nativeLabel: 'Tagalog', countries: ['PH'] },
  { code: 'tn', label: 'Tswana', nativeLabel: 'Setswana', countries: ['BW', 'ZA', 'ZW'] },
  { code: 'to', label: 'Tongan', nativeLabel: 'Lea fakatonga', countries: ['TO'] },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe', countries: ['CY', 'TR'] },
  { code: 'ts', label: 'Tsonga', nativeLabel: 'Xitsonga', countries: ['ZA', 'ZW'] },
  { code: 'tt', label: 'Tatar', nativeLabel: 'Татар', countries: ['RU'] },
  { code: 'tw', label: 'Twi', nativeLabel: 'Twi', countries: ['GH'] },
  { code: 'ty', label: 'Tahitian', nativeLabel: 'Reo Tahiti', countries: ['PF'] },
  { code: 'ug', label: 'Uyghur', nativeLabel: 'ئۇيغۇرچە', isRtl: true, countries: ['CN'] },
  { code: 'uk', label: 'Ukrainian', nativeLabel: 'Українська', countries: ['UA'] },
  { code: 'ur', label: 'Urdu', nativeLabel: 'اردو', isRtl: true, countries: ['IN', 'PK'] },
  { code: 'uz', label: 'Uzbek', nativeLabel: 'O‘zbek', countries: ['UZ'] },
  { code: 've', label: 'Venda', nativeLabel: 'Tshivenḓa', countries: ['ZA', 'ZW'] },
  { code: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt', countries: ['VN'] },
  { code: 'vo', label: 'Volapük', nativeLabel: 'Volapük', countries: [] },
  { code: 'wa', label: 'Walloon', nativeLabel: 'Walon', countries: ['BE'] },
  { code: 'wo', label: 'Wolof', nativeLabel: 'Wolof', countries: ['SN'] },
  { code: 'xh', label: 'Xhosa', nativeLabel: 'isiXhosa', countries: ['ZA', 'ZW'] },
  { code: 'yi', label: 'Yiddish', nativeLabel: 'ייִדיש', isRtl: true, countries: [] },
  { code: 'yo', label: 'Yoruba', nativeLabel: 'Èdè Yorùbá', countries: ['NG'] },
  { code: 'za', label: 'Zhuang', nativeLabel: 'Vahcuengh', countries: ['CN'] },
  { code: 'zh', label: 'Chinese', nativeLabel: '中文', countries: ['CN', 'HK', 'MO', 'SG', 'TW'] },
  { code: 'zu', label: 'Zulu', nativeLabel: 'isiZulu', countries: ['ZA'] },
];

/**
 * Where the catalogue starts in the Languages list. The two shipped languages
 * sit at 0 and 1, and an operator's own additions default to the low hundreds,
 * so 1000 keeps the long tail below everything somebody chose — the same
 * convention `seed/countries.ts` uses for its inactive rows.
 */
export const LANGUAGE_CATALOGUE_SORT_BASE = 1000;

/**
 * The catalogue as `languages`' seed port takes it: ordered by English label,
 * ten apart so an operator can drop a row between two others without
 * renumbering. Countries are not part of a language row; they become links.
 */
export function languageCatalogueSeedRows(): Array<Required<LanguageSeedRow>> {
  return [...LANGUAGE_CATALOGUE]
    .sort((a, b) => a.label.localeCompare(b.label, 'en'))
    .map((row, index) => ({
      code: row.code,
      label: row.label,
      nativeLabel: row.nativeLabel,
      isRtl: row.isRtl ?? false,
      sortOrder: LANGUAGE_CATALOGUE_SORT_BASE + index * 10,
    }));
}

/**
 * One language↔country link per catalogue pair, **never primary**.
 *
 * `is_primary` answers "which language does a visitor from this country get",
 * at most one per country (a partial unique index holds it). That is a choice
 * between the languages a shop has switched on, so reference data does not
 * make it — and several countries already carry a shipped primary
 * (`language-countries.ts`) these links must sit beside, not contend with.
 */
export function languageCatalogueCountryLinks(): LanguageCountrySeedRow[] {
  return LANGUAGE_CATALOGUE.flatMap((row) =>
    row.countries.map((countryCode) => ({
      languageCode: row.code,
      countryCode,
      isPrimary: false,
    })),
  );
}
