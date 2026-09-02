/**
 * R2 — the write whose reading produced this feature (feature 097,
 * `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.2).
 *
 * Keyed `<file>:<table>`, two-way, and **this shard is expected to go**: the
 * repair is Phase 4 of the feature's own plan, which removes the two statements
 * from `up()` in place.
 *
 * Its R1 twin is in
 * `scripts/ledgers/migration-undeclared-references/transactional_emails.ts`. The
 * two entries exist together because one statement produces both findings and
 * they have different remedies — and because this is the case that proves R1
 * alone is not enough: the manifest line R1 would ask for is the one thing that
 * must not be written here.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/transactional_emails/src/migrations/20260801T111001_transactional_emails_email_defaults_reseed.ts:newsletter_email_blocks':
    {
      sites: 2,
      reason:
        'Two `UPDATE`s refreshing the system header and footer blocks `newsletter` owns, ' +
        'inside a migration whose subject is this module\'s own e-mail defaults.\n\n' +
        '**Seam: `newsletter`\'s own migration**, and it needs no cross-module edge at all. ' +
        'On a fresh database the write is already a no-op: `newsletter`\'s ' +
        '`20260629T200954_newsletter_init.ts` seeds those two blocks from the identical ' +
        '`envelopeFromTree(defaultHeaderTree(), DEFAULT_LANGUAGES)` call against the same ' +
        '`@endora-commerce/email-components` defaults, so these statements write bytes the ' +
        'owner has already written and bump `version` for nothing. The only database on ' +
        'which they do anything is one that ran `newsletter_init` before those components ' +
        'changed — and there the module that should be refreshing `newsletter`\'s system ' +
        'blocks is `newsletter`.\n\n' +
        '**The usual alternative seam is closed here, which is why this case earned R2 its ' +
        'own rule.** `transactional_emails` declares `activation: { nonDeactivatable: true }` ' +
        'and `newsletter` declares `activation: { settingCode: \'newsletter.enabled\' }`, so ' +
        'declaring the dependency would make `newsletter`\'s activation control a dead ' +
        'switch (AGENTS.md § *Composition* item 4a), and item 4a\'s own remedy — ' +
        '`nonBindingDependencies` kind `refuses-without` — is a runtime gate a migration has ' +
        'no caller to receive.\n\n' +
        'Retired by: feature 097 Phase 4, which removes the two statements from `up()` in ' +
        'place, without renaming the class and without adding a replacement migration.',
    },
};
