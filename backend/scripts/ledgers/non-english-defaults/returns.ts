/**
 * Non-English prose still standing in `returns`
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
  'packages/modules/returns/src/manifest.ts:879168909d0f':
    '`statusy zwrotów` — A command-palette (Cmd-K) **search keyword**, deliberately ' +
    'bilingual so that a Polish operator typing their own word finds the screen.\n\n' +
    'It is debt rather than a mistake, and the repair is not an edit to this line. ' +
    'Principle XVI puts a manifest action\'s `labelKey` and `descriptionKey` in the module\'s ' +
    'own bundle and leaves `keywords` a flat array with no per-language shape at all, so ' +
    'the honest fix is a `ModuleManifestSchema` change that lets an action declare keywords ' +
    'per language — at which point every entry of this shape retires at once.\n\n' +
    'Deleting the Polish keyword instead would satisfy this check and make the screen ' +
    'unfindable for the operator it was added for, which is the wrong direction under a ' +
    'ruling whose clause 2 is *two languages are the floor, not the ceiling*.',
};
