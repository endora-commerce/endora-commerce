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
  'packages/modules/orders/src/manifest.ts:08715f6e81ec':
    '`cykl życia` — A command-palette (Cmd-K) **search keyword**, deliberately bilingual so ' +
    'that a Polish operator typing their own word finds the screen.\n\n' +
    'It is debt rather than a mistake, and the repair is not an edit to this line. ' +
    'Principle XVI puts a manifest action\'s `labelKey` and `descriptionKey` in the module\'s ' +
    'own bundle and leaves `keywords` a flat array with no per-language shape at all, so ' +
    'the honest fix is a `ModuleManifestSchema` change that lets an action declare keywords ' +
    'per language — at which point every entry of this shape retires at once.\n\n' +
    'Deleting the Polish keyword instead would satisfy this check and make the screen ' +
    'unfindable for the operator it was added for, which is the wrong direction under a ' +
    'ruling whose clause 2 is *two languages are the floor, not the ceiling*.',
  'packages/modules/orders/src/manifest.ts:3d83018dc7c0':
    '`Anna Nowak ul. Główna 1` — A Polish `sampleValue` in a manifest\'s template-variable ' +
    'picker — the example an operator reads to learn what the variable renders.\n\n' +
    'Case 1: the picker is an admin screen answering a request whose language the platform ' +
    'resolves, so the sample is a sentence the backend can translate. The cheapest honest ' +
    'repair is an English sample; a per-language `sampleValue` is the fuller one and needs ' +
    'a `ModuleManifestSchema` change, so it is the same retiring condition as this module\'s ' +
    'palette keywords where the two coincide.',
};
