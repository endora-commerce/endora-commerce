/**
 * Cross-module reaches still standing in `admin_actions` (feature 075,
 * FR-022…FR-026; feature 077, D-87; issue #187).
 *
 * Keyed `<path under src/>:<target module>/<target path>` for an import and
 * `<path under src/>:sql:<owner>/<table>` for a raw statement or a query builder, so
 * moving code inside a file does not invalidate an entry and re-opening a hole does not
 * silently inherit one.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * The shard exists because of issue #187: the reach below is a knex `join`, which names
 * its table as a call argument, so neither the import predicate nor D-87's statement path
 * could see it. It is not a new coupling — it is a coupling the check could not see.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/admin_actions/services/admin-actions-service.ts:sql:kernel/module_registrations':
    'Issue #187 seed — the palette query joins the kernel\'s `module_registrations` table ' +
    'to keep actions whose module is not installed out of the result, and it does so with ' +
    'a knex `.join(\'module_registrations as r\', …)`. The builder names the table as an ' +
    'argument, so the reach compiles and returns rows while naming no import specifier and ' +
    'no SQL statement.\n\n' +
    '**The owner is the platform, not a module** (measured for the T077 SQL sweep). ' +
    '`module_registrations` is declared by ' +
    '`packages/platform/src/kernel/lifecycle/module-registration.entity.ts`, which is the ' +
    'host package. This check reports the reach because its SQL predicate deliberately spans ' +
    'kernel-owned tables — its own header says five of the tables it resolves are the ' +
    'kernel\'s — and it is right to. But the remedy is a platform-surface question and not a ' +
    'port, and **there is nothing to publish**: `effectiveState` has been on the kernel ' +
    'barrel since the platform relocation, and this module already reads both of its axes ' +
    'through the `modulePresenceProbe` both composition roots contribute from it. The ' +
    'platform axis is the one field that probe does not carry. So the cut is not "publish a ' +
    'seam, swap a specifier" — it is one more field on an interface this module declares ' +
    'itself, the two root contributions that build it, and a decision. D-174 is the ' +
    'precedent: this module\'s *other* platform reach retired with no new published symbol ' +
    'either.\n\n' +
    '**What the cut buys is a live disagreement, not tidiness.** The palette resolves the ' +
    'platform axis in SQL, freshly per rebuild; every route gate resolves it from the ' +
    'registry cache. Between a state change and the `refreshFromDb` that follows it the two ' +
    'disagree in both directions — the palette advertises an action whose route answers 503, ' +
    'and hides one the route would serve. That is issue #225\'s defect on the other axis, and ' +
    'it cannot be closed while the two axes come from two sources.\n\n' +
    'Two facts the seed did not have, measured while draining the `customers`, ' +
    '`organizations`, `admin_users`, `admin_actions` and `api_keys` shards.\n\n' +
    '(1) **This join is the one presence gate `withModuleOff` cannot move.** That helper ' +
    'flips `registryCache.__setEnabledForTesting` and touches neither Redis nor the ' +
    'database (`test/helpers/off-state.ts`, and deliberately — 555 files boot a server in ' +
    'one fork), so a `platform-unavailable` flip is invisible to a read that goes to SQL ' +
    'for the platform axis. Every other surface in the tree answers the same question out ' +
    'of `effectiveState`; the palette answers it out of a table.\n\n' +
    '(2) **The cut is a behaviour change six test files encode as the contract, not a ' +
    'specifier swap.** The seed counted four; re-counted for T077 it is six — ' +
    '`operator-visibility`, `seeded-set`, `i18n-resolution`, `state-change-invalidation`, ' +
    '`presence-refresh-window` and `http-admin-actions` each insert `module_registrations` ' +
    'rows and assert the palette against them without warming the cache. And ' +
    '`presence-refresh-window.integration.test.ts` exists *because* the two axes come from ' +
    'different sources with different timing — it measures the window between an ' +
    'in-memory activation read and an asynchronous `refreshFromDb`, which is issue #225\'s ' +
    'repair. Unifying both axes onto `effectiveState.isPresent` deletes that window rather ' +
    'than closing it.\n\n' +
    'Retired by: filtering the actions against the kernel\'s effective-state combiner — the ' +
    'in-memory answer every other gate already uses — taken together with a decision on ' +
    'what issue #225\'s refresh window means once the platform axis stops being read ' +
    'freshly per call. That is this module\'s owner\'s call, not a boundary sweep\'s.',
};
