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
 * reaches into a module's admin code anyway. Nine files do it, all under
 * `admin/src/components`, and until P1 not one of them was in any instrument's
 * population: `check:module-boundary`'s admin half judges a reach between two modules,
 * and a file the module root does not hold is judged as nobody's.
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

/**
 * The four pickers, from their **own** side.
 *
 * `backend/scripts/ledgers/admin-surface.ts` records these components from the
 * *consumer's* side — 19 Group A keys, each a module screen importing a host picker — and
 * has done since Phase 1b. What it never recorded is the picker's own reach into the
 * module whose data it fetches, because that direction is this check's and this check was
 * not looking. So the two ledgers now describe the same coupling from both ends, which is
 * what makes a repair visible in both.
 */
const PICKER =
  'A host picker over another module’s data, reaching that module’s admin code from ' +
  '`admin/src/components`. Recorded from the consumer’s side in ' +
  '`backend/scripts/ledgers/admin-surface.ts` (Group A) since Phase 1b and from the ' +
  'picker’s own side only since P1 — publishing it into the kit would put module ' +
  'knowledge there and break R6, so the answer is a design one and not a `git mv`.';

/** P2's exit, in the plan's own words: rebuild the call, then move into the kit. */
const RETIRED_BY_P2 =
  'Retired by: **P2** (`plan.md` § *Phase 4*, *The publications owed*) — the picker ' +
  'rebuilds its call from the published `apiClient` and the contract’s own types and ' +
  'moves into `@endora-commerce/admin-kit`. The request and response shapes are already ' +
  'in `@endora-commerce/contracts`, which both sides compile; what is not published is ' +
  'the client module, and that is the whole of the reach.';

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

  'admin/src/components/asset-picker/AssetFieldPicker.tsx:assets_library/components/AssetPicker':
    `${PICKER}\n\n` +
    'This one is a **component** reach and not a client reach, which is why ' +
    '`plan.md` § *Phase 4* records that *"P2 does not cover `asset-picker`"*. There is no ' +
    'request to rebuild: the host renders `assets_library`’ own `AssetPicker`.\n\n' +
    'Retired by: **P4**, the zone mechanism — `registryZones()`, an `<AdminZone>` ' +
    'renderer, the visibility gate for a contributed component, and the two-way refusal ' +
    '`admin-contributions.ts` promises and nothing implements. Then `assets_library` ' +
    'contributes the picker and the host renders a slot.',

  'admin/src/components/asset-picker/AssetFieldPicker.tsx:assets_library/api/assets-library-client':
    `${PICKER}\n\n` +
    'The second half of the same file’s reach, and it is the ordinary client shape: the ' +
    'field picker resolves an asset id to its metadata through `assets_library`’ admin ' +
    'client.\n\n' +
    'Retired by: the **client exit** — rebuilt from the published `apiClient` and the ' +
    'assets contract. It is separable from the component reach above and can be paid ' +
    'first; the file stops reaching `assets_library` only when both are.',

  'admin/src/components/cms-picker/CmsBlockPicker.tsx:cms/api/cms-client':
    `${PICKER}\n\n${RETIRED_BY_P2}`,

  'admin/src/components/cms-picker/CmsPagePicker.tsx:cms/api/cms-client':
    `${PICKER}\n\n${RETIRED_BY_P2}`,

  'admin/src/components/organization-picker/OrganizationPicker.tsx:organizations/api/organizations-picker-client':
    `${PICKER}\n\n` +
    'A type-only reach: the picker names `OrganizationStatusPickerFilter`, which is ' +
    'declared in `admin/src` and published nowhere. `import type` is a violation on the ' +
    'same terms as a value import (FR-003) — a type edge is a real edge in a ' +
    '`package.json`, because types resolve at build time.\n\n' +
    `${RETIRED_BY_P2} P2 carries a Changesets \`minor\` on \`@endora-commerce/contracts\` ` +
    'for exactly this: `OrganizationPickerListItem` and `OrganizationStatusPickerFilter` ' +
    'have to be published before the four keys under this picker can go.',

  'admin/src/components/organization-picker/OrganizationPickerMulti.tsx:organizations/api/organizations-picker-client':
    `${PICKER}\n\n` +
    'Type-only, naming `OrganizationStatusPickerFilter` — see the entry for ' +
    '`OrganizationPicker.tsx`.\n\n' +
    RETIRED_BY_P2,

  'admin/src/components/organization-picker/OrganizationStatusBadge.tsx:organizations/api/organizations-picker-client':
    `${PICKER}\n\n` +
    'Type-only, naming `OrganizationStatusPickerFilter` — see the entry for ' +
    '`OrganizationPicker.tsx`.\n\n' +
    RETIRED_BY_P2,

  'admin/src/components/organization-picker/useOrganizationsQuery.ts:organizations/api/organizations-picker-client':
    `${PICKER}\n\n` +
    'The value half of the same picker: the query hook calls the client itself. It is the ' +
    'one file of the four that is a `.ts` rather than a `.tsx`, which is why the host walk ' +
    'collects both extensions — a `.ts`-only walk would have opened this file, found one ' +
    'reach, and reported over the other eight without saying so.\n\n' +
    RETIRED_BY_P2,

  'admin/src/components/sales-channel-picker/SalesChannelPicker.tsx:sales_channels/api/sales-channels-client':
    `${PICKER}\n\n` +
    'The same call batch three drained four times over — ' +
    '`salesChannelsClient.list({ activeOnly: false, pageSize: 100 })` — from the one ' +
    'consumer that was never in the ledger, because it is the host’s.\n\n' +
    RETIRED_BY_P2,
};
