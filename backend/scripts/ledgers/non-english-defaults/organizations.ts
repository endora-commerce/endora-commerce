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
  'packages/modules/organizations/src/manifest.ts:4dd6d635a3cd':
    '`Oczekuje na weryfikację` — A Polish `sampleValue` in a manifest\'s template-variable ' +
    'picker — the example an operator reads to learn what the variable renders.\n\n' +
    'Case 1: the picker is an admin screen answering a request whose language the platform ' +
    'resolves, so the sample is a sentence the backend can translate. The cheapest honest ' +
    'repair is an English sample; a per-language `sampleValue` is the fuller one and needs ' +
    'a `ModuleManifestSchema` change, so it is the same retiring condition as this module\'s ' +
    'palette keywords where the two coincide.',
};
