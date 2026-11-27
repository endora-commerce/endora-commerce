import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { describe, expect, it, vi } from 'vitest';
import type { OrganizationCreateHookData } from '@endora-commerce/contracts';
import { CommandHookRefusal, type CommandHookContext } from '@endora-commerce/platform/commands';
import {
  PLATFORM_MIGRATION_ENTRIES,
  committedModuleDependencies,
  configuredMigrationsFrom,
  requiredModulesOf,
  type MigrationRegistryEntry,
} from '@endora-commerce/platform/db';
import { getTenantContext } from '@endora-commerce/platform/tenancy';

import * as erpKeysBackend from '../../../src/apps/example/modules/example_erp_keys/backend.js';
import { ExampleErpOrganizationKey } from '../../../src/apps/example/modules/example_erp_keys/entities/example-erp-organization-key.entity.js';
import { fillErpKeyOnCreate } from '../../../src/apps/example/modules/example_erp_keys/hooks/fill-erp-key.js';
import {
  EXAMPLE_ERP_KEYS_ERROR_CODES,
  EXAMPLE_ERP_KEYS_HOST,
  EXAMPLE_ERP_KEYS_PERMISSION,
  EXAMPLE_ERP_KEYS_TABLE,
  manifest,
} from '../../../src/apps/example/modules/example_erp_keys/manifest.js';
import { ExampleErpKeyExtensionSchema, normalizeErpKey } from '../../../src/apps/example/modules/example_erp_keys/ports.js';
import { loadErpKeys } from '../../../src/apps/example/modules/example_erp_keys/services/erp-keys.js';
import { configuredMigrations } from '../../../src/db/configured-migrations.js';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
import { MIGRATION_REGISTRY } from '../../../src/db/migrations-registry.generated.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';

/**
 * `example_erp_keys`, the reference overlay (`specs/190-overlay-full-modules/`
 * US8, FR-095, T120) — the halves that need no database: its declarations, its
 * `beforeCommit` hook, its extension-attribute loader, and the promotion-name
 * property of US9 (`data-model.md` §7). The rest — off state, hard uninstall,
 * cross-tenant, the unique key through a real write, the palette by permission
 * and the `include` read — runs on the deployment's own database in
 * `test/integration/overlay/example-erp-keys.test.ts` and
 * `test/integration/_lifecycle/example-erp-keys-uninstall.integration.test.ts`.
 */

const MODULE_ID = 'example_erp_keys';
const ORGANIZATION_ID = '00000000-0000-4000-8000-00000000e001';

describe('example_erp_keys declares what a full overlay module declares', () => {
  it('extends organizations.Organization with its own side table, the owner a dependency (187 E2 – E4)', () => {
    expect(manifest.id).toBe(MODULE_ID);
    expect(manifest.extends).toEqual([{ entity: EXAMPLE_ERP_KEYS_HOST, table: EXAMPLE_ERP_KEYS_TABLE }]);
    expect(EXAMPLE_ERP_KEYS_HOST).toBe('organizations.Organization');
    expect(manifest.dependencies).toEqual(expect.arrayContaining(['auth', 'organizations', 'settings']));
  });

  it('maps that table with one uuid key — the organization — and the tenancy 187 admits for an organizations side table', () => {
    expect(erpKeysBackend.entities).toEqual([ExampleErpOrganizationKey]);
    // The entity's own decorators are read by the ORM; the side-table rules M1 –
    // M5 are judged on a real initialisation in the integration file.
    expect(EXAMPLE_ERP_KEYS_TABLE).toMatch(/^example_erp_keys_/);
  });

  it('is switchable, gates its palette action on the permission its sidebar entry and route use (XVI, XVII)', () => {
    expect(manifest.activation).toEqual({ settingCode: 'example_erp_keys.enabled', default: true });
    expect(manifest.permissions?.map((permission) => permission.code)).toEqual([EXAMPLE_ERP_KEYS_PERMISSION]);
    expect(manifest.actions).toEqual([
      expect.objectContaining({
        id: 'open-example-erp-keys',
        targetRoute: '/example-erp-keys',
        entryApiRoute: '/api/v1/admin/example-erp-keys/keys',
        requiredPermission: EXAMPLE_ERP_KEYS_PERMISSION,
      }),
    ]);
    expect(manifest.errorCodes?.map((entry) => entry.code).sort()).toEqual(
      Object.values(EXAMPLE_ERP_KEYS_ERROR_CODES).sort(),
    );
  });
});

describe('the ERP key value', () => {
  it('is normalised before it is judged (Postel): trimmed and upper-cased', () => {
    expect(normalizeErpKey('  sap-0042 ')).toBe('SAP-0042');
  });

  it('is the extension attribute’s schema, so a consumer narrows with the owner’s contract', () => {
    expect(ExampleErpKeyExtensionSchema.parse({ erpKey: 'SAP-0042' })).toEqual({ erpKey: 'SAP-0042' });
    expect(() => ExampleErpKeyExtensionSchema.parse({ erpKey: 'not a key' })).toThrow();
  });
});

/** A `beforeCommit` context over a fake transaction; `flush` is the caller's. */
function hookContext(extension: unknown, flush: () => Promise<void> = async () => {}) {
  const created: Array<{ entity: unknown; data: unknown }> = [];
  const noted: string[] = [];
  const em = {
    create: vi.fn((entity: unknown, data: unknown) => {
      created.push({ entity, data });
      return data;
    }),
    flush: vi.fn(flush),
  };
  const ctx = {
    action: 'organization.create',
    objectType: 'organization',
    objectId: ORGANIZATION_ID,
    data: { organization: { id: ORGANIZATION_ID }, salesChannelIds: [] } as unknown as OrganizationCreateHookData,
    extension,
    em,
    actor: { actorAdminUserId: null },
    module: { id: MODULE_ID },
    run: vi.fn(),
    noteAuditChanges: (fields: readonly string[]) => void noted.push(...fields),
  } as unknown as CommandHookContext<OrganizationCreateHookData>;
  return { ctx, em, created, noted };
}

async function refusalOf(promise: Promise<unknown>): Promise<CommandHookRefusal> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandHookRefusal);
    return error as CommandHookRefusal;
  }
  throw new Error('expected a refusal');
}

describe('the beforeCommit hook on organization.create', () => {
  it('writes nothing when the create carries no ERP key — every other create is untouched', async () => {
    const { ctx, em, noted } = hookContext(undefined);
    await fillErpKeyOnCreate(ctx);
    expect(em.create).not.toHaveBeenCalled();
    expect(em.flush).not.toHaveBeenCalled();
    expect(noted).toEqual([]);
  });

  it('writes the side row on the Command’s transaction, normalised, and names the field, never the value', async () => {
    const { ctx, em, created, noted } = hookContext({ erpKey: ' sap-0042' });
    await fillErpKeyOnCreate(ctx);
    expect(created).toEqual([
      { entity: ExampleErpOrganizationKey, data: { organizationId: ORGANIZATION_ID, erpKey: 'SAP-0042' } },
    ]);
    expect(em.flush).toHaveBeenCalledOnce();
    expect(noted).toEqual(['erpKey']);
  });

  it('refuses a malformed key with its own 422 code before writing', async () => {
    const { ctx, em } = hookContext({ erpKey: 'two words' });
    const refusal = await refusalOf(fillErpKeyOnCreate(ctx));
    expect(refusal.statusCode).toBe(422);
    expect(refusal.code).toBe(EXAMPLE_ERP_KEYS_ERROR_CODES.KEY_INVALID);
    expect(em.create).not.toHaveBeenCalled();
  });

  it('refuses a key another organization holds with its own 409 code — the whole create rolls back', async () => {
    const { ctx } = hookContext({ erpKey: 'SAP-0042' }, async () => {
      throw new UniqueConstraintViolationException(new Error('duplicate key value violates unique constraint'));
    });
    const refusal = await refusalOf(fillErpKeyOnCreate(ctx));
    expect(refusal.statusCode).toBe(409);
    expect(refusal.code).toBe(EXAMPLE_ERP_KEYS_ERROR_CODES.KEY_TAKEN);
  });

  it('lets any other failure through unchanged', async () => {
    const boom = new Error('connection lost');
    const { ctx } = hookContext({ erpKey: 'SAP-0042' }, async () => {
      throw boom;
    });
    await expect(fillErpKeyOnCreate(ctx)).rejects.toBe(boom);
  });
});

describe('the extension-attribute loader (187 extension-attributes-read-ports.md §5)', () => {
  const tenant: TenantContext = {
    mode: 'single-org',
    organizationId: ORGANIZATION_ID,
    actor: { kind: 'admin', id: 'erp-keys-unit' },
  };

  it('issues one statement for any number of ids, in the caller’s tenant context, never widening it', async () => {
    const seen: Array<TenantContext | undefined> = [];
    const em = {
      find: vi.fn(async () => {
        seen.push(getTenantContext());
        return [{ organizationId: ORGANIZATION_ID, erpKey: 'SAP-0042' }];
      }),
    };
    const ids = [ORGANIZATION_ID, '00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000e003'];
    const values = await runWithTenantContext(tenant, () => loadErpKeys(ids, { em: em as never }));

    expect(em.find).toHaveBeenCalledOnce();
    expect(em.find).toHaveBeenCalledWith(ExampleErpOrganizationKey, { organizationId: { $in: ids } });
    expect(seen).toEqual([tenant]);
    expect([...values]).toEqual([[ORGANIZATION_ID, { erpKey: 'SAP-0042' }]]);
  });

  it('asks nothing for no ids', async () => {
    const em = { find: vi.fn() };
    expect((await loadErpKeys([], { em: em as never })).size).toBe(0);
    expect(em.find).not.toHaveBeenCalled();
  });
});

/**
 * US9 / `data-model.md` §7 — the same module promoted to an installed package
 * keeps its id and its migration class names, so a database migrated with the
 * overlay records no pending migration and no lost one. The package half is
 * assembled exactly as an installed package's contribution reaches the merge
 * (`test/helpers/acme-links-instance.ts`): the module's own migration classes,
 * origin `external`, under its manifest id.
 */
describe('promotion to a package keeps every name (US9)', () => {
  async function overlayChain(): Promise<readonly string[]> {
    const { ownership } = await configuredMigrations({ ...process.env, DEPLOYMENT: 'example' });
    return ownership.migrationNamesFor(MODULE_ID) ?? [];
  }

  async function packageChain(): Promise<{ names: readonly string[]; owned: readonly string[] }> {
    const overlay = await configuredMigrations({ ...process.env, DEPLOYMENT: 'example' });
    const own = new Set(overlay.ownership.migrationNamesFor(MODULE_ID) ?? []);
    // The classes overlay discovery read from `migrations/`, file by file —
    // the ones a package's `./migrations` array would export.
    const classes = (overlay.overlays.find((contribution) => contribution.id === MODULE_ID)?.migrations ?? []).map(
      (entry) => entry.cls,
    );
    expect(classes).toHaveLength(own.size);
    const platformEntries = PLATFORM_MIGRATION_ENTRIES.filter(
      (entry) => !MIGRATION_REGISTRY.some((core) => core.cls === entry.cls),
    );
    const promoted = configuredMigrationsFrom({
      coreEntries: [...MIGRATION_REGISTRY, ...platformEntries],
      coreModuleDependencies: committedModuleDependencies(DISCOVERED_MANIFESTS),
      packages: [
        {
          id: manifest.id,
          packageName: '@acme/mod-example-erp-keys',
          version: manifest.version,
          migrationsDirectory: null,
          migrations: classes.map(
            (cls): MigrationRegistryEntry => ({ moduleId: manifest.id, cls: cls as never, origin: 'external' }),
          ),
          entities: erpKeysBackend.entities,
          dependencies: manifest.dependencies,
          schemaExtensions: [],
          entityExtensions: manifest.extends ?? [],
        },
      ],
      overlays: [],
      requiredModules: requiredModulesOf(DISCOVERED_MANIFESTS),
      coreEntityExtensions: DISCOVERED_MANIFESTS.map((entry) => ({
        moduleId: entry.id,
        origin: 'core' as const,
        dependencies: entry.manifest.dependencies ?? [],
        extends: entry.manifest.extends,
      })),
    });
    return {
      names: promoted.names.filter((name) => own.has(name)),
      owned: promoted.ownership.migrationNamesFor(MODULE_ID) ?? [],
    };
  }

  it('the overlay owns exactly its one migration, under the scaffold’s class name', async () => {
    expect(await overlayChain()).toEqual([
      expect.stringMatching(/^Migration\d{8}T\d{6}ExampleErpKeysCreateOrganizationKeys$/),
    ]);
  });

  it('as a package, the same id owns the same class names in the same order', async () => {
    const overlay = await overlayChain();
    const promoted = await packageChain();
    expect(promoted.owned).toEqual(overlay);
    expect(promoted.names).toEqual(overlay);
  });

  it('and the entity keeps its class name, which is what the side-table rules and the tenancy registry key on', () => {
    expect(erpKeysBackend.entities.map((entity) => entity.name)).toEqual(['ExampleErpOrganizationKey']);
  });
});
