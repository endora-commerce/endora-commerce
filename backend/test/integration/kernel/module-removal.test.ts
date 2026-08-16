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
  UNCORRECTED_THROUGH,
  type MigrationRegistryEntry,
} from '../../../src/db/migration-order.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';
import {
  REGISTERED_MANIFESTS,
  type RegisteredManifestEntry,
} from '../../../src/modules/_lifecycle/registered-manifests.js';
import { listAssignablePermissionCodes } from '../../../src/modules/admin_roles/services/permission-catalogue.service.js';
import { entities as healthCheckEntities } from '../../../src/modules/health_checks/backend.js';

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
 * Feature 071's F2 generates both, so it is now the *ordinary* shape: 36 of the
 * 65 modules are absent below. What is left is references from a composition
 * root, which F3 and F4 drain.
 */
const RESIDUE_LEDGER: Readonly<Record<string, readonly string[]>> = {
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
  // `catalog` (wave 4, T142). `composition.ts` types the five contributions a
  // root supplies — the bulk-operation worker flag, the admin audit actor
  // shape, availability bands, the image placeholder, and the Meilisearch
  // reindex production runs and the harness must not.
  catalog: ['src/composition.ts'],
  // `orders` (wave 4, T141). `composition.ts` types the sales-rep admin scope
  // it still supplies, which drains when `auth`'s actor resolution unifies.
  orders: ['src/composition.ts'],
  // `organizations` (wave 4, T138). `composition.ts` for the deployment inputs
  // and the login hook. There used to be another entry: the kernel
  // type-imported the `Organization` entity to declare `OrganizationReadPort`,
  // recorded here as "meant to be permanent". D-55 dissolved it — the port now
  // declares a structural `OrganizationSnapshot` over `@b2b/contracts`' status
  // union, and the entity stays in this module. The kernel owning the shape
  // never required it to own the class.
  organizations: ['src/composition.ts'],

  // `composition.ts` still reaches into `email` twice: for the `EmailCradle`
  // type it resolves the mailer with, and for `absolutizePublicUrl`, a URL
  // helper it applies on behalf of its consumers. Both disappear when those
  // consumers resolve it themselves; neither belongs to `email`.
  email: ['src/composition.ts'],
  // `auth` (T078). `composition.ts` imports `promoteAdminActor` and the
  // `AuthCradle` type. The type import is the ordinary shape of a root
  // resolving a module's registrations. `promoteAdminActor` is the interesting
  // one: it is the admin-session promotion the hand-wired `requireCustomer`
  // closure applies before deciding whether a request carries a customer, and
  // it leaves when `customer_accounts` converts.
  auth: ['src/composition.ts'],
  // `admin_roles` (wave 1). `composition.ts` imports its service types to
  // annotate what it resolves out of the container — the ordinary shape of a
  // root reading a module's registrations. It leaves when nothing hand-wired
  // needs the annotation.
  admin_roles: ['src/composition.ts'],
  // `prompt_actions` (wave 1) — the inverted case, and the reason this ledger
  // is worth keeping. Its `composition.ts` reference is not a leftover of the
  // conversion: three *other* modules contribute tools into the registry this
  // one owns, and the root is where "which modules does this deployment ship"
  // is known. So the root imports `PromptActionTool` to type the contributions
  // and `PromptActionToolRegistry` to type what it resolves. Both stay until
  // `catalog`, `inventory` and `orders` convert and contribute for themselves.
  prompt_actions: ['src/composition.ts'],
  // `customer_accounts` (wave 1, T094). `composition.ts` imports the cradle
  // type to annotate the services it resolves and hands to `customers` and
  // `organizations`. Both of those built their own before this conversion, and
  // the reference leaves when they convert.
  customer_accounts: ['src/composition.ts'],
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
  // `mfa` (wave 1, T096). `composition.ts` imports the cradle and bridge types
  // to annotate what it contributes — the actor shape, which is a root's to
  // know — and the login port it hands `customer_accounts` through
  // `mfaLoginPortGetter`. Type-only since T143c: the provider class and the
  // `MFA_OAUTH_*` reader were value imports, because a root decided on this
  // module's behalf whether it had social sign-in; the module reads its own
  // environment now.
  mfa: ['src/composition.ts'],
  // `taxes` (wave 2, T119). `composition.ts` imports the cradle type to
  // annotate the `taxService` port it resolves and threads into `orders` and
  // `carts` for line pricing. That reference goes when those two convert.
  taxes: ['src/composition.ts'],
  // `comparisons` (wave 2, T111). `composition.ts` imports the cradle type to
  // annotate the `comparisonService` port it resolves and binds the login
  // flow's anonymous-comparison adoption to. That reference goes when
  // `organizations` converts and reads the port itself.
  comparisons: ['src/composition.ts'],
  // `megamenu` (wave 2, T107). `composition.ts` imports the cradle type plus
  // the two dependency-bundle types, because the bundles themselves stay in the
  // root — they are existence checks and URL lookups against `catalog`, `cms`
  // and `assets_library` tables, and moving them into the module would give it
  // direct reads of another module's storage. Those references are a root's by
  // design rather than a leftover, so unlike most entries here they do not go
  // when some other module converts.
  megamenu: ['src/composition.ts'],
  // `admin_actions` (wave 2, T099). `composition.ts` imports the cradle type to
  // annotate the reconciler it hands the lifecycle orchestrator. That reference
  // goes when `_lifecycle` converts.
  admin_actions: ['src/composition.ts'],
  // `pwa` (wave 2, T116). `composition.ts` imports the bridge type to annotate
  // the nine cross-module resolvers it contributes as one. Those are a root's
  // by design — reaching `assets_library` and `sales_channels` is not this
  // module's business — so unlike most entries here they do not go when another
  // module converts.
  pwa: ['src/composition.ts'],
  // `invoices` (wave 2, T113). `composition.ts` imports the bridge type to
  // annotate what it contributes. The cradle import went with T143c: it existed
  // to reach `invoiceNumberGenerator` for a `CorrectiveInvoiceProvider` the root
  // built, and that adapter is `correctiveInvoicePort` now — which is also what
  // ended the two roots numbering corrections out of two different counters.
  invoices: ['src/composition.ts'],
  // `returns` (wave 2, T109). `composition.ts` imports the bridge type to
  // annotate the four settlement adapters it contributes. Those are a root's by
  // design — each is an adapter over a module `returns` must not read directly
  // — so unlike most entries here they do not go when another module converts.
  returns: ['src/composition.ts'],
  // `ksef` (wave 2, T104). `composition.ts` imports the cradle type to annotate
  // the seller NIP resolver it contributes and the verification block it
  // contributes into `invoices`. The second is a root's by design: `ksef` reads
  // `invoiceService`, so `invoices` resolving a `ksef` port would close a
  // dependency cycle.
  ksef: ['src/composition.ts'],
  // `newsletter` (wave 2, T114). `composition.ts` imports the bridge type to
  // annotate the pinned token secret and base URLs, and contributes the email
  // branding. Both are a root's by design: the branding source announces itself
  // through a callback a root holds, so a port would point the dependency the
  // wrong way.
  newsletter: ['src/composition.ts'],
  // `admin_users` (wave 2, T121). Both roots contribute the late-bound MFA
  // getter and the `auditActorResolver` adapter that `audit_logs` owns the name
  // for. The second is a root's by design — see `audit_logs/backend.ts` — and
  // the first goes when a deployment stops needing to say which module supplies
  // MFA.
  admin_users: ['src/composition.ts'],
  // `sales_channels` (wave 2, T110). Both roots compose the kernel half —
  // cache, resolver, membership, middleware — through
  // `composeSalesChannelsKernel`, and build `salesChannelCodeIdPort` over the
  // module's CRUD service. That is not residue of a half-finished conversion:
  // channel resolution backs every channel-scoped read (Principle XII) and is
  // kernel infrastructure by design since T019.
  sales_channels: ['src/composition.ts'],
  // `settings` (wave 2, T118). Both roots compose the kernel reader through
  // `composeSettingsKernel` and register the two deployment properties the
  // admin surface needs — the `secret` encryption key and the effective-state
  // reader. Like `sales_channels`, that is design rather than residue: a
  // settings read backs behaviour in nearly every module and cannot be gated
  // on the settings screens.
  settings: ['src/composition.ts'],
  // `_lifecycle` (wave 2, T125). It was the longest entry here until D-37 A1
  // moved the presence machinery into `src/kernel/lifecycle/`: the entity left
  // the module and the two kernel files — which held the gating wrappers this
  // module used to own — now import a sibling rather than a module. What is
  // left is the boot half `composition.ts` composes (the first-boot reconciler,
  // the registry-cache warm, the worker resume, the orchestrator and the
  // activation propagation) and the migration group named by
  // `mikro-orm.config.ts`.
  _lifecycle: ['src/composition.ts', 'src/db/mikro-orm.config.ts'],
  // `price_lists` (wave 3, T127). Both roots contribute the sweeper flag, the
  // cache TTL and the admin audit shape, and production contributes the pricing
  // decoration (D-28) — the seam this module exists in the feature to prove.
  price_lists: [
    // The overlay decoration itself — `decorate(inner)` written against
    // `pricing-service.interface.ts`. It is the point of D-28 rather than
    // residue: a deployment that wraps the pricing engine names the module it
    // wraps, and `tsc` is the gate that keeps the wrapper assignable.
    'src/apps/example/decorations/pricing-service.ts',
    'src/composition.ts',
  ],
  // `inventory` (wave 3, T129). Both roots contribute the two adapters it
  // reaches outside itself through — the transactional-email sender and the
  // Organization's warehouse assignment — plus the admin audit shape.
  inventory: ['src/composition.ts'],
  // `shopping_lists` (wave 3, T133). Both roots contribute the four
  // cross-module names it must not reach for directly — the RFQ service, the
  // org restriction, the lazy order service, and the sink that hands its own
  // service to `carts`. Each goes when its owner converts.
  shopping_lists: ['src/composition.ts'],
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
    expect(healthCheckEntities).toEqual([]);
    const owned = new Set<unknown>(healthCheckEntities);
    expect(ALL_ENTITIES.filter((entity) => owned.has(entity))).toEqual([]);
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
        uncorrectedThrough: UNCORRECTED_THROUGH,
        correctionHorizonDays: 45,
      }).map((migration) => migration.name);

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
      redis: undefined,
      requireAdmin: undefined,
      settingsReadPort: undefined,
      assetReferenceRegistry: undefined,
      dictionaryValidator: undefined,
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
