/**
 * Non-English prose still standing in `catalog`
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
  'packages/modules/catalog/src/backend/services/bulk-operation.service.ts:22e50d762633':
    '`… elementów zakończyło się błędem — szczegóły w statusie pojedynczyc…` — Shape B — a ' +
    'push into the **persisted** operation log (`logs.push(logEntry(...))`), rendered on ' +
    'the bulk-operations admin screen.\n\n' +
    '`specs/093-backend-delivered-prose/` had already read this file: it took eight English ' +
    'literals from the `notify()` method about three hundred lines below and never saw ' +
    'these, because its question was *which calls carry prose* and an array push is not a ' +
    'call. That is the taxonomy correction `specs/094-translation-boundary/research.md` § ' +
    '7.3 records.\n\n' +
    'Case 2 (`contracts/translation-boundary.md` § 2.2): the row is stored and read later ' +
    'by whichever administrators open the operation, whose `preferredLanguage` values ' +
    'differ, so the backend cannot resolve the reader\'s language at the moment it composes ' +
    'the line. The entry ships a key, its params and an English fallback sentence; the ' +
    'fallback is not optional, because a row carrying only a key renders as a raw key to a ' +
    'human.',
  'packages/modules/catalog/src/backend/services/bulk-operation.service.ts:3691fcb931de':
    '`Przeindeksowano … dokumentów we wszystkich indeksach.` — Shape B — a push into the ' +
    '**persisted** operation log (`logs.push(logEntry(...))`), rendered on the bulk- ' +
    'operations admin screen.\n\n' +
    '`specs/093-backend-delivered-prose/` had already read this file: it took eight English ' +
    'literals from the `notify()` method about three hundred lines below and never saw ' +
    'these, because its question was *which calls carry prose* and an array push is not a ' +
    'call. That is the taxonomy correction `specs/094-translation-boundary/research.md` § ' +
    '7.3 records.\n\n' +
    'Case 2 (`contracts/translation-boundary.md` § 2.2): the row is stored and read later ' +
    'by whichever administrators open the operation, whose `preferredLanguage` values ' +
    'differ, so the backend cannot resolve the reader\'s language at the moment it composes ' +
    'the line. The entry ships a key, its params and an English fallback sentence; the ' +
    'fallback is not optional, because a row carrying only a key renders as a raw key to a ' +
    'human.',
  'packages/modules/catalog/src/backend/services/bulk-operation.service.ts:6294d87e9700':
    '`Operacja nie powiodła się: …` — Shape B — a push into the **persisted** operation log ' +
    '(`logs.push(logEntry(...))`), rendered on the bulk-operations admin screen.\n\n' +
    '`specs/093-backend-delivered-prose/` had already read this file: it took eight English ' +
    'literals from the `notify()` method about three hundred lines below and never saw ' +
    'these, because its question was *which calls carry prose* and an array push is not a ' +
    'call. That is the taxonomy correction `specs/094-translation-boundary/research.md` § ' +
    '7.3 records.\n\n' +
    'Case 2 (`contracts/translation-boundary.md` § 2.2): the row is stored and read later ' +
    'by whichever administrators open the operation, whose `preferredLanguage` values ' +
    'differ, so the backend cannot resolve the reader\'s language at the moment it composes ' +
    'the line. The entry ships a key, its params and an English fallback sentence; the ' +
    'fallback is not optional, because a row carrying only a key renders as a raw key to a ' +
    'human.',
  'packages/modules/catalog/src/backend/services/bulk-operation.service.ts:671314b4c22b':
    '`Zakończono: … z powodzeniem, … pominięto, … z błędem (łącznie …).` — Shape B — a push ' +
    'into the **persisted** operation log (`logs.push(logEntry(...))`), rendered on the ' +
    'bulk-operations admin screen.\n\n' +
    '`specs/093-backend-delivered-prose/` had already read this file: it took eight English ' +
    'literals from the `notify()` method about three hundred lines below and never saw ' +
    'these, because its question was *which calls carry prose* and an array push is not a ' +
    'call. That is the taxonomy correction `specs/094-translation-boundary/research.md` § ' +
    '7.3 records.\n\n' +
    'Case 2 (`contracts/translation-boundary.md` § 2.2): the row is stored and read later ' +
    'by whichever administrators open the operation, whose `preferredLanguage` values ' +
    'differ, so the backend cannot resolve the reader\'s language at the moment it composes ' +
    'the line. The entry ships a key, its params and an English fallback sentence; the ' +
    'fallback is not optional, because a row carrying only a key renders as a raw key to a ' +
    'human.',
  'packages/modules/catalog/src/backend/services/bulk-operation.service.ts:70d37efa6c15':
    '`Rozpoczęto przetwarzanie operacji (… elementów).` — Shape B — a push into the ' +
    '**persisted** operation log (`logs.push(logEntry(...))`), rendered on the bulk- ' +
    'operations admin screen.\n\n' +
    '`specs/093-backend-delivered-prose/` had already read this file: it took eight English ' +
    'literals from the `notify()` method about three hundred lines below and never saw ' +
    'these, because its question was *which calls carry prose* and an array push is not a ' +
    'call. That is the taxonomy correction `specs/094-translation-boundary/research.md` § ' +
    '7.3 records.\n\n' +
    'Case 2 (`contracts/translation-boundary.md` § 2.2): the row is stored and read later ' +
    'by whichever administrators open the operation, whose `preferredLanguage` values ' +
    'differ, so the backend cannot resolve the reader\'s language at the moment it composes ' +
    'the line. The entry ships a key, its params and an English fallback sentence; the ' +
    'fallback is not optional, because a row carrying only a key renders as a raw key to a ' +
    'human.',
  'packages/modules/catalog/src/backend/services/bulk-operation.service.ts:8add2d188fde':
    '`Operacja utworzona i dodana do kolejki (… elementów).` — Shape B — a push into the ' +
    '**persisted** operation log (`logs.push(logEntry(...))`), rendered on the bulk- ' +
    'operations admin screen.\n\n' +
    '`specs/093-backend-delivered-prose/` had already read this file: it took eight English ' +
    'literals from the `notify()` method about three hundred lines below and never saw ' +
    'these, because its question was *which calls carry prose* and an array push is not a ' +
    'call. That is the taxonomy correction `specs/094-translation-boundary/research.md` § ' +
    '7.3 records.\n\n' +
    'Case 2 (`contracts/translation-boundary.md` § 2.2): the row is stored and read later ' +
    'by whichever administrators open the operation, whose `preferredLanguage` values ' +
    'differ, so the backend cannot resolve the reader\'s language at the moment it composes ' +
    'the line. The entry ships a key, its params and an English fallback sentence; the ' +
    'fallback is not optional, because a row carrying only a key renders as a raw key to a ' +
    'human.',
};
