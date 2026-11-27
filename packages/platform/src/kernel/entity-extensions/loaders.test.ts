import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EventBus } from '../../events/index.js';
import { composeModules } from '../compose.js';
import { createRootContainer } from '../container.js';
import { createModuleContext, createModuleRegistrationSink } from '../module-context.js';
import { EntityExtensionInvalidError } from './errors.js';
import type { EntityExtensionLoaderEntry } from './loaders.js';
import { EntityExtensionLoaderRegistry, entityExtensionDeclarationsFrom } from './registry.js';

/**
 * `specs/187-side-table-extensions/` T033 (FR-053) — the loader registry and
 * `ctx.entityExtensionLoaders`, `contracts/extension-attributes-read-ports.md`
 * §2: L1 `loader-without-extension`, L2 `duplicate-loader`, L3
 * `registration-after-seal`, and attribution to the registering module.
 */

const log = { info: () => {}, warn: () => {}, error: () => {} };

const DECLARATIONS = entityExtensionDeclarationsFrom([
  { id: 'organizations' },
  {
    id: 'acme_links',
    extends: [
      { entity: 'organizations.Organization', table: 'acme_links_organization_refs' },
      { entity: 'orders.Order', table: 'acme_links_order_notes' },
    ],
  },
]);

function loader(host: string, calls?: string[][]): EntityExtensionLoaderEntry<{ ref: string }> {
  return {
    host,
    schema: z.object({ ref: z.string() }),
    load: async (ids) => {
      calls?.push([...ids]);
      return new Map(ids.map((id) => [id, { ref: `R-${id}` }]));
    },
  };
}

function thrown(run: () => void): EntityExtensionInvalidError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EntityExtensionInvalidError);
    return error as EntityExtensionInvalidError;
  }
  throw new Error('expected a refusal');
}

describe('entityExtensionDeclarationsFrom', () => {
  it('reads every manifest’s extends, attributed to the manifest’s id', () => {
    expect(DECLARATIONS).toEqual([
      { moduleId: 'acme_links', entity: 'organizations.Organization', table: 'acme_links_organization_refs' },
      { moduleId: 'acme_links', entity: 'orders.Order', table: 'acme_links_order_notes' },
    ]);
  });
});

describe('EntityExtensionLoaderRegistry (§2)', () => {
  it('registers one loader per declared host, attributed to the module', () => {
    const registry = new EntityExtensionLoaderRegistry({ declarations: DECLARATIONS });
    const entry = loader('organizations.Organization');
    registry.register('acme_links', [entry]);
    registry.seal();
    const found = registry.loaderFor('acme_links', 'organizations.Organization');
    expect(found?.moduleId).toBe('acme_links');
    expect(found?.load).toBe(entry.load);
    expect(registry.loaderFor('acme_links', 'orders.Order')).toBeUndefined();
    expect(registry.loaderFor('other', 'organizations.Organization')).toBeUndefined();
  });

  it('L1 — refuses a loader on a host the module’s manifest does not extend', () => {
    const registry = new EntityExtensionLoaderRegistry({ declarations: DECLARATIONS });
    const error = thrown(() => registry.register('acme_links', [loader('projects.Project')]));
    expect(error.rule).toBe('loader-without-extension');
    expect(error.moduleId).toBe('acme_links');
    expect(error.entity).toBe('projects.Project');
    expect(error.message).toContain('extends');
    // A module that declares nothing has nothing to load.
    expect(thrown(() => registry.register('organizations', [loader('orders.Order')])).rule).toBe(
      'loader-without-extension',
    );
  });

  it('L2 — refuses a second loader for the same module and host, in one call or two', () => {
    const once = new EntityExtensionLoaderRegistry({ declarations: DECLARATIONS });
    expect(
      thrown(() =>
        once.register('acme_links', [loader('organizations.Organization'), loader('organizations.Organization')]),
      ).rule,
    ).toBe('duplicate-loader');
    const twice = new EntityExtensionLoaderRegistry({ declarations: DECLARATIONS });
    twice.register('acme_links', [loader('organizations.Organization')]);
    const error = thrown(() => twice.register('acme_links', [loader('organizations.Organization')]));
    expect(error.rule).toBe('duplicate-loader');
    expect(error.table).toBe('acme_links_organization_refs');
  });

  it('L3 — refuses a registration after the composition sealed the registry', () => {
    const registry = new EntityExtensionLoaderRegistry({ declarations: DECLARATIONS });
    registry.seal();
    expect(registry.isSealed).toBe(true);
    expect(thrown(() => registry.register('acme_links', [loader('orders.Order')])).rule).toBe(
      'registration-after-seal',
    );
  });
});

describe('ModuleContext.entityExtensionLoaders (§2)', () => {
  it("stamps the registering module's id, never one the entry names", () => {
    const registry = new EntityExtensionLoaderRegistry({ declarations: DECLARATIONS });
    const ctx = createModuleContext({
      module: { id: 'acme_links', version: '1.0.0' },
      container: createRootContainer(),
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log,
      entityExtensionLoaderRegistry: registry,
    });
    // An entry cannot answer for another module: an extra `moduleId` is ignored.
    ctx.entityExtensionLoaders([{ ...loader('organizations.Organization'), moduleId: 'organizations' } as never]);
    expect(registry.loaderFor('acme_links', 'organizations.Organization')?.moduleId).toBe('acme_links');
    expect(registry.loaderFor('organizations', 'organizations.Organization')).toBeUndefined();
  });

  it('refuses without a registry, naming the module', () => {
    const ctx = createModuleContext({
      module: { id: 'acme_links', version: '1.0.0' },
      container: createRootContainer(),
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log,
    });
    expect(() => ctx.entityExtensionLoaders([loader('organizations.Organization')])).toThrow(/acme_links/);
  });

  it('is sealed by composeModules; a late registration from a command context refuses (L3)', () => {
    const registry = new EntityExtensionLoaderRegistry({ declarations: DECLARATIONS });
    const calls: string[][] = [];
    const composed = composeModules(
      [
        { id: 'organizations', version: '1.0.0', registerModule: () => undefined },
        {
          id: 'acme_links',
          version: '1.0.0',
          registerModule: (ctx) => ctx.entityExtensionLoaders([loader('organizations.Organization', calls)]),
        },
      ],
      { container: createRootContainer(), eventBus: new EventBus(), log, entityExtensionLoaderRegistry: registry },
    );
    expect(registry.isSealed).toBe(true);
    // Registration resolved nothing and ran nothing.
    expect(calls).toEqual([]);
    const late = composed.contextFor('acme_links');
    let error: unknown;
    try {
      late.entityExtensionLoaders([loader('orders.Order')]);
    } catch (caught) {
      error = caught;
    }
    expect((error as EntityExtensionInvalidError).rule).toBe('registration-after-seal');
  });
});
