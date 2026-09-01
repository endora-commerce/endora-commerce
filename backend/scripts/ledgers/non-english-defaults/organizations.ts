/**
 * Non-English prose still standing in `organizations`
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
  'packages/modules/organizations/src/backend/routes.customer.ts:07e0e9dfb8b0':
    '`Twoja Organizacja oczekuje na weryfikację. Zamówienia i Zapytania Of…` — Shape A — ' +
    '`describeStatus`, a Polish sentence **returned from a route handler**, and the worked ' +
    'instance `contracts/translation-boundary.md` § 2.1 and D-7 are written around.\n\n' +
    'Case 1, and the hybrid is already built: the response carries `status` beside ' +
    '`reason`, so the machine token is on the wire and only the translation step is ' +
    'missing. `createRequestLanguageResolver` resolves this very request\'s language — ' +
    'through `Accept-Language`, then the sales channel\'s `defaultLanguage`, then ' +
    '`LANGUAGE_FALLBACK` — and the error envelope already uses that resolution on the same ' +
    'request. The repair is one parameter and a lookup in `organizations`\' own bundle.\n\n' +
    'It is **not** case 2, and D-7 says why in writing: the boundary question asks whether ' +
    'the backend *can* resolve the reader\'s language, not whether it does. Reading *does ' +
    'not* for *cannot* would make the rule circular and ratify whatever the code already ' +
    'happens to do.',
  'packages/modules/organizations/src/backend/routes.customer.ts:63ce6658e6ce':
    '`Składanie Zamówień i Zapytań Ofertowych jest obecnie wstrzymane. Pro…` — Shape A — ' +
    '`describeStatus`, a Polish sentence **returned from a route handler**, and the worked ' +
    'instance `contracts/translation-boundary.md` § 2.1 and D-7 are written around.\n\n' +
    'Case 1, and the hybrid is already built: the response carries `status` beside ' +
    '`reason`, so the machine token is on the wire and only the translation step is ' +
    'missing. `createRequestLanguageResolver` resolves this very request\'s language — ' +
    'through `Accept-Language`, then the sales channel\'s `defaultLanguage`, then ' +
    '`LANGUAGE_FALLBACK` — and the error envelope already uses that resolution on the same ' +
    'request. The repair is one parameter and a lookup in `organizations`\' own bundle.\n\n' +
    'It is **not** case 2, and D-7 says why in writing: the boundary question asks whether ' +
    'the backend *can* resolve the reader\'s language, not whether it does. Reading *does ' +
    'not* for *cannot* would make the rule circular and ratify whatever the code already ' +
    'happens to do.',
  'packages/modules/organizations/src/backend/routes.customer.ts:e2509eb21ecf':
    '`Rejestracja Twojej Organizacji została odrzucona. Prosimy o kontakt…` — Shape A — ' +
    '`describeStatus`, a Polish sentence **returned from a route handler**, and the worked ' +
    'instance `contracts/translation-boundary.md` § 2.1 and D-7 are written around.\n\n' +
    'Case 1, and the hybrid is already built: the response carries `status` beside ' +
    '`reason`, so the machine token is on the wire and only the translation step is ' +
    'missing. `createRequestLanguageResolver` resolves this very request\'s language — ' +
    'through `Accept-Language`, then the sales channel\'s `defaultLanguage`, then ' +
    '`LANGUAGE_FALLBACK` — and the error envelope already uses that resolution on the same ' +
    'request. The repair is one parameter and a lookup in `organizations`\' own bundle.\n\n' +
    'It is **not** case 2, and D-7 says why in writing: the boundary question asks whether ' +
    'the backend *can* resolve the reader\'s language, not whether it does. Reading *does ' +
    'not* for *cannot* would make the rule circular and ratify whatever the code already ' +
    'happens to do.',
  'packages/modules/organizations/src/backend/routes.storefront.ts:89a6ca8b9ce7':
    '`Składanie Zamówień jest obecnie wstrzymane. Prosimy o kontakt z opie…` — Shape A — ' +
    '`describeStatus`, a Polish sentence **returned from a route handler**, and the worked ' +
    'instance `contracts/translation-boundary.md` § 2.1 and D-7 are written around.\n\n' +
    'Case 1, and the hybrid is already built: the response carries `status` beside ' +
    '`reason`, so the machine token is on the wire and only the translation step is ' +
    'missing. `createRequestLanguageResolver` resolves this very request\'s language — ' +
    'through `Accept-Language`, then the sales channel\'s `defaultLanguage`, then ' +
    '`LANGUAGE_FALLBACK` — and the error envelope already uses that resolution on the same ' +
    'request. The repair is one parameter and a lookup in `organizations`\' own bundle.\n\n' +
    'It is **not** case 2, and D-7 says why in writing: the boundary question asks whether ' +
    'the backend *can* resolve the reader\'s language, not whether it does. Reading *does ' +
    'not* for *cannot* would make the rule circular and ratify whatever the code already ' +
    'happens to do.',
  'packages/modules/organizations/src/backend/routes.storefront.ts:b4d7b7c03d5e':
    '`Twoja Organizacja oczekuje na weryfikację. Zamówienia będą dostępne…` — Shape A — ' +
    '`describeStatus`, a Polish sentence **returned from a route handler**, and the worked ' +
    'instance `contracts/translation-boundary.md` § 2.1 and D-7 are written around.\n\n' +
    'Case 1, and the hybrid is already built: the response carries `status` beside ' +
    '`reason`, so the machine token is on the wire and only the translation step is ' +
    'missing. `createRequestLanguageResolver` resolves this very request\'s language — ' +
    'through `Accept-Language`, then the sales channel\'s `defaultLanguage`, then ' +
    '`LANGUAGE_FALLBACK` — and the error envelope already uses that resolution on the same ' +
    'request. The repair is one parameter and a lookup in `organizations`\' own bundle.\n\n' +
    'It is **not** case 2, and D-7 says why in writing: the boundary question asks whether ' +
    'the backend *can* resolve the reader\'s language, not whether it does. Reading *does ' +
    'not* for *cannot* would make the rule circular and ratify whatever the code already ' +
    'happens to do.',
  'packages/modules/organizations/src/backend/routes.storefront.ts:e2509eb21ecf':
    '`Rejestracja Twojej Organizacji została odrzucona. Prosimy o kontakt…` — Shape A — ' +
    '`describeStatus`, a Polish sentence **returned from a route handler**, and the worked ' +
    'instance `contracts/translation-boundary.md` § 2.1 and D-7 are written around.\n\n' +
    'Case 1, and the hybrid is already built: the response carries `status` beside ' +
    '`reason`, so the machine token is on the wire and only the translation step is ' +
    'missing. `createRequestLanguageResolver` resolves this very request\'s language — ' +
    'through `Accept-Language`, then the sales channel\'s `defaultLanguage`, then ' +
    '`LANGUAGE_FALLBACK` — and the error envelope already uses that resolution on the same ' +
    'request. The repair is one parameter and a lookup in `organizations`\' own bundle.\n\n' +
    'It is **not** case 2, and D-7 says why in writing: the boundary question asks whether ' +
    'the backend *can* resolve the reader\'s language, not whether it does. Reading *does ' +
    'not* for *cannot* would make the rule circular and ratify whatever the code already ' +
    'happens to do.',
  'packages/modules/organizations/src/backend/routes.storefront.ts:ee659973ecc6':
    '`Składanie Zamówień obecnie niedostępne.` — Shape A — `describeStatus`, a Polish ' +
    'sentence **returned from a route handler**, and the worked instance ' +
    '`contracts/translation-boundary.md` § 2.1 and D-7 are written around.\n\n' +
    'Case 1, and the hybrid is already built: the response carries `status` beside ' +
    '`reason`, so the machine token is on the wire and only the translation step is ' +
    'missing. `createRequestLanguageResolver` resolves this very request\'s language — ' +
    'through `Accept-Language`, then the sales channel\'s `defaultLanguage`, then ' +
    '`LANGUAGE_FALLBACK` — and the error envelope already uses that resolution on the same ' +
    'request. The repair is one parameter and a lookup in `organizations`\' own bundle.\n\n' +
    'It is **not** case 2, and D-7 says why in writing: the boundary question asks whether ' +
    'the backend *can* resolve the reader\'s language, not whether it does. Reading *does ' +
    'not* for *cannot* would make the rule circular and ratify whatever the code already ' +
    'happens to do.',
  'packages/modules/organizations/src/backend/services/org-registration-notifier.ts:4dd6d635a3cd':
    '`Oczekuje na weryfikację` — The in-code fallback tier is Polish while this module\'s ' +
    'own bundle carries both languages — the register entry *`org-registration-notifier`\'s ' +
    'in-code fallback tier is Polish*.\n\n' +
    'It is reached only when the bundle fails to resolve, which is exactly the state a non- ' +
    'Polish deployment lands in after the boot reconciler logs and skips a malformed bundle ' +
    'and reports nothing else. So the harm is confined to a bundle-failure path and the ' +
    'site is still in the wrong language on the deployment that would read it.\n\n' +
    'English in the code, Polish in `i18n/pl.json`. Mechanical, and it is ' +
    '`specs/093-backend-delivered-prose/` Phase 4\'s `organizations` merge request, which ' +
    'was already sequenced last for this reason.',
  'packages/modules/organizations/src/backend/services/org-registration-notifier.ts:5b873a8090eb':
    '`Oczekuje na weryfikację.` — The in-code fallback tier is Polish while this module\'s ' +
    'own bundle carries both languages — the register entry *`org-registration-notifier`\'s ' +
    'in-code fallback tier is Polish*.\n\n' +
    'It is reached only when the bundle fails to resolve, which is exactly the state a non- ' +
    'Polish deployment lands in after the boot reconciler logs and skips a malformed bundle ' +
    'and reports nothing else. So the harm is confined to a bundle-failure path and the ' +
    'site is still in the wrong language on the deployment that would read it.\n\n' +
    'English in the code, Polish in `i18n/pl.json`. Mechanical, and it is ' +
    '`specs/093-backend-delivered-prose/` Phase 4\'s `organizations` merge request, which ' +
    'was already sequenced last for this reason.',
  'packages/modules/organizations/src/backend/services/org-registration-notifier.ts:959157e5faa6':
    '`Zarejestrowała się nowa Organizacja na platformie B2B.` — The in-code fallback tier ' +
    'is Polish while this module\'s own bundle carries both languages — the register entry ' +
    '*`org-registration-notifier`\'s in-code fallback tier is Polish*.\n\n' +
    'It is reached only when the bundle fails to resolve, which is exactly the state a non- ' +
    'Polish deployment lands in after the boot reconciler logs and skips a malformed bundle ' +
    'and reports nothing else. So the harm is confined to a bundle-failure path and the ' +
    'site is still in the wrong language on the deployment that would read it.\n\n' +
    'English in the code, Polish in `i18n/pl.json`. Mechanical, and it is ' +
    '`specs/093-backend-delivered-prose/` Phase 4\'s `organizations` merge request, which ' +
    'was already sequenced last for this reason.',
  'packages/modules/organizations/src/backend/services/org-registration-notifier.ts:da286bd53ab8':
    '`Otwórz w Panelu Administracyjnym: /organizations/…` — The in-code fallback tier is ' +
    'Polish while this module\'s own bundle carries both languages — the register entry ' +
    '*`org-registration-notifier`\'s in-code fallback tier is Polish*.\n\n' +
    'It is reached only when the bundle fails to resolve, which is exactly the state a non- ' +
    'Polish deployment lands in after the boot reconciler logs and skips a malformed bundle ' +
    'and reports nothing else. So the harm is confined to a bundle-failure path and the ' +
    'site is still in the wrong language on the deployment that would read it.\n\n' +
    'English in the code, Polish in `i18n/pl.json`. Mechanical, and it is ' +
    '`specs/093-backend-delivered-prose/` Phase 4\'s `organizations` merge request, which ' +
    'was already sequenced last for this reason.',
  'packages/modules/organizations/src/manifest.ts:4dd6d635a3cd':
    '`Oczekuje na weryfikację` — A Polish `sampleValue` in a manifest\'s template-variable ' +
    'picker — the example an operator reads to learn what the variable renders.\n\n' +
    'Case 1: the picker is an admin screen answering a request whose language the platform ' +
    'resolves, so the sample is a sentence the backend can translate. The cheapest honest ' +
    'repair is an English sample; a per-language `sampleValue` is the fuller one and needs ' +
    'a `ModuleManifestSchema` change, so it is the same retiring condition as this module\'s ' +
    'palette keywords where the two coincide.',
};
