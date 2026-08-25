import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODULES } from '../../../src/composition.generated.js';
import { EventBus } from '../../../src/events/bus.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { ALL_ENTITIES } from '../../../src/db/entities-registry.generated.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import {
  orderMigrations,
  BASELINE_THROUGH,
  type MigrationRegistryEntry,
} from '../../../src/db/migration-order.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';
import {
  REGISTERED_MANIFESTS,
  type RegisteredManifestEntry,
} from '../../../src/modules/_lifecycle/registered-manifests.js';
import { listAssignablePermissionCodes } from '../../../src/modules/admin_roles/services/permission-catalogue.service.js';
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
  // last reference goes — but it lives in `test/integration/`, which
  // `test:unit:fast` does not run, and a packaging batch's targeted run covers
  // the paths it *touched*. This file is not one of them: it is derived *about*
  // the modules a batch moves, never edited by moving them. So the batch that
  // frees an entry is structurally the batch that cannot see it go stale.
  // Three batches, three reds on `master`, each found by the next piece of work
  // rather than by the one that caused it.
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
  // The result is that **36 of the 65 modules are removable by deleting the
  // directory**, against four before. Everything below is a reference from a
  // composition root, which is the residue shape F3 and F4 are scoped to
  // finish — no central list holds a module any more.
  //
  // ── `src/seeds/` — twelve entries this scan could not see before ──────────
  //
  // Feature 075 moved `dev-catalog-seed.ts` and `attribute-fixtures.ts` out of
  // `src/modules/catalog/seeds/` and into `src/seeds/`, beside `composition.ts`.
  // The dev seed writes megamenus, organisations, customer accounts, admin
  // users and roles, delivery methods, payment methods, taxes, a default price
  // list, warehouses and stock: two of the twelve modules it names are
  // `catalog`, so it is a composition of the platform's demo data and belongs
  // where a composition root belongs.
  //
  // **The lines it adds below are not new residue.** The seed named all twelve
  // modules before the move too, and this scan missed every one of them: its
  // needle is the substring `modules/<id>/`, and from inside
  // `src/modules/catalog/seeds/` the specifier read `../../megamenu/entities/…`
  // — module-relative, so no `modules/` segment to match. That is the same
  // normalisation bug feature 075's FR-004 records as having produced a 2.2×
  // undercount elsewhere. The move did not create the coupling; it made the
  // coupling addressable, which is the only way it ever gets paid off.
  //
  // What retires them is not another cut: it is the seed reading a
  // deployment-composed set of writers rather than twelve entity classes, or
  // — the honest cheap answer — the day a developer bootstrap stops needing to
  // exist because `db:fresh` seeds from fixtures. Neither is F3 work, and
  // neither is served by moving the file somewhere this test cannot walk.
  //
  // `catalog` (wave 4, T142). `composition.ts` types the five contributions a
  // root supplies — the bulk-operation worker flag, the admin audit actor
  // shape, availability bands, the image placeholder, and the Meilisearch
  // reindex production runs and the harness must not. The two seed files are
  // new here for the reason above, and `catalog` is on the list because the
  // seed writes products and categories like it writes everything else.
  catalog: [
    'src/composition.ts',
    'src/seeds/attribute-fixtures.ts',
    'src/seeds/dev-catalog-seed.ts',
  ],
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
  custom_fields: ['src/seeds/attribute-fixtures.ts'],
  inventory: ['src/seeds/dev-catalog-seed.ts'],
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
  // runtime coupling — the imports erase, and `grep -c 'packages/modules'
  // dist/seeds/dev-catalog-seed.js` is **0**, measured. They retire when the
  // developer bootstrap stops needing to construct entities at all, which is
  // the same condition the `src/seeds/` block above already names.
  delivery_methods: ['src/seeds/dev-catalog-seed.ts'],
  payment_methods: ['src/seeds/dev-catalog-seed.ts'],
  taxes: ['src/seeds/dev-catalog-seed.ts'],
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
  // `organizations` (wave 4, T138). `composition.ts` for the deployment inputs
  // and the login hook. There used to be another entry: the kernel
  // type-imported the `Organization` entity to declare `OrganizationReadPort`,
  // recorded here as "meant to be permanent". D-55 dissolved it — the port now
  // declares a structural `OrganizationSnapshot` over `@endora-commerce/contracts`' status
  // union, and the entity stays in this module. The kernel owning the shape
  // never required it to own the class.
  organizations: ['src/composition.ts', 'src/seeds/dev-catalog-seed.ts'],

  // `composition.ts` reaches into `email` once: for the `EmailCradle` type it
  // resolves the mailer with. It disappears when the mailer's consumers resolve
  // it themselves.
  //
  // There was a second reach, `absolutizePublicUrl`, and it was a **value**
  // import — the shape that stops having a spelling once the owner is a package
  // (D-160.6.1). Feature 080's T040b moved the function to the platform rather
  // than converting the call: it had no consumer inside `email` at all, so it
  // was a deployment-origin helper filed under the module that first needed it.
  email: ['src/composition.ts'],
  // `auth` (T078). `composition.ts` imports `promoteAdminActor` and the
  // `AuthCradle` type. The type import is the ordinary shape of a root
  // resolving a module's registrations. `promoteAdminActor` is the interesting
  // one: the MFA actor bridge promotes a partially-authenticated session before
  // asserting it is an admin, and it leaves when `auth` provides actor
  // promotion as a port. It was never the customer guard's — that one is
  // `auth`'s `requireCustomer` port since issue #43 and promotes nothing.
  auth: ['src/composition.ts'],
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
  admin_roles: ['src/seeds/dev-catalog-seed.ts'],
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
  // `customer_accounts` (wave 1, T094). `composition.ts` imports the cradle
  // type to annotate the services it resolves and hands to `customers` and
  // `organizations`. Both of those built their own before this conversion, and
  // the reference leaves when they convert.
  customer_accounts: ['src/composition.ts', 'src/seeds/dev-catalog-seed.ts'],
  // `assets_library` (wave 1, T092). `composition.ts` imports the cradle type
  // to annotate the handle it resolves and hands the `catalog`, `cms` and
  // `megamenu` reference resolvers to. Contributing those is a root's job —
  // which modules a deployment ships is not this module's business — so that
  // one stays.
  assets_library: ['src/composition.ts'],
  // `_i18n` (wave 1, T089). `composition.ts` imports the cradle type and, since
  // D-54, the `ERROR_TRANSLATION_KEYS` map it injects into the error envelope.
  // That map used to be imported by `src/http/error-envelope.ts` itself, which
  // made a kernel-obeying platform peer name a module (D-52) and put the cycle
  // `kernel → http → mod-i18n → kernel` in F4's package graph. A root naming a
  // module is ordinary; a peer doing it is the defect.
  _i18n: ['src/composition.ts'],
  // `megamenu` (wave 2, T107). `composition.ts` imports the cradle type plus
  // the two dependency-bundle types, because the bundles themselves stay in the
  // root — they are existence checks and URL lookups against `catalog`, `cms`
  // and `assets_library` tables, and moving them into the module would give it
  // direct reads of another module's storage. Those references are a root's by
  // design rather than a leftover, so unlike most entries here they do not go
  // when some other module converts.
  megamenu: ['src/composition.ts', 'src/seeds/dev-catalog-seed.ts'],
  // `invoices` (wave 2, T113). `composition.ts` imports the bridge type to
  // annotate what it contributes. The cradle import went with T143c: it existed
  // to reach `invoiceNumberGenerator` for a `CorrectiveInvoiceProvider` the root
  // built, and that adapter is `correctiveInvoicePort` now — which is also what
  // ended the two roots numbering corrections out of two different counters.
  invoices: ['src/composition.ts'],
  // `admin_users` (wave 2, T121). Both roots contribute the late-bound MFA
  // getter and the `auditActorResolver` adapter that `audit_logs` owns the name
  // for. The second is a root's by design — see `audit_logs/backend.ts` — and
  // the first goes when a deployment stops needing to say which module supplies
  // MFA.
  admin_users: ['src/composition.ts', 'src/seeds/dev-catalog-seed.ts'],
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
  // importing a config that captures `DATABASE_URL` at import.
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
  _lifecycle: ['src/cli.ts', 'src/composition.ts', 'src/db/configured-migrations.ts'],
  // `price_lists` (wave 3, T127). Two entries left this ledger together when
  // the `apps/<deployment>/decorations/` seam was retired: the decoration file
  // itself, and `src/composition.ts` — which named this module for exactly one
  // reason, the `PricingServiceContract` type import the decoration lookup
  // needed. A deployment wraps the `pricingService` registration from its own
  // overlay module now (D-103), and that module declares the wrapped shape
  // structurally, so no file outside this directory names it. What remains is
  // the dev seed, which value-constructs `DefaultPriceListMigrator`.
  price_lists: ['src/seeds/dev-catalog-seed.ts'],
  // `product_feeds` (wave 3, T137). Both roots contribute the four adapters it
  // reaches outside itself through — storage, availability, category expansion
  // and stable public image URLs — plus the worker-role gate, and the harness
  // adds the taxonomy and delivery seams. The four go when their owners convert.
  product_feeds: ['src/composition.ts'],
  // `carts` (wave 3, T136). Both roots contribute who is asking and the bridge
  // into `shopping_lists`, which points outward and so cannot be a port. The
  // abandonment-sweep CLI still constructs its own services — filed separately.
  carts: ['src/composition.ts'],
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
  const needle = `modules/${moduleId}/`;
  const own = join(srcRoot, 'modules', moduleId);
  const offenders = new Set<string>();
  for (const file of walk(srcRoot)) {
    if (file.startsWith(`${own}/`)) continue;
    if (file.endsWith('.generated.ts')) continue;
    const specs = importSpecifiers(readFileSync(file, 'utf8'));
    if (specs.some((spec) => spec.includes(needle))) {
      offenders.add(relative(resolve(srcRoot, '..'), file));
    }
  }
  return [...offenders].sort();
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
        baselineThrough: BASELINE_THROUGH,
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
      { container, eventBus: new EventBus(), log },
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
      { container, eventBus: new EventBus(), log },
    );
    // Not `undefined` reaching business logic — the property `composition.ts`
    // could not offer, where a missing option-object key is simply absent.
    expect(() => container.cradle['healthCheckProbes']).toThrow(/healthCheckProbes/);
  });
});
