/**
 * Non-English prose still standing in `orders`
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
  'packages/modules/orders/src/backend/email-templates/order-confirmation.ts:50ea36947403':
    '`Metoda płatności: …` — Shape F — an ad-hoc bilingual ternary, `pl ? \'<polish>\' : ' +
    '\'<english>\'`, in the legacy in-code order-confirmation builder.\n\n' +
    'Compliant in the one sense that both languages are present, and fragile in every ' +
    'other: the selector is a boolean, so a third shipped language has nowhere to go; the ' +
    'sentences live beside the code rather than in `orders`\' bundle, where nothing ' +
    'reconciles them against the keys the rest of the module ships; and each new line is ' +
    'one more place to forget the second branch.\n\n' +
    'Case 1 — the recipient is known at composition. The shape it converges on is already ' +
    'in this module: `email-templates/order-confirmation.default.ts` carries the same ' +
    'message as a per-language `languages: { \'en-US\': ..., \'pl-PL\': ... }` envelope, which ' +
    'this check exempts by construction.',
  'packages/modules/orders/src/backend/email-templates/order-confirmation.ts:733ffb18bfdf':
    '`Dziękujemy za zamówienie.` — Shape F — an ad-hoc bilingual ternary, `pl ? \'<polish>\' ' +
    ': \'<english>\'`, in the legacy in-code order-confirmation builder.\n\n' +
    'Compliant in the one sense that both languages are present, and fragile in every ' +
    'other: the selector is a boolean, so a third shipped language has nowhere to go; the ' +
    'sentences live beside the code rather than in `orders`\' bundle, where nothing ' +
    'reconciles them against the keys the rest of the module ships; and each new line is ' +
    'one more place to forget the second branch.\n\n' +
    'Case 1 — the recipient is known at composition. The shape it converges on is already ' +
    'in this module: `email-templates/order-confirmation.default.ts` carries the same ' +
    'message as a per-language `languages: { \'en-US\': ..., \'pl-PL\': ... }` envelope, which ' +
    'this check exempts by construction.',
  'packages/modules/orders/src/backend/email-templates/order-confirmation.ts:8f57c37b538c':
    '`Potwierdzenie zamówienia …` — Shape F — an ad-hoc bilingual ternary, `pl ? \'<polish>\' ' +
    ': \'<english>\'`, in the legacy in-code order-confirmation builder.\n\n' +
    'Compliant in the one sense that both languages are present, and fragile in every ' +
    'other: the selector is a boolean, so a third shipped language has nowhere to go; the ' +
    'sentences live beside the code rather than in `orders`\' bundle, where nothing ' +
    'reconciles them against the keys the rest of the module ships; and each new line is ' +
    'one more place to forget the second branch.\n\n' +
    'Case 1 — the recipient is known at composition. The shape it converges on is already ' +
    'in this module: `email-templates/order-confirmation.default.ts` carries the same ' +
    'message as a per-language `languages: { \'en-US\': ..., \'pl-PL\': ... }` envelope, which ' +
    'this check exempts by construction.',
};
