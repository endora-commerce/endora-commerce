/**
 * Cross-module reaches still standing in the **admin application itself**
 * (feature 075, FR-022…FR-026; feature 091, FR-017 and P1).
 *
 * Keyed `<file>:<target module>/<target path>` for an import and
 * `<file>:sql:<owner>/<table>` for a raw statement or a query builder, so moving code
 * inside a file does not invalidate an entry. The file is spelled as `layout.keyOf`
 * spells it — repository-relative for an admin file, which has no `backend/src` of
 * the application's to be relative to.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * ## Why there is a shard for something that is not a module
 *
 * `host` is the admin application, the owner id `check:admin-registrations` already
 * attributes a route or a nav entry no module claims to. Every other shard here is a
 * consumer **module**; this one is the consumer that owns the platform's frontend and
 * reaches into a module's admin code anyway. Nine files did it when P1 seeded this
 * shard, all under `admin/src/components`, and until P1 not one of them was in any
 * instrument's population: `check:module-boundary`'s admin half judges a reach between
 * two modules, and a file the module root does not hold is judged as nobody's.
 *
 * **P2 retired seven of those ten keys and P4c the last two**, leaving one file and one
 * key. The three data-fetching pickers with no zone requirement — `sales-channel-picker`,
 * `cms-picker` and `organization-picker` — each rebuilt its request from the published
 * `apiClient` and the owner's contract types and moved into
 * `@endora-commerce/admin-kit`, which is the client exit named below and not a rewritten
 * specifier. `admin/src` keeps a re-export shim at each old path, so the reaches were
 * **repaired**, not relocated: a shim exports nothing but the package's own bindings and
 * reaches no module at all.
 *
 * `asset-picker` was recorded here as the picker the client exit could not answer,
 * because its module knowledge was a **component** (`assets_library`' `AssetPicker`) and
 * no URL replaces one. That reason was measured and found false:
 * `admin-component-contribution.md` Z1.1 read the component itself — 153 lines over one
 * `GET`, with every type already `@endora-commerce/contracts`' — so the cluster was the
 * same client exit one component deeper, and P4c took it. What is left is
 * `IdleLogout.tsx`, which is batch 11's.
 *
 * That is the shape with the *worse* failure mode, which is why P1 goes before the
 * batches rather than inside one.
 * `specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured
 * the backend precedent: rewriting a **ledgered** relative import as a package specifier
 * deletes the reach from the walk, whereupon the two-way ledger reports the entry
 * describing it as stale. For an **unrecorded** reach it is worse still — the import is
 * rewritten, the walk never saw it, and nothing goes red anywhere, because there was no
 * entry to strand. `admin/src/components/IdleLogout.tsx` is the standing example: it
 * takes `settings`' admin API client, `settings` is a batch-11 target, and the only
 * reason anybody knows about the reach is that somebody went looking for it
 * (`specs/091-module-owned-admin-surfaces/research.md` §6.6).
 *
 * ## What is deliberately not here
 *
 * `_shared/email-builder` — six reaches into it from `newsletter` and
 * `transactional_emails`, fifteen out of it into `cms`, `assets_library` and
 * `transactional_emails`. `_shared` sits **under** the admin module root and is claimed
 * by no nav entry, so it is the admin application's by the same derivation that makes
 * `home`, `platform` and `profile` so, and this check judges neither direction. That is
 * a decision and not an oversight: where the directory goes is an open owner question
 * (`cms`' package, or a fourth `page-builder`-family package —
 * `specs/091-module-owned-admin-surfaces/plan.md` § *Phase 4* P5), a ledger cannot answer
 * it, and attributing `_shared` to a module to make the walk produce findings would put a
 * false owner into an artefact three checks read.
 *
 * **What would bring it in** is the answer to that question. Once `_shared` has a home its
 * files are either a module's — in which case `adminModuleDirectories` attributes them and
 * both directions become ordinary findings, with no change to any check — or the kit's, in
 * which case the reaches are `check:admin-surface`'s and are not a boundary question at
 * all. Until then the 21 sites are in no ledger, and `research.md` §6.6 is where that is
 * written down.
 *
 * ## What retires an entry here
 *
 * Never the move and never a rewritten specifier. Three exits, and the reach picks one:
 * the caller rebuilds the request from the published `apiClient` and the owner's contract
 * types; the owner contributes the component to a zone (FR-007); or the piece turns out to
 * hold no module knowledge and is published in `@endora-commerce/admin-kit` (FR-006). A
 * bare specifier into the owner's `./admin` subpath is none of the three — that subpath
 * exports the contributions object and nothing else
 * (`specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md` R2).
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'admin/src/components/IdleLogout.tsx:settings/api/settings-client':
    'The admin’s idle-logout timer reads `admin.idle_logout_minutes` through `settings`’ ' +
    'own admin API client. It is not a picker and it is in no other ledger: ' +
    '`check:admin-surface` skips a target under the admin module root outright, on the ' +
    'ground that such a reach is `check:module-boundary`’s — which for a *host* source it ' +
    'was not, until P1. `research.md` §6.6 found it by looking, and it is the one reach in ' +
    'this shard that nobody had named.\n\n' +
    'Retired by: the **client exit**, in place — the host builds the setting read from the ' +
    'published `apiClient` and the settings contract, which both sides already compile. ' +
    'Neither endpoint has to move for that, and batch 11 (`settings`) must not move its ' +
    'admin directory while this entry stands: the specifier would be rewritten into ' +
    '`@endora-commerce/mod-settings/…`, this key would go stale, and the coupling would ' +
    'read as supported rather than as paid.',
};
