// Dictionary module manifest — feature 017 / R10 / T012.
//
// Single contribution: the `dictionary.write` permission code, used by
// every admin endpoint under `/api/v1/admin/dictionary/**`. The bootstrap
// "Platform Administrator" role holds the wildcard `*` permission and
// therefore auto-inherits this code; operators who need a narrower role
// can add `dictionary.write` to a custom role via the existing
// `/api/v1/admin/admin-roles` surface (feature 003).
//
// Reads of the Dictionary registry — both storefront (`/api/v1/dictionary`)
// and the cross-module DictionaryValidator port — DO NOT require this
// permission. They are public service surfaces.

import { defineModuleManifest } from '@endora-commerce/contracts';

export const DICTIONARY_PERMISSIONS = {
  WRITE: 'dictionary.write',
} as const;

export type DictionaryPermission =
  (typeof DICTIONARY_PERMISSIONS)[keyof typeof DICTIONARY_PERMISSIONS];

/**
 * Module-lifecycle manifest (feature 018) — Pass B retrofit. The
 * `dictionaries` schema is platform-foundational (migration 038),
 * owned cross-cuttingly rather than by an install hook, so this entry
 * declares no `installHook`. Its purpose is to register the module's
 * presence in the static registry so other modules (notably `inventory`
 * and `blog`) can declare `dictionaries` as a dependency without the
 * registry warning "depends on … which is not in the static registry".
 */
export const manifest = defineModuleManifest({
  id: 'dictionaries',
  name: 'Dictionary',
  description:
    'Cross-module registry of countries, languages, and currencies — backs every dropdown, validator, and address-form picker on the storefront and admin.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by. Feature
  // 072 made it a container resolution rather than an optional argument that
  // decided whether the admin surface existed at all.
  dependencies: ['currencies', 'languages', 'auth'],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  permissions: [{ code: DICTIONARY_PERMISSIONS.WRITE, label: 'Manage dictionary registry' }],

  /**
   * Feature 090 Phase 3 — the eight error codes the incumbent prefix chain
   * routes to `dictionaries`, copied from the frozen capture
   * (`backend/test/fixtures/error-code-routing/chain-answers.ts`, the chain's
   * *answer* at `49f3c6817`) rather than judged. The list is not curated: the
   * migration is answer-preserving over all 289 codes, so a code is here
   * because the chain put it here.
   *
   * **Six of the eight are raised outside this package, and one of those is
   * raised nowhere inside it** — D-95.2 working as intended, since ownership
   * follows the domain noun and never the thrower. `dictionaries` is a screen
   * over other modules' catalogues rather than the owner of their rows: the
   * `currencies` and `languages` services raise
   * `DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED`, `DICTIONARY_LAST_ACTIVE_ENTRY`,
   * `DICTIONARY_ENTRY_HAS_DEPENDENTS`, `DICTIONARY_ENTRY_NOT_FOUND` and — for
   * `DICTIONARY_FALLBACK_CYCLE`, whose only three raise sites are in
   * `languages` — all of them. `DICTIONARY_ENTRY_INACTIVE` is raised once here
   * and nine times by consumer modules (`addresses`, `blog` twice, `inventory`,
   * `megamenu`, `organizations`, `promotions`, `sales_channels`, `taxes`),
   * which translate a caught `DictionaryReferenceError` into
   * `new HttpError(409, err.code, …)` — the code is computed there, so the
   * literal never appears as the second argument.
   *
   * **The inverse holds too, and it is a decision an earlier feature made**
   * (trap T2). `UNKNOWN_CURRENCY_CODE` and `UNKNOWN_LANGUAGE_CODE` read like
   * this module's and route to `sales_channels`, which declared them in !1125;
   * feature 017 superseded both with `DICTIONARY_ENTRY_NOT_FOUND`, so the
   * sentences that answer today are here and the ownership of the legacy codes
   * is not. `CURRENCY_MISMATCH` routes to `core`. None of the three is declared
   * here, and re-routing is out of scope
   * (`specs/090-module-owned-error-codes/` §6.5).
   *
   * **Two of the eight are raised by nothing**, searched in both spellings
   * (`ERROR_CODES.<CODE>` and the bare quoted literal) over `backend/src` and
   * `packages`, test files excluded. They are declared anyway — ownership
   * follows the capture (trap T10) — and what happens instead was established
   * rather than classified:
   *
   * - `DICTIONARY_TRANSLATION_LANGUAGE_INACTIVE` — the rule is built and
   *   enforced. `TranslationService.upsert` refuses a translation whose
   *   language is inactive, in that exact condition, under the coarser
   *   `DICTIONARY_ENTRY_INACTIVE`. The specific sentence is unreachable
   *   because a live successor answers first, and the two agree about what
   *   happened.
   * - `DICTIONARY_CODE_IMMUTABLE` — nothing refuses, because nothing can ask.
   *   No write path anywhere renames an entry: `updateCountryRequestSchema`,
   *   `updateDictionaryCurrencyRequestSchema` and
   *   `updateDictionaryLanguageRequestSchema` carry no `code` field, the three
   *   `Update*Input` types carry none either, and the entry code comes off the
   *   URL parameter. The schemas are non-strict `z.object()`s, so a `code` in
   *   the body is dropped silently — not refused as `VALIDATION_FAILED`. The
   *   immutability is structural and the refusal has no occasion to fire.
   *
   * No `tokens`: no code here carries a refusal discriminator. `refusalToken`
   * reads `details.code` and nothing else, and no `new HttpError` raising one
   * of these eight passes a fourth argument with a `code` member. Three of them
   * do pass a fourth argument — all three `DICTIONARY_ENTRY_HAS_DEPENDENTS`
   * sites pass the Zod-style `Array<{ path, issue }>`, which `refusalToken`
   * ignores by construction. The runbook's §5 raise-site scan attributes the
   * tree's ten token-carrying codes to `core`, `invoices` and `carts` and names
   * none of these; the bundles hold no `errors.<CODE>.<token>` key in the other
   * direction.
   */
  errorCodes: [
    { code: 'DICTIONARY_CODE_IMMUTABLE' },
    { code: 'DICTIONARY_DEFAULT_CANNOT_BE_DEACTIVATED' },
    { code: 'DICTIONARY_ENTRY_HAS_DEPENDENTS' },
    { code: 'DICTIONARY_ENTRY_INACTIVE' },
    { code: 'DICTIONARY_ENTRY_NOT_FOUND' },
    { code: 'DICTIONARY_FALLBACK_CYCLE' },
    { code: 'DICTIONARY_LAST_ACTIVE_ENTRY' },
    { code: 'DICTIONARY_TRANSLATION_LANGUAGE_INACTIVE' },
  ],
  /**
   * Feature 091, Phase 4 batch 10 — the two palette entries this module has
   * always advertised, declared where the server can filter them.
   *
   * `AppShell.tsx`'s `PALETTE_ITEMS` carried a hand-written *Navigate* row for
   * each of these two screens, and a hand-written palette row is a copy the
   * server was never asked about: it kept advertising the screens whatever the
   * effective enabled-set said. Both arrive here instead, with the
   * destinations, the code and the keywords those rows carried, so nothing an
   * operator can see changes and the advertisement is now gated the way every
   * other one is.
   *
   * **Both declare `dictionary.write`, which is the only code this module has.**
   * All 23 registrations under `/api/v1/admin/dictionary/*` enforce it, reads
   * included — the registry screen is an editing surface and this module never
   * split read from write — so the action, the route and the API are one code
   * and the palette never advertises a 403.
   */
  actions: [
    {
      id: 'open-dictionary',
      labelKey: 'actions.openDictionary.label',
      descriptionKey: 'actions.openDictionary.description',
      icon: 'Languages',
      targetRoute: '/dictionary',
      requiredPermission: DICTIONARY_PERMISSIONS.WRITE,
      keywords: [
        'dictionary',
        'countries',
        'currencies',
        'languages',
        'i18n',
        'słownik',
        'kraje',
        'waluty',
        'języki',
      ],
      weight: 250,
    },
    {
      id: 'open-dictionary-audit',
      labelKey: 'actions.openDictionaryAudit.label',
      descriptionKey: 'actions.openDictionaryAudit.description',
      icon: 'ListChecks',
      // The `/admin`-prefixed spelling, which is the one the sidebar row
      // advertised and the one this module's nav contribution declares. The
      // unprefixed `/dictionaries/audit` route still resolves and is
      // deliberately not advertised twice.
      targetRoute: '/admin/dictionaries/audit',
      requiredPermission: DICTIONARY_PERMISSIONS.WRITE,
      keywords: ['dictionary', 'audit', 'orphan', 'references', 'audyt', 'słownika'],
      weight: 251,
    },
  ],
  // Feature 074 (Constitution XVII), test C3 — platform primitive. The flag
  // used to rest on `organizations` declaring this module; ruling 2 withdraws
  // a dependent's authority to impose the lock, so the ground is now this
  // module's own. It is the shared reference-data primitive — countries,
  // units, document types — that every other module validates and renders
  // against. There is no business decision underneath it: nobody chooses to
  // stop having countries.
  activation: {
    nonDeactivatable: true,
    reason:
      'The shared reference-data primitive — countries, units, document types — that every ' +
      'other surface validates and renders against.',
  },
});
