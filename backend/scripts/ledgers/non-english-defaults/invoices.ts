/**
 * Non-English prose still standing in `invoices`
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
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:0676459c676a':
    '`Data sprzedaży` — Shape D — a Polish **default** behind an operator-editable pdfmake ' +
    'prop, `str(props, \'<key>\', \'<default>\')`.\n\n' +
    '`specs/093-backend-delivered-prose/` excluded eighteen sites in this file on the ' +
    'ground that they *have a mechanism*. The mechanism is real — a `locale` is threaded ' +
    'through the renderer and every label is readable from a template prop — and the ' +
    'exclusion still fails the owner\'s ruling, because *has a mechanism* is not *has an ' +
    'English default*: an operator who never edits the template gets a Polish invoice on an ' +
    'English deployment (D-9).\n\n' +
    'Case 1 (`contracts/translation-boundary.md` § 2.1): a rendered document carries its ' +
    'own `locale`, so the backend can resolve the reader\'s language at the moment it ' +
    'composes the label. Author the default in English and read the Polish from `invoices`\' ' +
    'own bundle.',
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:2a33dd1d5562':
    '`Zapłacono` — Shape D — a Polish **default** behind an operator-editable pdfmake prop, ' +
    '`str(props, \'<key>\', \'<default>\')`.\n\n' +
    '`specs/093-backend-delivered-prose/` excluded eighteen sites in this file on the ' +
    'ground that they *have a mechanism*. The mechanism is real — a `locale` is threaded ' +
    'through the renderer and every label is readable from a template prop — and the ' +
    'exclusion still fails the owner\'s ruling, because *has a mechanism* is not *has an ' +
    'English default*: an operator who never edits the template gets a Polish invoice on an ' +
    'English deployment (D-9).\n\n' +
    'Case 1 (`contracts/translation-boundary.md` § 2.1): a rendered document carries its ' +
    'own `locale`, so the backend can resolve the reader\'s language at the moment it ' +
    'composes the label. Author the default in English and read the Polish from `invoices`\' ' +
    'own bundle.',
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:3ddb1abf2e3c':
    '`Wartość netto` — A Polish literal on a rendered invoice, outside the prop mechanism ' +
    'entirely — the document titles, the line-table and VAT-summary column headers, and the ' +
    'footer\'s ternary default, none of which a prop accessor reaches.\n\n' +
    'Case 1, for the same reason as this module\'s prop defaults: the renderer is handed a ' +
    '`locale` and can resolve the reader\'s language when it composes the string. The repair ' +
    'is `invoices`\' own bundle, and it is one repair for both shapes.',
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:41927da026cf':
    '`Metoda płatności` — Shape D — a Polish **default** behind an operator-editable ' +
    'pdfmake prop, `str(props, \'<key>\', \'<default>\')`.\n\n' +
    '`specs/093-backend-delivered-prose/` excluded eighteen sites in this file on the ' +
    'ground that they *have a mechanism*. The mechanism is real — a `locale` is threaded ' +
    'through the renderer and every label is readable from a template prop — and the ' +
    'exclusion still fails the owner\'s ruling, because *has a mechanism* is not *has an ' +
    'English default*: an operator who never edits the template gets a Polish invoice on an ' +
    'English deployment (D-9).\n\n' +
    'Case 1 (`contracts/translation-boundary.md` § 2.1): a rendered document carries its ' +
    'own `locale`, so the backend can resolve the reader\'s language at the moment it ' +
    'composes the label. Author the default in English and read the Polish from `invoices`\' ' +
    'own bundle.',
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:5fec0bb03b1d':
    '`Słownie` — Shape D — a Polish **default** behind an operator-editable pdfmake prop, ' +
    '`str(props, \'<key>\', \'<default>\')`.\n\n' +
    '`specs/093-backend-delivered-prose/` excluded eighteen sites in this file on the ' +
    'ground that they *have a mechanism*. The mechanism is real — a `locale` is threaded ' +
    'through the renderer and every label is readable from a template prop — and the ' +
    'exclusion still fails the owner\'s ruling, because *has a mechanism* is not *has an ' +
    'English default*: an operator who never edits the template gets a Polish invoice on an ' +
    'English deployment (D-9).\n\n' +
    'Case 1 (`contracts/translation-boundary.md` § 2.1): a rendered document carries its ' +
    'own `locale`, so the backend can resolve the reader\'s language at the moment it ' +
    'composes the label. Author the default in English and read the Polish from `invoices`\' ' +
    'own bundle.',
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:624e3b89c089':
    '`Faktura korygująca` — A Polish literal on a rendered invoice, outside the prop ' +
    'mechanism entirely — the document titles, the line-table and VAT-summary column ' +
    'headers, and the footer\'s ternary default, none of which a prop accessor reaches.\n\n' +
    'Case 1, for the same reason as this module\'s prop defaults: the renderer is handed a ' +
    '`locale` and can resolve the reader\'s language when it composes the string. The repair ' +
    'is `invoices`\' own bundle, and it is one repair for both shapes.',
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:8d7286ece9de':
    '`Termin płatności` — Shape D — a Polish **default** behind an operator-editable ' +
    'pdfmake prop, `str(props, \'<key>\', \'<default>\')`.\n\n' +
    '`specs/093-backend-delivered-prose/` excluded eighteen sites in this file on the ' +
    'ground that they *have a mechanism*. The mechanism is real — a `locale` is threaded ' +
    'through the renderer and every label is readable from a template prop — and the ' +
    'exclusion still fails the owner\'s ruling, because *has a mechanism* is not *has an ' +
    'English default*: an operator who never edits the template gets a Polish invoice on an ' +
    'English deployment (D-9).\n\n' +
    'Case 1 (`contracts/translation-boundary.md` § 2.1): a rendered document carries its ' +
    'own `locale`, so the backend can resolve the reader\'s language at the moment it ' +
    'composes the label. Author the default in English and read the Polish from `invoices`\' ' +
    'own bundle.',
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:99a4e0bb46c8':
    '`Wartość brutto` — A Polish literal on a rendered invoice, outside the prop mechanism ' +
    'entirely — the document titles, the line-table and VAT-summary column headers, and the ' +
    'footer\'s ternary default, none of which a prop accessor reaches.\n\n' +
    'Case 1, for the same reason as this module\'s prop defaults: the renderer is handed a ' +
    '`locale` and can resolve the reader\'s language when it composes the string. The repair ' +
    'is `invoices`\' own bundle, and it is one repair for both shapes.',
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:d86eac8e4aa1':
    '`Do zapłaty` — Shape D — a Polish **default** behind an operator-editable pdfmake ' +
    'prop, `str(props, \'<key>\', \'<default>\')`.\n\n' +
    '`specs/093-backend-delivered-prose/` excluded eighteen sites in this file on the ' +
    'ground that they *have a mechanism*. The mechanism is real — a `locale` is threaded ' +
    'through the renderer and every label is readable from a template prop — and the ' +
    'exclusion still fails the owner\'s ruling, because *has a mechanism* is not *has an ' +
    'English default*: an operator who never edits the template gets a Polish invoice on an ' +
    'English deployment (D-9).\n\n' +
    'Case 1 (`contracts/translation-boundary.md` § 2.1): a rendered document carries its ' +
    'own `locale`, so the backend can resolve the reader\'s language at the moment it ' +
    'composes the label. Author the default in English and read the Polish from `invoices`\' ' +
    'own bundle.',
  'packages/modules/invoices/src/backend/pdf-components/sections.ts:e01629332f5f':
    '`Dziękujemy za współpracę. {{var seller.legalName}} · NIP {{var selle…` — A Polish ' +
    'literal on a rendered invoice, outside the prop mechanism entirely — the document ' +
    'titles, the line-table and VAT-summary column headers, and the footer\'s ternary ' +
    'default, none of which a prop accessor reaches.\n\n' +
    'Case 1, for the same reason as this module\'s prop defaults: the renderer is handed a ' +
    '`locale` and can resolve the reader\'s language when it composes the string. The repair ' +
    'is `invoices`\' own bundle, and it is one repair for both shapes.',
  'packages/modules/invoices/src/backend/services/invoice-pdf-renderer.ts:519ec43b2dba':
    '`Dokument korygujący do faktury pierwotnej.` — A Polish literal on a rendered invoice, ' +
    'outside the prop mechanism entirely — the document titles, the line-table and VAT- ' +
    'summary column headers, and the footer\'s ternary default, none of which a prop ' +
    'accessor reaches.\n\n' +
    'Case 1, for the same reason as this module\'s prop defaults: the renderer is handed a ' +
    '`locale` and can resolve the reader\'s language when it composes the string. The repair ' +
    'is `invoices`\' own bundle, and it is one repair for both shapes.',
  'packages/modules/invoices/src/backend/services/invoice-service.ts:ec70f6e132d7':
    '`Dopłata za metodę płatności` — Shape C — a **persisted** invoice line item: the ' +
    'surcharge line\'s `name` is written into the stored document and read by whoever opens ' +
    'the invoice afterwards.\n\n' +
    'Case 2 (`contracts/translation-boundary.md` § 2.2), and it differs from the labels in ' +
    'the same module deliberately: a label is composed at render time, when the document\'s ' +
    '`locale` is in hand, while this string is composed at **issue** time and frozen into ' +
    'the row. The seam therefore stores a key, its params and an English fallback sentence, ' +
    'and the renderer resolves it against the document\'s `locale` when it draws the line.',
};
