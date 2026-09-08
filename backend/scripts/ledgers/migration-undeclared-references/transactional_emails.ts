/**
 * R1 — the migration whose reading produced this feature (feature 097,
 * `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` §4.1).
 *
 * Keyed `<file>:<table>`, two-way, and **this shard is expected to go**: the
 * repair is Phase 4 of the feature's own plan, which removes the two statements
 * from `up()` in place.
 *
 * It is recorded rather than repaired here because the plan's handoff says so in
 * as many words — the rule is worth something without the repair, the repair is
 * worth nothing without the rule, and Phase 4 must not precede Phases 1-3 or the
 * finding it repairs is unwitnessed. This file is that witness.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/transactional_emails/src/migrations/20260801T111001_transactional_emails_email_defaults_reseed.ts:newsletter_email_blocks':
    {
      sites: 2,
      reason:
        'The reseed refreshes two system e-mail blocks — the header and the footer — that ' +
        '`newsletter` owns, with two `UPDATE`s against `newsletter_email_blocks`.\n\n' +
        '**No manifest line can make this legal**, which is the reason R2 exists as a rule ' +
        'distinct from R1 and the reason this entry is not simply "add the dependency". ' +
        '`transactional_emails` declares `activation: { nonDeactivatable: true }` and ' +
        '`newsletter` declares `activation: { settingCode: \'newsletter.enabled\' }`, so ' +
        'naming `newsletter` in this module\'s `dependencies` would make `newsletter`\'s ' +
        'activation control a dead switch: the orchestrator refuses a disable with live ' +
        'dependents (`dependents-block`, `backend/src/lifecycle/scripts/disable.ts`), and a ' +
        '`--cascade` would have to disable a module that refuses. AGENTS.md ' +
        '§ *Composition* item 4a names that case exactly, and its remedy — ' +
        '`nonBindingDependencies` kind `refuses-without` — is a **runtime** gate answering ' +
        'a 503, which a migration has no port, no request and no caller to receive.\n\n' +
        '**The write is a no-op on every fresh database.** `newsletter`\'s own ' +
        '`20260629T200954_newsletter_init.ts` seeds those two blocks from the identical ' +
        '`envelopeFromTree(defaultHeaderTree(), DEFAULT_LANGUAGES)` call against the same ' +
        '`@endora-commerce/email-components` defaults, so on `db:fresh` these statements ' +
        'write bytes `newsletter` has already written and bump `version` for nothing. On a ' +
        'database that ran `newsletter_init` before those components changed, the module ' +
        'that should be refreshing `newsletter`\'s system blocks is `newsletter`.\n\n' +
        '**And it works today by the alphabet.** Neither module declares the other, so the ' +
        'topological sort has no edge between them and falls through to its lexicographic ' +
        'tie-break (`@endora-commerce/platform/db`); `newsletter` sorts before ' +
        '`transactional_emails`, so the table exists when the `UPDATE` runs. Rename either ' +
        'module and a fresh install aborts on `relation "newsletter_email_blocks" does not ' +
        'exist` — inside the install of a module the platform refuses to run without.\n\n' +
        'Retired by: feature 097 Phase 4, which removes the two statements from `up()` in ' +
        'place. The class is applied on running databases and must not be renamed, and no ' +
        'replacement migration is added: the existing-database refresh is `newsletter`\'s to ' +
        'ship if and when it wants it, in a `newsletter`-owned migration that needs no ' +
        'cross-module edge at all.',
    },
};
