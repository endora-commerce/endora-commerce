import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MODULES } from '../../../src/composition.generated.js';
import { EventBus } from '../../../src/events/bus.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { ALL_ENTITIES } from '../../../src/db/entities-registry.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.js';
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
 * `audit_logs` (wave 1, T084) is the second module to be **absent from this
 * ledger entirely**, and the first that got there by being disentangled rather
 * than by having been simple all along. Before its conversion it was not even a
 * candidate: `admin_users/plugin.ts` imported both its route files and
 * constructed its service. It owns no entity (`AuditLogEntry` moved to the
 * kernel in T016) and no migration, so neither central registry names it, and
 * the `auditActorResolver` a root contributes is a closure over `admin_users`'
 * own service — it imports nothing from `audit_logs`. Deleting the directory
 * really is all there is to it. That is the target shape for the rest of the
 * sweep.
 */
const RESIDUE_LEDGER: Readonly<Record<string, readonly string[]>> = {
  // `composition.ts` still reaches into `email` twice: for the `EmailCradle`
  // type it resolves the mailer with, and for `absolutizePublicUrl`, a URL
  // helper it applies on behalf of modules that are still hand-wired. Both
  // disappear when those consumers convert; neither belongs to `email`.
  email: ['src/composition.ts'],
  // Two central registries name blog by path, and they are different problems.
  //
  //  - `entities-registry.ts` is a hand-maintained flat import list, so blog's
  //    11 entities are declared in a file blog does not own. Feature 072 does
  //    not rewire it: it is imported by `mikro-orm.config.ts`, which the
  //    migration CLI loads, and sourcing it from the generated composer would
  //    pull every module's full import graph into the ORM config. It is the
  //    last structural hole in US4 and it belongs to the harness convergence.
  //  - `migrations-registry.ts` names every migration on purpose (feature 065:
  //    static imports, no glob), so a module's migrations are registered
  //    outside it by design. Removing a module deletes its group from that
  //    file, which is a mechanical, single-region edit the file's grouping was
  //    built for — not archaeology.
  blog: ['src/db/entities-registry.ts', 'src/db/migrations-registry.ts'],
  // `auth` (T078). Two references, both of which say something:
  //
  //  - `entities-registry.ts` names its `Session` entity, the same
  //    hand-maintained list blog is caught by above.
  //  - `composition.ts` imports `promoteAdminActor` and the `AuthCradle` type.
  //    The type import is the ordinary shape of a root resolving a module's
  //    registrations. `promoteAdminActor` is the interesting one: it is the
  //    admin-session promotion the hand-wired `requireCustomer` closure applies
  //    before deciding whether a request carries a customer, and it leaves when
  //    `customer_accounts` converts.
  auth: ['src/composition.ts', 'src/db/entities-registry.ts'],
  // `admin_roles` (wave 1). Same two shapes as `auth`: its `AdminRole` entity
  // is named by the hand-maintained ORM registry, and `composition.ts` imports
  // its service types to annotate what it resolves out of the container. The
  // second one is the ordinary shape of a root reading a module's
  // registrations, and it leaves when nothing hand-wired needs the annotation.
  admin_roles: ['src/composition.ts', 'src/db/entities-registry.ts'],
  // `currencies` (wave 1). Same two shapes again — the ORM registry names its
  // entity, and `composition.ts` imports the service type to annotate what it
  // resolves and hands to `dictionaries` and `languages`. Both hosts take the
  // service as an argument now instead of each constructing one.
  currencies: ['src/composition.ts', 'src/db/entities-registry.ts'],
  // `analytics` (wave 1) — the first converted module with **no reference from
  // a composition root at all**. Only the two central registries hold it, and
  // both are known structural holes rather than anything this module did: the
  // ORM entity list is hand-maintained, and the migration registry names every
  // migration on purpose (feature 065). This is the residue shape the rest of
  // the sweep should be aiming at.
  analytics: ['src/db/entities-registry.ts', 'src/db/migrations-registry.ts'],
  // `admin_notifications` (wave 1). Its service type is still imported by both
  // roots, which annotate what they resolve out of the container and hand to
  // the four modules that write notifications. It leaves when those convert.
  admin_notifications: [
    'src/composition.ts',
    'src/db/entities-registry.ts',
    'src/db/migrations-registry.ts',
  ],
  // `credentials` (wave 1). Beyond the two registries, `composition.ts` imports
  // its service type and the four core configuration types it registers into
  // the cross-module registry at boot — which is the root's job, not this
  // module's, so that reference is expected to stay.
  credentials: [
    'src/composition.ts',
    'src/db/entities-registry.ts',
    'src/db/migrations-registry.ts',
  ],
  // `prompt_actions` (wave 1) — the inverted case, and the reason this ledger
  // is worth keeping. Its `composition.ts` reference is not a leftover of the
  // conversion: three *other* modules contribute tools into the registry this
  // one owns, and the root is where "which modules does this deployment ship"
  // is known. So the root imports `PromptActionTool` to type the contributions
  // and `PromptActionToolRegistry` to type what it resolves. Both stay until
  // `catalog`, `inventory` and `orders` convert and contribute for themselves.
  prompt_actions: [
    'src/composition.ts',
    'src/db/entities-registry.ts',
    'src/db/migrations-registry.ts',
  ],
  // `addresses` (wave 1, T090). The ORM registry names its `Address` entity —
  // the hand-maintained list blog is caught by above — and both roots import
  // the service type to annotate what they resolve and hand to `orders` and
  // `organizations`. Those two took the service as an argument already; what
  // changed is that there is now one of it instead of three.
  addresses: ['src/composition.ts', 'src/db/entities-registry.ts'],
  // `delivery_methods` and `payment_methods` (wave 1, T095/T097), converted as
  // a pair. Beyond the two central registries, both roots import their registry
  // and order-status types to annotate what they resolve and hand to `orders`,
  // which still dispatches placement through them. Those go when `orders`
  // converts. `payment_methods` additionally keeps a root reference for the
  // built-in adapters, which live in `payments` — supplying them is a
  // deployment's job, not this module's, so that one is expected to stay.
  delivery_methods: [
    'src/composition.ts',
    'src/db/entities-registry.ts',
    'src/db/migrations-registry.ts',
  ],
  payment_methods: [
    'src/composition.ts',
    'src/db/entities-registry.ts',
    'src/db/migrations-registry.ts',
  ],
  // `webhooks` (wave 1, T098). Beyond the two central registries, the root
  // keeps the delivery **worker** — whether workers run at all is a
  // `BACKEND_ROLE` deployment decision, not the module's — so it imports the
  // processor factory and the module's cradle type. That reference is expected
  // to stay until workers themselves move behind a deployment-owned seam.
  webhooks: [
    'src/composition.ts',
    'src/db/entities-registry.ts',
    'src/db/migrations-registry.ts',
  ],
  // `customer_accounts` (wave 1, T094). The ORM and migration registries name
  // its two entities and five migrations; `composition.ts` imports the cradle
  // type to annotate the services it resolves and hands to `customers` and
  // `organizations`. Both of those built their own before this conversion, and
  // the reference leaves when they convert.
  customer_accounts: [
    'src/composition.ts',
    'src/db/entities-registry.ts',
    'src/db/migrations-registry.ts',
  ],
  // `assets_library` (wave 1, T092). The two registries name its entities and
  // migrations; `composition.ts` imports the cradle type to annotate the handle
  // it resolves and hands the `catalog`, `cms` and `megamenu` reference
  // resolvers to. Contributing those is a root's job — which modules a
  // deployment ships is not this module's business — so that one stays.
  assets_library: [
    'src/composition.ts',
    'src/db/entities-registry.ts',
    'src/db/migrations-registry.ts',
  ],
  // `audit_logs` is deliberately absent — see the note above the ledger.
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
