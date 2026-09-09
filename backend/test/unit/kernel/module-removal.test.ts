import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODULES } from '../../../src/composition.generated.js';
import { EventBus } from '../../../src/events/bus.js';
import { ApiInterceptorRegistry } from '../../../src/http/interceptors/index.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { ALL_ENTITIES } from '../../../src/db/entities-registry.generated.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import { BASELINE_MIGRATIONS } from '@endora-commerce/platform/migrations';
import { orderMigrations, type MigrationRegistryEntry } from '@endora-commerce/platform/db';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';
import { platformResidentModuleRoots } from '../../../scripts/lib/module-roots.js';
import { platformSourceRootAt } from '../../../scripts/lib/platform-root.js';
import {
  REGISTERED_MANIFESTS,
  type RegisteredManifestEntry,
} from '../../../src/lifecycle/registered-manifests.js';
import { listAssignablePermissionCodes } from '../../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';
import {
  declaredEntityNamesFor,
  registeredEntityNamesFor,
} from '../../helpers/entity-registry.js';

/**
 * Removing a module leaves nothing behind (feature 072, US4 / T055).
 *
 * This is the property `composition.ts` structurally cannot have. A 3144-line
 * composition root imports every module by name, so "delete the folder" is a
 * compile error in a file the module does not own, and finding the rest of the
 * residue — an entity in the ORM registry, a migration in the registry, a
 * permission in the catalogue — is archaeology. When the composer is generated
 * from a filesystem walk, removing a module is deleting its directory.
 *
 * The subject is `health_checks`: the composer owns it (it is one of the three
 * converted modules), it has fan-out 0, it owns no entity and no migration, and
 * nothing outside its directory names it. `email` is the other fan-out-0
 * candidate and is deliberately **not** the subject — see the residue ledger
 * below, which records exactly why it is not removable yet.
 *
 * What "removal" means here is a deletion of `src/modules/<id>/`, followed by a
 * regeneration. So the generated artefacts are excluded from the residue scan
 * (they are a function of the tree and would lose the module by construction),
 * and everything else is not.
 *
 * **Why this is a unit test** (feature 112, FR-004). It sat under
 * `test/integration/kernel/` until 2026-09-05 and was never an integration
 * test: Constitution III *defines* that tree as the one that exercises "the
 * real database and the real module boundary (no mocking the DB)", and this
 * file opens no connection to Postgres, Redis or Meilisearch. It composes the
 * generated list in memory and reads the tree off disk — one composition,
 * asserted over its own registrations, which is III(a). Not one assertion
 * changed with the move. What changed is that a reader of `test/integration/`
 * is no longer told this file needs a database, and that the fast,
 * service-less job runs it on every merge request rather than only on
 * `master`. The criterion is
 * `specs/112-test-tree-membership/contracts/test-tree-membership.md`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../../../src');

const SUBJECT = 'health_checks';

/**
 * Converted modules that are **not** removable yet, and the reference that
 * holds them. This is a ledger, not an allow-list: each entry names a real
 * residue that its owner's conversion has to clear, and the test fails both
 * when an entry becomes stale and when a new one appears.
 *
 * `audit_logs` (wave 1, T084) was the second module to be **absent from this
 * ledger entirely**, and the first that got there by being disentangled rather
 * than by having been simple all along. Before its conversion it was not even a
 * candidate: `admin_users/plugin.ts` imported both its route files and
 * constructed its service. It owns no entity (`AuditLogEntry` moved to the
 * kernel in T016) and no migration, so neither central registry named it, and
 * the `auditActorResolver` a root contributes is a closure over `admin_users`'
 * own service — it imports nothing from `audit_logs`. Deleting the directory
 * really was all there was to it.
 *
 * That used to be the exceptional shape, reached by three modules out of 65,
 * because two central lists named everything with an entity or a migration.
 * Feature 071's F2 generates both, so it is now the *ordinary* shape: 34 of the
 * 65 modules are absent below. What is left is references from a composition
 * root, which F3 and F4 drain.
 *
 * The figure was 36 until feature 075 moved the catalogue dev seed to
 * `src/seeds/`. That move added no coupling — see the `src/seeds/` block
 * below — it made twelve couplings visible to a scan whose substring needle had
 * been missing them, and a ledger that grows for that reason is the ledger
 * working.
 */
const RESIDUE_LEDGER: Readonly<Record<string, readonly string[]>> = {
  // ── T040b's batches drain this ledger, and a moved module's entry is stale ─
  //
  // Ten entries were deleted together on 2026-08-25, after batches two and
  // three: `delivery_methods`, `mfa`, `taxes`, `comparisons`, `pwa`, `returns`,
  // `ksef`, `newsletter`, `sales_channels`, `shopping_lists`. Each is a package
  // now, so a root naming it writes a bare specifier, and a bare specifier into
  // a package is not a reference into `backend/src/modules/` — the same reason
  // the `payment_methods` note below gives.
  //
  // **They were deleted late, and the reason is worth more than the entries.**
  // This ledger is two-way, so a moved module reds this file the moment its
  // last reference goes — and a packaging batch's targeted run covers the paths
  // it *touched*. This file is not one of them: it is derived *about* the
  // modules a batch moves, never edited by moving them. So the batch that frees
  // an entry is structurally the batch that cannot see it go stale. Three
  // batches, three reds on `master`, each found by the next piece of work
  // rather than by the one that caused it.
  //
  // It used to say *"it lives in `test/integration/`, which `test:unit:fast`
  // does not run"*, which was the mechanism at the time and stopped being true
  // when feature 112's FR-004 moved this file to `test/unit/kernel/`. The
  // failure mode survived the move intact, which is the point: the fast suite
  // now runs this file on every merge request and a batch still has to *choose*
  // to run it, because nothing in the diff points here.
  //
  // If you are moving a module: this file is part of the move. Re-derive the
  // ledger against `backend/src` and delete what no longer has a reference,
  // in the same merge request.
  // ── What feature 071's F2 drained ─────────────────────────────────────────
  //
  // This ledger had 61 entries, and 55 of them named `entities-registry.ts`,
  // `migrations-registry.ts` or both. They were recorded as *structural*
  // residue — explicit core-owned lists a converted module names by design —
  // and the note above `blog` called the entity one "the last structural hole
  // in US4". Both are generated from a filesystem walk now, so they are
  // excluded from the scan for the same reason every other generated artefact
  // is: deleting a module's directory and regenerating removes the reference.
  //
  // The result is that most modules are removable by deleting the directory,
  // against four before — **how many is not written here**, because the ledger
  // below is what says it and the two numbers that used to stand in this
  // sentence went stale in every batch that drained an entry (D-100). The
  // ledger's own size answers it. Everything in it is a reference from a
  // composition root, which is the residue shape F3 and F4 are scoped to
  // finish — no central list holds a module any more.
  //
  // ── `src/seeds/` — twelve entries, and feature 113 answered all of them ───
  //
  // T211 split the one 887-line file the twelve named; every batch of Phase 2
  // then moved one module's demo block into that module's own
  // `src/backend/demo/` and *froze* a verbatim copy of it, because the parity
  // comparison that judged each batch could only see one while its two sides
  // were different code. So batch after batch re-pointed entries and freed
  // none — recorded here at the time, each in place.
  //
  // **T226 is where they came due.** The frozen copy and the legacy entry
  // point are deleted, and with them `delivery_methods`, `payment_methods` and
  // `taxes` leave this ledger outright while five more lose their second
  // entry. What survives is `src/seeds/demo-composition.ts`, this instance's
  // demo composition, and `src/seeds/attribute-fixtures.ts`, the single copy of
  // the attribute helper (FR-019). Neither is expected to drain: a composition
  // naming modules is a composition root doing its job, and this file records
  // it rather than objecting to it.
  //
  // Feature 075 moved the dev seed and `attribute-fixtures.ts` out of
  // `src/modules/catalog/seeds/` and into `src/seeds/`, beside `composition.ts`.
  // The seed wrote megamenus, organisations, customer accounts, admin users and
  // roles, delivery methods, payment methods, taxes, a default price list,
  // warehouses and stock: two of the twelve modules it named were `catalog`, so
  // it was a composition of the platform's demo data and belonged where a
  // composition root belongs.
  //
  // **The lines it added were not new residue.** The seed named all twelve
  // modules before the move too, and this scan missed every one of them: its
  // needle is the substring `modules/<id>/`, and from inside
  // `src/modules/catalog/seeds/` the specifier read `../../megamenu/entities/…`
  // — module-relative, so no `modules/` segment to match. That is the same
  // normalisation bug feature 075's FR-004 records as having produced a 2.2×
  // undercount elsewhere. The move did not create the coupling; it made the
  // coupling addressable, which is the only way it ever gets paid off — and
  // feature 113 is what paid it.
  //
  // `catalog` (wave 4, T142), now two entries rather than three (feature 080,
  // T040b). **`src/composition.ts` is gone and is a real retirement**: its one
  // reference was `import type { CatalogQueryService }` from a path inside the
  // module's directory, and the module is a package, so the root type-imports it
  // from `@endora-commerce/mod-catalog/backend` — the same door it already uses
  // for nine other packaged modules' interfaces. A bare specifier into a package
  // is not a reference into `backend/src/modules/`, so deleting the directory
  // breaks nothing there. The five contributions the root supplies — the
  // bulk-operation worker flag, the admin audit actor shape, availability bands,
  // the image placeholder, and the Meilisearch reindex production runs and the
  // harness must not — are container names and were never what held the entry.
  //
  // **The two seed files stay, and for criterion 7's reason** (the block below,
  // verbatim): the dev seed constructs `Product`, `Category` and
  // `AttributeSetAttribute`, and `attribute-fixtures.ts` constructs
  // `ProductAttribute`. A module package publishes an `entities` array and no
  // named class (D-168), so each is taken off that array by name — and needs a
  // row type to be taken precisely, which for this module matters more than
  // anywhere else: the array holds **eighteen** classes, so the union `find`
  // returns collapses to a constructor that is almost certainly not the one
  // asked for. The row type is an `import type` of the declaration inside the
  // package's built artefact, whose `packages/modules/catalog/dist/…` path
  // carries the `modules/catalog/` substring this scan reads. So the reference
  // is real — deleting the package breaks the **build** — and it is not runtime
  // coupling, because the type imports erase.
  //
  // **T224 re-pointed a third entry, T226 freed it.** The whole catalogue
  // block — the tree, the 200 products, the composites and their structure —
  // is `catalog`'s own demo data now, and the frozen copy the parity
  // comparison read it against is deleted with the comparison. What remains
  // are the two entries that are not residue at all: `attribute-fixtures.ts`,
  // the single copy of the attribute helper (FR-019), and the composition,
  // which names `Product`, `Category` and `AttributeSetAttribute` to write the
  // attributes, the images and the attachments — three blocks that became
  // composition steps with T224 because each writes two modules' rows at once.
  catalog: ['src/seeds/attribute-fixtures.ts', 'src/seeds/demo-composition.ts'],
  // The three modules the dev seed holds and nothing else does. Each is a plain
  // entity import in the seed — a warehouse, a stock level, a delivery method,
  // and the custom-field definition half of a product attribute.
  //
  // **`payment_methods` was the fourth and is gone** (feature 080, T040b): it is
  // a package now, so the seed takes `PaymentMethod` off the published
  // `entities` array by a bare specifier rather than by a relative path into the
  // module's directory. That is the residue this ledger exists to watch drain,
  // draining — the entry is deleted rather than re-pointed, because a bare
  // specifier into a package is not a reference into `backend/src/modules/`.
  // `custom_fields` **keeps** its entry, and the reason is criterion 7's rather
  // than a conversion left undone (T040b, batch four). The module is a package,
  // so `attribute-fixtures.ts` takes both classes off the published `entities`
  // array by a bare specifier — and needs a row type to do it precisely, which is
  // a caller-supplied `import type` of the declaration inside the package's built
  // artefact. `packages/modules/custom_fields/dist/backend/entities/…` carries the
  // same `modules/custom_fields/` substring this scan reads, so the reference is
  // real: deleting the package breaks the **build**. It is not runtime coupling —
  // the type imports erase — and it retires on the same condition as the
  // `delivery_methods` / `payment_methods` / `taxes` block below.
  // **T224 added the second entry**, and it is a conversion arriving rather than
  // a residue growing: a product attribute is a `custom_field_definitions` row
  // paired to one of `catalog`'s extension rows in one call, so it is a
  // composition step (contract §5.1) and the composition is where it now lives.
  // `demo-composition.ts` calls `attribute-fixtures.ts` — the one copy of that
  // helper, FR-019 — and the substring this scan reads comes in through the row
  // type that helper's own file already names. Both entries retire together,
  // with the test kit (`specs/109-backend-test-kit/`).
  custom_fields: ['src/seeds/attribute-fixtures.ts', 'src/seeds/demo-composition.ts'],
  // `inventory` moved with T223 and was re-pointed rather than freed; T226
  // freed the re-pointed half with the reference file. What is left is the
  // composition spreading stock across the warehouse this module's demo body
  // creates — the composition doing its job, and not expected to drain at all.
  inventory: ['src/seeds/demo-composition.ts'],
  // ── Criterion 7's cost, and it is a cost of a decision rather than a defect ─
  //
  // The three entries below came back on 2026-08-25 with !997, and the comment
  // above them — which said `payment_methods` needs no entry because the seed
  // names a **bare** specifier — stopped being true in the same merge request.
  // It is corrected here rather than deleted, because the reason it gave was
  // right for the shape it described.
  //
  // A module package publishes `entities` as an array and **no named entity
  // class** (D-168), so a host program that must *construct* one picks it out
  // by name — and needs a row type to do it precisely, because `find` over a
  // heterogeneous array returns a union `em.create` collapses to the first
  // member. That row type is a caller-supplied `import type` of the entity's
  // declaration **inside the built artefact**, and `dist` is not a preference:
  // `backend/tsconfig.build.json` sets `rootDir`, and a `.ts` outside it is
  // TS6059 **even for a type-only import**, because such an import still joins
  // the program. A `.d.ts` is exempt. A bare specifier is unavailable because
  // no `exports` subpath declares a deep entity path, and declaring one would
  // publish the class D-168 exists to keep unpublished.
  //
  // So these are references, and they are ledgered rather than argued away:
  // deleting one of these packages breaks the **build**. What they are not is
  // runtime coupling — the imports erase, and `grep -c 'packages/modules'` over
  // the composition's compiled output is **0**, measured. They retire when the
  // composition stops needing to construct entities at all, which is the same
  // condition the `src/seeds/` block above already names.
  // `credit_limits` joined on 2026-08-25 with !1021, and for a reason worth
  // keeping: seeding the `credit_limit` payment method alone would have added
  // an option no seeded buyer could ever see, because checkout filters the
  // method on a granted limit against the cart total. The seed therefore
  // grants one too, which is what puts this module here.
  //
  // **Feature 113's T222 re-pointed this entry, T226 freed the re-pointed
  // half.** A moved demo block was *frozen* rather than deleted while the
  // parity comparison existed, because that comparison could only see a batch
  // while its two sides were different code; T226 deletes both the frozen copy
  // and the comparison, and what is left here is `demo-composition.ts`, which
  // holds the two **links** the host block used to write inline: which
  // administrator holds which role, and the credit limit granted to the demo
  // organisation. Both are two modules' rows in one statement, so both are
  // composition steps (contract §5.1), and the composition names the entity
  // classes to write them. That is the composition doing its job and is not
  // expected to drain at all.
  credit_limits: ['src/seeds/demo-composition.ts'],
  // ── `delivery_methods`, `payment_methods` and `taxes` are **gone** ────────
  //
  // Three entries deleted rather than re-pointed, and they are the first this
  // feature has freed outright. T220 moved those three modules' demo rows into
  // their own `src/backend/demo/` and predicted the entries would go; they did
  // not, because a moved block was *frozen* verbatim in
  // `src/seeds/demo-relocated-reference.ts` so that the parity comparison —
  // which diffs two seeded databases and can therefore only see a batch while
  // its two sides are different code — kept working. The entity type imports
  // that held these entries went with the frozen copy.
  //
  // T226 deletes the frozen copy and the legacy entry point, so nothing under
  // `backend/src/` names these three packages any more. **Nothing in this file
  // could have said so**: moving a module's demo block does not edit this
  // ledger, so the batch that frees an entry is structurally the batch that
  // cannot see it go stale — which is why every batch of this feature re-runs
  // it, and why this one found three.
  // `orders` needs no entry and gets none, since feature 080's T052. Its single
  // reference was `import { Order } from './modules/orders/entities/order.entity.js'`,
  // read by one `em.findOne` inside a bridge the root contributes; D-168 gives a
  // packaged module one `entities` export and no named class, so the root
  // resolves `orderReadPort` off the container instead. A container name is not
  // an import, which is exactly why the retirement is real: deleting the
  // directory now breaks no file outside it.
  //
  // The entry that stood here said the reference was the sales-rep admin scope
  // and would drain "when `auth`'s actor resolution unifies". That was never
  // what held it, and the prediction is retired with the entry rather than
  // carried forward — see `admin_roles` below, which lost the same reference in
  // the same commit and had the same wrong reason recorded.
  //
  // `organizations` (wave 4, T138). The dev seed type-imports the `Organization`
  // row, and that is all that is left. There used to be another entry: the
  // kernel type-imported the entity to declare `OrganizationReadPort`, recorded
  // here as "meant to be permanent". D-55 dissolved it — the port now declares a
  // structural `OrganizationSnapshot` over `@endora-commerce/contracts`' status
  // union, and the entity stays in this module. The kernel owning the shape
  // never required it to own the class.
  //
  // **`src/composition.ts` was here and was stale on `master`** (found while
  // packaging `auth`, T040b). The root type-imports `OrganizationTreeService`
  // and `OrganizationTaxProfilePort` from
  // `@endora-commerce/mod-organizations/backend`, and this scan asks whether a
  // specifier contains `modules/<id>/`, which a bare specifier does not. So the
  // entry drained when that module was packaged and nothing in that merge
  // request read this file — the standing shape of this ledger's failures, and
  // the reason the entry is recorded as corrected rather than quietly deleted.
  //
  // **Feature 113's T222 re-pointed this entry, T226 freed the re-pointed
  // half.** A moved demo block was *frozen* verbatim while the parity
  // comparison existed, because that comparison could only see a batch while
  // its two sides were different code; T226 deletes the frozen copy and the
  // comparison together. What is left is `demo-composition.ts`, which holds the
  // two **links** the host block used to write inline: which administrator
  // holds which role, and the credit limit granted to the demo organisation.
  // Both are two modules' rows in one statement, so both are composition steps
  // (contract §5.1), and the composition names the entity classes to write
  // them. That is the composition doing its job and is not expected to drain.
  organizations: ['src/seeds/demo-composition.ts'],

  // `composition.ts` reaches into `email` once: for the `EmailCradle` type it
  // resolves the mailer with. It disappears when the mailer's consumers resolve
  // it themselves.
  //
  // There was a second reach, `absolutizePublicUrl`, and it was a **value**
  // import — the shape that stops having a spelling once the owner is a package
  // (D-160.6.1). Feature 080's T040b moved the function to the platform rather
  // than converting the call: it had no consumer inside `email` at all, so it
  // was a deployment-origin helper filed under the module that first needed it.
  //
  // **`email` is now absent, and so are `assets_library`, `carts` and
  // `invoices`** (T040b, batch four). All four held exactly one reach —
  // `src/composition.ts`, for a cradle or bridge **type** — and all four are
  // packages now, so the root writes `@endora-commerce/mod-<id>/backend`. A bare
  // specifier into a package is not a reference into `backend/src/modules/`,
  // which is the same reason the `payment_methods` note above gives. The entries
  // are deleted rather than re-pointed.
  // **`auth` is absent too** (T040b), and it is the one case where the value
  // import was the *blocker* rather than a consequence. `composition.ts`
  // imported `promoteAdminActor` from `./modules/auth/plugin.js` — a file
  // inside the module — so packaging `auth` would have left the root evaluating
  // the package's source a second time (D-160.6.1). Unlike
  // `absolutizePublicUrl`, the function could not move to the platform: `auth`
  // reads it itself, and promotion is about two request decorations `auth`
  // owns. It is published from `./backend` instead, so the root's reach is a
  // bare specifier and no longer a reference into `backend/src/modules/`.
  //
  // The further step is still open and is recorded where it belongs, in
  // `test/contract/kernel/harness-parity.test.ts`'s `auth:promoteAdminActor`
  // entry: actor promotion published as a port, resolved from the container.
  // `admin_roles` (wave 1). The dev seed writes roles like it writes everything
  // else, and that is all that is left.
  //
  // `composition.ts` was here until feature 080's T052 and the recorded reason
  // was wrong: it read "imports its service types to annotate what it resolves
  // out of the container", and the reference was in fact
  // `import { AdminRole } from './modules/admin_roles/entities/admin-role.entity.js'`,
  // a value import backing two `em.findOne` calls in a bridge. T052 replaced
  // both with `adminRolePort`, so the annotation the entry predicted would
  // retire it was never the thing holding it. Recorded here rather than quietly
  // deleted, because a reason nobody can check is how a ledger stops being
  // evidence.
  //
  // **Feature 113's T222 re-pointed this entry, T226 freed the re-pointed
  // half.** A moved demo block was *frozen* verbatim while the parity
  // comparison existed, because that comparison could only see a batch while
  // its two sides were different code; T226 deletes the frozen copy and the
  // comparison together. What is left is `demo-composition.ts`, which holds the
  // two **links** the host block used to write inline: which administrator
  // holds which role, and the credit limit granted to the demo organisation.
  // Both are two modules' rows in one statement, so both are composition steps
  // (contract §5.1), and the composition names the entity classes to write
  // them. That is the composition doing its job and is not expected to drain.
  admin_roles: ['src/seeds/demo-composition.ts'],
  // `prompt_actions` (wave 1) — the inverted case, and the reason this ledger is
  // worth keeping. Its `composition.ts` reference was never a leftover of the
  // conversion: three *other* modules contributed into the registry it owns, and
  // the root imported `PromptActionTool` and `PromptActionToolRegistry` to type
  // that. D-44 moved every one of those pushes into the contributing module's
  // own boot hook, and both type imports went with them, so the entry is gone.
  //
  // The one root contribution that survived D-44 is gone too, under D-72 point
  // 4: the bulk-progress reader was written over a single name this module
  // *defaulted* rather than a registry, which is the one thing a module may not
  // push into. The host keeps `promptActionBulkProgressRegistry` now, so
  // `catalog` pushes from its own boot hook and no root imports
  // `catalog/prompt-tools.js` either.
  // `customer_accounts` (wave 1, T094). The dev seed type-imports the account
  // row; that is what is left.
  //
  // `src/composition.ts` was here and was **stale on `master`** — see the note
  // on `organizations` above. The root still imports the cradle type to
  // annotate the services it resolves and hands to `customers` and
  // `organizations`; what changed is that the specifier is now
  // `@endora-commerce/mod-customer-accounts/backend`, which contains no
  // `modules/<id>/`. The residue this entry described is real and is measured by
  // `harness-parity.test.ts`'s value-import ledger, which counts declarations
  // rather than substrings.
  customer_accounts: ['src/seeds/demo-composition.ts'],
  // `assets_library` (wave 1, T092). `composition.ts` imports the cradle type
  // to annotate the handle it resolves and hands the `catalog`, `cms` and
  // `megamenu` reference resolvers to. Contributing those is a root's job —
  // which modules a deployment ships is not this module's business — so that
  // one stays.
  // `_i18n`'s entry (wave 1, T089) was deleted here by T040b, which packaged the
  // module: `composition.ts` still imports the cradle type and the routing map
  // D-54 makes it inject into the error envelope (a `buildErrorTranslationTargets`
  // call since feature 090's Phase 4, a static table before it), and both arrive
  // by bare specifier — which is not a reference into `backend/src/modules/`,
  // the same reason every other packaged module's entry went. What the entry
  // recorded is unchanged and still true: that map used to
  // be imported by `src/http/error-envelope.ts` itself, which made a
  // kernel-obeying platform peer name a module (D-52) and put the cycle
  // `kernel → http → mod-i18n → kernel` in F4's package graph. A root naming a
  // module is ordinary; a peer doing it is the defect.
  // `megamenu` (wave 2, T107). The dev seed type-imports three rows.
  //
  // `src/composition.ts` was here and was **stale on `master`**, the third of
  // three found together — see `organizations` above. The root still imports the
  // cradle type plus the two dependency-bundle types, because the bundles
  // themselves stay in the root: they are existence checks and URL lookups
  // against `catalog`, `cms` and `assets_library` tables, and moving them into
  // the module would give it direct reads of another module's storage. Those
  // references are a root's by design rather than a leftover, so they are the
  // one entry here that was never going to drain — and packaging re-spelled it
  // out of this scan's reach anyway, which is exactly why a substring ledger
  // cannot be the record of a design decision.
  megamenu: ['src/seeds/demo-composition.ts'],
  // `invoices` (wave 2, T113). `composition.ts` imports the bridge type to
  // annotate what it contributes. The cradle import went with T143c: it existed
  // to reach `invoiceNumberGenerator` for a `CorrectiveInvoiceProvider` the root
  // built, and that adapter is `correctiveInvoicePort` now — which is also what
  // ended the two roots numbering corrections out of two different counters.
  // `admin_users` (wave 2, T121). Both roots contribute the late-bound MFA
  // getter and the `auditActorResolver` adapter that `audit_logs` owns the name
  // for. The second is a root's by design — see `audit_logs/backend.ts` — and
  // the first goes when a deployment stops needing to say which module supplies
  // MFA.
  //
  // **`src/composition.ts` left with T040b's fifth batch.** The reach was the
  // `AdminUsersCradle` **type**, and this module is a package now, so the root
  // writes `@endora-commerce/mod-admin-users/backend` — a bare specifier into a
  // package is not a reference into `backend/src/modules/`, the same reason the
  // `payment_methods` note above gives. The recorded reason above was right and
  // was about the *other* half: the two contributions both roots make survive
  // the move untouched, and they are `check:port-dependencies`' subject rather
  // than this one. The seed entry stays: it constructs `AdminUser`, so it names
  // the row type inside this package's built artefact, which carries the
  // `modules/admin_users/` substring this scan reads.
  //
  // **Feature 113's T222 re-pointed this entry, T226 freed the re-pointed
  // half.** A moved demo block was *frozen* verbatim while the parity
  // comparison existed, because that comparison could only see a batch while
  // its two sides were different code; T226 deletes the frozen copy and the
  // comparison together. What is left is `demo-composition.ts`, which holds the
  // two **links** the host block used to write inline: which administrator
  // holds which role, and the credit limit granted to the demo organisation.
  // Both are two modules' rows in one statement, so both are composition steps
  // (contract §5.1), and the composition names the entity classes to write
  // them. That is the composition doing its job and is not expected to drain.
  admin_users: ['src/seeds/demo-composition.ts'],
  // `settings` needs no entry and gets none, since feature 080's T040b — this
  // module is now **absent** from the ledger, which is the strongest state a
  // key can reach.
  //
  // The entry that stood here recorded a different reference from the one that
  // actually held it, which is worth naming rather than quietly deleting. It
  // read "both roots compose the kernel reader through `composeSettingsKernel`
  // and register the two deployment properties the admin surface needs"; that
  // is true and is not a reference into `src/modules/settings/` at all —
  // `composeSettingsKernel` is `src/kernel/settings/compose.ts`, a sibling of
  // the reader, and it has been for as long as this entry has. What the scan
  // was seeing was `collectRegisteredSettingsManifests`, a **value** import of
  // the module's own source, which T040b replaced with the published
  // `settingsManifestCollectionPort`. So a reason that was individually true
  // stood in for a reference it did not describe, and the drain is what
  // surfaced it — the same failure mode as `orders` and `admin_roles` above.
  // `_lifecycle` (wave 2, T125). It was the longest entry here until D-37 A1
  // moved the presence machinery into `src/kernel/lifecycle/`: the entity left
  // the module and the two kernel files — which held the gating wrappers this
  // module used to own — now import a sibling rather than a module. What is
  // left is the boot half `composition.ts` composes (the first-boot reconciler,
  // the registry-cache warm, the worker resume, the orchestrator and the
  // activation propagation) and the manifest index the migration order is
  // built from — which issue #289 moved out of `mikro-orm.config.ts` into
  // `configured-migrations.ts`, so that the ordering could be computed without
  // importing a config that captures `DATABASE_URL` at import. That last one is
  // the entry T040b drained; see below.
  //
  // **`src/cli.ts` is a *new reference*, which by this ledger's own rule is the
  // regression half and not the conversion half — so it is named rather than
  // absorbed.** It arrived with T042b (!884, 2026-08-22), which made the host's
  // CLI runner read the deployment-resolved manifest set so that a packaged
  // module's declared command is reachable by the same path a core module's is
  // (D-160.9). The ledger was not updated with it, so this assertion has been
  // red on `master` since that merge request — **not** since the platform
  // relocation (!908, 2026-08-23), which is a day later and which
  // `git log -S` over `src/cli.ts` rules out.
  //
  // It stands rather than being cut because it is the shape D-160.9 chose: the
  // host runs a module's command, so the host's CLI entry point holds the
  // resolved manifest set, and `_lifecycle` is where that set is derived. It
  // retires with the same D-37 A2 relocation as the two entries beside it.
  //
  // `blog` needs no entry and gets none. Its move to a workspace package
  // (feature 080, T040b) removed nothing from this map: the only file that ever
  // named `modules/blog/` was `composition.generated.ts`, and a generated file
  // is excluded here by construction — deleting the directory and regenerating
  // removes the reference, which is the whole point of generating it (FR-030).
  //
  // **`src/db/configured-migrations.ts` left with T040b's last move**, and it
  // left without anything in that file changing: the reference it held was the
  // *manifest index*, which is now host-owned under `backend/src/` (D-160.3)
  // rather than a file of this module's.
  //
  // **The whole entry was rewritten by D-160.11's second half, and what it
  // records is a different kind of reference.** The module's sources moved into
  // `@endora-commerce/platform`; what stayed at `backend/src/lifecycle/` is the
  // host half the ruling names — the manifest registry, the divergence reader,
  // the five `module:*` commands — plus a **re-export shim** per moved file that
  // something in `backend/` still names at its old path. There were twelve when
  // that half landed; the count is not written down here, because it is exactly
  // the length of the array below (D-100).
  // Those shims are the bridge, and they are the only files in this application
  // that reach the module's directory: `src/cli.ts` and `src/composition.ts`
  // reach a shim, which is a sibling of theirs and not this module's file, so
  // they left the ledger without a line of either changing.
  //
  // Each shim is a real dangling reference — delete the module's directory and
  // its forwarding target goes with the next build — and the entry is therefore
  // the honest count of what the bridge costs. It drains as consumers stop
  // naming the old paths, shim by shim, and not before: a shim with no importer
  // is a shim to delete.
  //
  // The scan very nearly reported this entry as **drained**, which is worth
  // recording because it is the failure mode this ledger has: `ownDirectoryOf`
  // read the module's location off the index's `manifestPath`, that field now
  // names the package's *built* manifest, the containment test failed, and the
  // fallback returned a `src/modules/_lifecycle/` nothing has ever imported.
  // Twelve real references would have read as zero, in the file whose subject
  // is references that survive a move.
  //
  // **The entry drained across features 115 Phase 6 and Phase 7, and this
  // ledger was edited in each of the two merge requests that freed it** — which
  // is the whole reason the paragraph is worth reading. Nothing in either phase
  // *opens* this file. Phase 6 re-pointed `composition.ts`, two `src/db/`
  // readers and two `scripts/` callers onto `@endora-commerce/platform/lifecycle`
  // and deleted the three shims that then had no importer left anywhere;
  // Phase 7 re-pointed `backend/test/**`, which was the only thing still
  // holding the other nine open, and deleted those. So the batch that frees an
  // entry is structurally the batch whose targeted run cannot see it go stale,
  // and this paragraph is that rule met rather than restated.
  //
  // **`_lifecycle` is therefore absent from this map, and the absence is the
  // record.** `backend/src/lifecycle/` still exists and still holds the host
  // half D-160.11 names — the manifest registry binding and the five `module:*`
  // entry points — but nothing in it names the module's own directory any
  // more: every one of those files reaches the platform through
  // `@endora-commerce/platform/lifecycle`, and a bare specifier through an
  // `exports` map is not a reference into `packages/platform/{src,dist}/lifecycle/`.
  // A re-entry here means a file in this application has gone back to naming
  // the module's sources by path, which is exactly what the subpath exists to
  // stop.
  // `price_lists` needs no entry and gets none, since T040b's fifth batch — this
  // module is now **absent** from the ledger.
  //
  // Two entries left it together when the `apps/<deployment>/decorations/` seam
  // was retired: the decoration file itself, and `src/composition.ts`. The last
  // one was the dev seed, which value-constructs `DefaultPriceListMigrator`, and
  // that is the entry the packaging cleared — but **not** by the route the three
  // criterion-7 entries above take. A row type off `dist` would have kept the
  // substring; what happened instead is that the module now publishes the
  // migrator itself on `./backend`, so the seed names a bare specifier and holds
  // the same class the platform composed. It had to: the reach is to a
  // *service*, and the duplicate entity class it would have carried sits one hop
  // behind it, where `check:singleton-identity`'s conjunct 2 cannot see it
  // (D-160.6.1). The residue drained as a side effect of a correctness repair,
  // which is worth recording because the reverse — a ledger entry that looks
  // drained because a reach was re-spelled — is the failure this file exists to
  // refuse.
  // `product_feeds` needs no entry and gets none, for `blog`'s reason and not
  // for a cleared coupling. Its move to a workspace package (feature 080,
  // criterion 8) left the contributions exactly where they were — both roots
  // still hand it the four adapters it reaches outside itself through, plus the
  // worker-role gate, and the harness still adds the taxonomy and delivery
  // seams. What changed is the **spelling**: `src/composition.ts` now type-
  // imports `ProductFeedsBridge` from `@endora-commerce/mod-product-feeds/backend`,
  // and this scan asks whether a file names `modules/<id>/`, which a bare
  // specifier does not. The residue is real and is measured elsewhere — a
  // contribution over a cradle name is `check:port-dependencies`' subject, not
  // this one.
  // `carts` (wave 3, T136). Both roots contribute who is asking and the bridge
  // into `shopping_lists`, which points outward and so cannot be a port. The
  // abandonment-sweep CLI still constructs its own services — filed separately.
  // Every other module is absent, and absence is the record: an absent key
  // means "no residue", which is not the same as a key with an empty list. The
  // scan only reports modules something still refers to, so an empty array
  // would be a key it never produces and the comparison would fail on the count
  // alone.
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Every module-relative import specifier in a source file. */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const pattern = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1]) out.push(match[1]);
  }
  return out;
}

/**
 * Files outside `src/modules/<id>/` that import from it — i.e. what would stop
 * compiling the moment the directory is deleted.
 *
 * `*.generated.ts` is excluded on purpose: a generated file is a function of
 * the tree, so deleting the directory and regenerating removes the reference.
 * That is the whole point of generating them (FR-030).
 */
function residueFor(moduleId: string): string[] {
  const own = ownDirectoryOf(moduleId);
  // The addresses the module keeps *outside* this application, as text — a
  // specifier that leaves `src/` cannot be resolved against the filesystem the
  // way one that stays inside it is, because a bare specifier goes through an
  // `exports` map.
  //
  // `modules/<id>/` is where a packaged module's own directory sits. A module
  // inside the platform package has **two**: its source directory, and the
  // built directory the index's own `manifestPath` names — which is the one
  // `backend/src/lifecycle/`'s re-export shims reach, and therefore the one
  // that makes them residue. Both are read off artefacts rather than derived
  // from each other; a `src`→`dist` rewrite here would be a convention this
  // file invented about somebody else's build.
  const elsewhere: string[] = [];
  if (own === join(srcRoot, 'modules', moduleId)) {
    elsewhere.push(`modules/${moduleId}/`);
  } else if (!own.startsWith(`${srcRoot}${sep}`)) {
    const repoRoot = resolve(srcRoot, '../..');
    elsewhere.push(`${relative(repoRoot, own).split(sep).join('/')}/`);
    const entry = DISCOVERED_MANIFESTS.find((candidate) => candidate.id === moduleId);
    if (entry !== undefined) {
      const built = relative(repoRoot, dirname(entry.manifestPath)).split(sep).join('/');
      if (!built.startsWith('..')) elsewhere.push(`${built}/`);
    }
  }
  const offenders = new Set<string>();
  for (const file of walk(srcRoot)) {
    if (file.startsWith(`${own}${sep}`)) continue;
    if (file.endsWith('.generated.ts')) continue;
    const specs = importSpecifiers(readFileSync(file, 'utf8'));
    if (specs.some((spec) => reaches(spec, file, own, elsewhere))) {
      offenders.add(relative(resolve(srcRoot, '..'), file));
    }
  }
  return [...offenders].sort();
}

/**
 * Every module whose sources sit inside the platform package, by id.
 *
 * There is one — `_lifecycle`, which merged into `@endora-commerce/platform`
 * with D-160.11's second half — and it cannot be found through the index's
 * `manifestPath`, because a module inside the platform is imported at that
 * package's **built** file. The layout's own derivation finds it by the marker
 * core discovery uses, which is the same answer every check gets.
 */
const PLATFORM_RESIDENT_DIRECTORIES: ReadonlyMap<string, string> = new Map(
  platformResidentModuleRoots(
    platformSourceRootAt(resolve(srcRoot, '../..')),
    [],
    new Set(DISCOVERED_MANIFESTS.map((entry) => entry.id)),
  ).map((root) => [root.moduleId!, root.directory] as const),
);

/**
 * The module's own directory, which is no longer always `src/modules/<id>`.
 *
 * Three answers now. A module the application's own tree holds is read off the
 * index's `manifestPath`; a module inside the platform package comes from the
 * map above; and a module package answers outside `src/`, for which the name
 * below is the address a relative specifier would still use.
 *
 * **The platform case may not go through `manifestPath`**, and that is what
 * this function got wrong for one run: the field names `packages/platform/dist/
 * lifecycle/manifest.js`, so the containment test failed, the fallback returned
 * a `src/modules/_lifecycle/` that does not exist, and the scan reported the
 * whole entry drained. A residue ledger that empties because the scanner lost
 * the module is the exact silence this file exists to refuse.
 */
function ownDirectoryOf(moduleId: string): string {
  const resident = PLATFORM_RESIDENT_DIRECTORIES.get(moduleId);
  if (resident !== undefined) return resident;
  const entry = DISCOVERED_MANIFESTS.find((candidate) => candidate.id === moduleId);
  const directory = entry === undefined ? null : dirname(entry.manifestPath);
  return directory !== null && directory.startsWith(`${srcRoot}${sep}`)
    ? directory
    : join(srcRoot, 'modules', moduleId);
}

/**
 * Does this specifier reach the module's own directory?
 *
 * A specifier that stays **inside** the application's source tree is resolved
 * and compared, because a substring test is ambiguous the moment a module's
 * directory is one path segment: the kernel's own `lifecycle/` (the gating
 * wrappers, D-37 A1) would answer for `_lifecycle` in every file that imports
 * `effective-state`. One that leaves it is compared as text against the address
 * the module keeps out there — which is how a packaged module's built artefact
 * is recognised (`packages/modules/<id>/dist/…`, the dev seed's row type) and
 * which resolving would not answer, since a bare specifier goes through an
 * `exports` map rather than the filesystem.
 */
function reaches(
  specifier: string,
  file: string,
  own: string,
  elsewhere: readonly string[],
): boolean {
  if (specifier.startsWith('.')) {
    const resolved = resolve(dirname(file), specifier);
    if (resolved === srcRoot || resolved.startsWith(`${srcRoot}${sep}`)) {
      return resolved === own || resolved.startsWith(`${own}${sep}`);
    }
  }
  return elsewhere.some((address) => specifier.includes(address));
}

describe('T055 — deleting the module directory leaves no dangling reference', () => {
  it(`nothing outside src/modules/${SUBJECT}/ imports it`, () => {
    const residue = residueFor(SUBJECT);
    expect(
      residue,
      `${SUBJECT} is the removal subject: these files would stop compiling if its ` +
        `directory were deleted — ${residue.join(', ')}`,
    ).toEqual([]);
  });

  it('records, per converted module, exactly which references still hold it', () => {
    const actual: Record<string, readonly string[]> = {};
    for (const entry of MODULES) {
      const residue = residueFor(entry.id);
      if (residue.length > 0) actual[entry.id] = residue;
    }
    expect(
      actual,
      'the residue ledger drifted: either a conversion cleared an entry (delete it) ' +
        'or a new reference into a converted module appeared (that is the regression)',
    ).toEqual(RESIDUE_LEDGER);
  });
});

describe('T055 — the removed module contributes no schema', () => {
  it('owns no entity, so the ORM metadata loses nothing', () => {
    // Read from the generated registry and from the module's own directory,
    // because both are the ORM's answer since feature 071's F2. The module's
    // `backend.ts` used to export an `entities` array and this assertion used
    // to read it; nothing else did, so it was deleted (issue #73).
    expect(declaredEntityNamesFor(SUBJECT)).toEqual([]);
    expect(registeredEntityNamesFor(SUBJECT)).toEqual([]);

    // `blog` is the witness that the two readers above see anything at all —
    // otherwise a helper that silently found nothing would report every module
    // entity-free, which is the vacuous pass this file exists to refuse.
    expect(declaredEntityNamesFor('blog')).toEqual(registeredEntityNamesFor('blog'));
    expect(registeredEntityNamesFor('blog').length).toBeGreaterThan(0);
    const registeredNames = new Set(ALL_ENTITIES.map((e) => (e as { name: string }).name));
    for (const name of registeredEntityNamesFor('blog')) {
      expect(registeredNames, name).toContain(name);
    }
  });

  it('owns no migration, and the plan computed without it is unchanged', () => {
    const moduleDependencies = new Map<string, readonly string[]>([
      ['core', []],
      ...DISCOVERED_MANIFESTS.map(
        (entry) => [entry.id, entry.manifest.dependencies ?? []] as const,
      ),
    ]);
    const plan = (entries: readonly MigrationRegistryEntry[]): string[] =>
      orderMigrations({
        entries,
        moduleDependencies,
        baseline: BASELINE_MIGRATIONS,
      }).migrations.map((migration) => migration.name);

    const owned = MIGRATION_REGISTRY.filter((entry) => entry.moduleId === SUBJECT);
    expect(owned).toEqual([]);

    const withoutSubject = MIGRATION_REGISTRY.filter((entry) => entry.moduleId !== SUBJECT);
    expect(plan(withoutSubject)).toEqual(plan(MIGRATION_REGISTRY));
  });
});

describe('T058 — a removed module contributes to no admin inventory', () => {
  /**
   * The three inventories a module contributes to, each derived from the
   * manifest registry and nothing else. That is what makes removal total:
   * deleting the directory removes the manifest, and the manifest is the only
   * declaration of the module's permissions, palette actions and settings
   * group. Each projection below is the same one production builds —
   * `PermissionCatalogueService`, `admin_actions`' reconciler input, and
   * `collectRegisteredSettingsManifests()`.
   */
  const inventories = (entries: ReadonlyArray<RegisteredManifestEntry>) => ({
    permissions: listAssignablePermissionCodes(entries),
    actions: entries.flatMap((entry) =>
      (entry.manifest.actions ?? []).map((action) => `${entry.manifest.id}:${action.id}`),
    ),
    settingsGroups: entries
      .map((entry) => entry.manifest.settings?.moduleCode)
      .filter((code): code is string => code !== undefined),
  });

  const without = (moduleId: string): ReadonlyArray<RegisteredManifestEntry> =>
    REGISTERED_MANIFESTS.filter((entry) => entry.manifest.id !== moduleId);

  it(`removing ${SUBJECT} changes no inventory — it declares none`, () => {
    expect(inventories(without(SUBJECT))).toEqual(inventories(REGISTERED_MANIFESTS));
  });

  it('removing a module that declares all three drops exactly its declarations', () => {
    // `health_checks` is the removal subject but declares nothing, so on its own
    // it cannot tell "the inventories are manifest-derived" from "the test does
    // not look". A module that declares all three is the witness that it does.
    const witness = 'product_feeds';
    const entry = REGISTERED_MANIFESTS.find((e) => e.manifest.id === witness);
    expect(entry, `${witness} should be registered`).toBeDefined();

    const full = inventories(REGISTERED_MANIFESTS);
    const reduced = inventories(without(witness));

    const droppedPermissions = full.permissions.filter((c) => !reduced.permissions.includes(c));
    const droppedActions = full.actions.filter((a) => !reduced.actions.includes(a));
    const droppedGroups = full.settingsGroups.filter((g) => !reduced.settingsGroups.includes(g));

    expect(droppedPermissions.length).toBeGreaterThan(0);
    expect(droppedActions.length).toBeGreaterThan(0);
    expect(droppedGroups).toEqual([entry?.manifest.settings?.moduleCode]);
    // And nothing else moved: every dropped code is one this module declared.
    const declared = new Set((entry?.manifest.permissions ?? []).map((p) => p.code));
    expect(droppedPermissions.every((code) => declared.has(code))).toBe(true);
    expect(droppedActions.every((id) => id.startsWith(`${witness}:`))).toBe(true);
  });
});

describe('T055 — the remaining module set still composes', () => {
  const log = { info: (): void => {}, warn: (): void => {}, error: (): void => {} };

  /**
   * The one host seam a compose-only root still owes the generated list.
   *
   * `pim_unopim` registers an API interceptor from `registerModule` (feature
   * 089, FR-003 — it refuses activating a second PIM while one is active), and
   * `ctx.interceptors` **refuses** a root that mounts no registry rather than
   * dropping the registration. That is the right way round and is not being
   * worked around here: a silently dropped interceptor is a refusal that stops
   * refusing, and nothing in `composeModules` can tell a root that will build a
   * server from one that will not, so a gate could only key on the registry
   * being absent — which is the fail-open shape.
   *
   * Both real roots build one (`src/composition.ts`, `test/helpers/test-server.ts`),
   * so this root owes it exactly as it owes `redis` and `emFactory` below. It
   * needs no `isModuleEnabled` predicate and no seal: composition *collects*
   * interceptors and `buildServer` is what dispatches them, and this file builds
   * no server.
   *
   * One per composition, not one shared: a registry refuses a second
   * registration of the same `(module, id)` pair, so the two compositions below
   * would collide on `pim_unopim`'s.
   */
  const newInterceptorRegistry = (): ApiInterceptorRegistry => new ApiInterceptorRegistry();

  function composeWithout(removed: string): ReturnType<typeof composeModules> {
    const container = createRootContainer();
    registerValues(container, {
      // The host values the surviving converted modules resolve. `orm` is
      // `health_checks`' only kernel dependency and is deliberately absent —
      // nothing left may reach for it.
      //
      // D-156.6 — `requireAdmin`, `assetReferenceRegistry` and
      // `dictionaryValidator` used to be in this list and are **not** host
      // values: `auth`, `assets_library` and `dictionaries` own them, and all
      // three survive the removal and register them themselves. Standing them
      // up here put a root's value under a name a module owns, which is the
      // wrong side of D-45's window — earlier than the module, so the module's
      // registration overwrites it and the stand-in was doing nothing. The
      // guard refuses it now, which is how the fixture was found.
      redis: undefined,
      settingsReadPort: undefined,
      blogStorefrontDeps: undefined,
      emFactory: () => undefined,
    });
    return composeModules(
      MODULES.filter((entry) => entry.id !== removed),
      { container, eventBus: new EventBus(), log, interceptorRegistry: newInterceptorRegistry() },
    );
  }

  it('composes the surviving modules without the removed one', () => {
    const composed = composeWithout(SUBJECT);
    expect(composed.ownerOf('healthCheckProbes')).toBeUndefined();
    // The surviving modules still own their names — removal took exactly one.
    expect(composed.ownerOf('emailMailer')).toBe('email');
  });

  it('resolving the removed module\'s registration fails naming the name', () => {
    const container = createRootContainer();
    registerValues(container, { redis: undefined });
    composeModules(
      MODULES.filter((entry) => entry.id !== SUBJECT),
      { container, eventBus: new EventBus(), log, interceptorRegistry: newInterceptorRegistry() },
    );
    // Not `undefined` reaching business logic — the property `composition.ts`
    // could not offer, where a missing option-object key is simply absent.
    expect(() => container.cradle['healthCheckProbes']).toThrow(/healthCheckProbes/);
  });
});
