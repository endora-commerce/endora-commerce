/**
 * Non-English prose still standing in `dictionaries`
 * (`specs/094-translation-boundary/contracts/default-language-prose-check.md` § 2.1).
 *
 * Keyed `<file>:<digest of the literal>` — a **digest, never a line**, so an
 * insertion above the site does not red it and an edited sentence does. One key
 * therefore covers every occurrence of the same sentence in the same file, which
 * is right: one sentence is one repair.
 *
 * Two-way: an unledgered non-English default fails the build, and an entry that
 * no longer describes one fails it too. Delete this file when the last entry
 * goes; an empty shard is refused, because a done signal that says nothing is
 * not one.
 *
 * Every entry says **what the site is** and **which case of
 * `contracts/translation-boundary.md` § 2 its repair takes**, because the four
 * cases ask for different repairs and a ledger that only recorded the finding
 * would send its reader to the wrong one.
 */
export const entries: Readonly<Record<string, string>> = {
  'packages/modules/dictionaries/src/backend/seed/currencies.ts:060d8137f646':
    '`Polish złoty` — English prose carrying the currency\'s own diacritics. `Polish zloty` ' +
    'and `Icelandic krona` are the English names of those currencies, spelled with the ' +
    'letters those currencies are spelled with; neither is a Polish sentence and neither ' +
    'has an English form to be translated into.\n\n' +
    'This is the detector at its declared bound (§ 1.3) rather than a site that is right to ' +
    'stay Polish, and it is recorded because the alternative was worse. The shape is ' +
    '`[ASCII word][word carrying a Polish diacritic]`, which is byte-for-byte the shape of ' +
    '`Data sprzedazy` two modules away — a real finding — so nothing lexical separates ' +
    'them, and an English veto lexicon would have to know that the first word of the real ' +
    'one is Polish as well. Dropping the letter instead is not available either: `o` with ' +
    'an acute is the only Polish signal in `Potwierdzenie zamowienia`, a live finding in ' +
    '`orders`.\n\n' +
    'Retired by a Polish lexicon rather than by an edit here. A **third** entry of this ' +
    'shape means the predicate has outgrown its population and should be narrowed — never a ' +
    'third entry.',
  'packages/modules/dictionaries/src/backend/seed/currencies.ts:9a95e8a9ef04':
    '`Icelandic króna` — English prose carrying the currency\'s own diacritics. `Polish ' +
    'zloty` and `Icelandic krona` are the English names of those currencies, spelled with ' +
    'the letters those currencies are spelled with; neither is a Polish sentence and ' +
    'neither has an English form to be translated into.\n\n' +
    'This is the detector at its declared bound (§ 1.3) rather than a site that is right to ' +
    'stay Polish, and it is recorded because the alternative was worse. The shape is ' +
    '`[ASCII word][word carrying a Polish diacritic]`, which is byte-for-byte the shape of ' +
    '`Data sprzedazy` two modules away — a real finding — so nothing lexical separates ' +
    'them, and an English veto lexicon would have to know that the first word of the real ' +
    'one is Polish as well. Dropping the letter instead is not available either: `o` with ' +
    'an acute is the only Polish signal in `Potwierdzenie zamowienia`, a live finding in ' +
    '`orders`.\n\n' +
    'Retired by a Polish lexicon rather than by an edit here. A **third** entry of this ' +
    'shape means the predicate has outgrown its population and should be narrowed — never a ' +
    'third entry.',
};
