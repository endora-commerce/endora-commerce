import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { AssetReferenceRegistry } from '../../../src/modules/assets_library/services/reference-registry.js';
import { LanguageReferenceRegistry } from '../../../../packages/modules/languages/src/backend/services/language-reference-registry.js';

/**
 * Issue #146 / D-68 — `cms`' boot hook was **mixed**, exactly like `blog`'s.
 *
 * It reconciled the seeded Hooks — a write — and then pushed the CMS
 * asset-reference scanner into `assets_library`' registry. The reconcile is work
 * a switched-off module must not do; the scanner is an integrity contribution
 * that must keep running, because a deactivated page, block or template still
 * embeds assets and `assets_library` asks the registry before every soft-delete.
 * One probe at the top of the combined hook would have stopped both, and the
 * damage — an asset deleted out from under a deactivated page — would only be
 * discovered at reactivation.
 *
 * `test/integration/cms/asset-reference-while-off.test.ts` proves the
 * consequence against the database; this file pins the split itself.
 */

const reconcile = vi.fn(async () => undefined);

// The module under test is `backend.ts`, not the CMS engine: the plugin is
// stubbed so the boot hooks meet a handle whose `reconcile` records whether it
// was called, with no Redis client and no Postgres connection built.
// A `vi.mock` specifier is a module path a rewrite of import specifiers does
// not see, and a mock that stops applying is silent in the direction that
// matters: the off-state assertion still passed, because the probe returns
// before the plugin is reached, and only the on-state one met the real
// reconciler against a stub EntityManager (feature 080, T040b).
vi.mock('../../../../packages/modules/cms/src/backend/plugin.js', () => ({
  cmsModule: () => ({
    handle: {
      reconcile,
      referenceRegistry: {},
      pageBuilderRegistry: { getBreakpoints: () => ({ tabletMin: 768, desktopMin: 1024 }) },
      setPageBuilderBreakpointsResolver: () => undefined,
      setColorPaletteResolver: () => undefined,
      setColorPaletteWriter: () => undefined,
      setAssetResolver: () => undefined,
    },
    plugin: async () => undefined,
  }),
}));

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

interface Composed {
  runBootHooks: () => Promise<void>;
  assetReferenceRegistry: AssetReferenceRegistry;
  languageReferenceRegistry: LanguageReferenceRegistry;
}

async function composeCms(): Promise<Composed> {
  const { registerModule } = await import('../../../../packages/modules/cms/src/backend/index.js');
  const container = createRootContainer();
  const assetReferenceRegistry = new AssetReferenceRegistry();
  // `languages` owns this one and is not composed here, so the root supplies
  // it exactly as it supplies `assets_library`'. Same shape of contribution:
  // a deactivated page still carries language codes, so `languages` must still
  // refuse to delete one out from under it (feature 077, D-87).
  const languageReferenceRegistry = new LanguageReferenceRegistry();
  registerValues(container, {
    emFactory: (): EntityManager => ({}) as EntityManager,
    redis: {} as Redis,
    assetReferenceRegistry,
    languageReferenceRegistry,
  });
  const composed = composeModules([{ id: 'cms', version: '1.0.0', registerModule }], {
    container,
    eventBus: new EventBus(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  return {
    runBootHooks: () => composed.runBootHooks(),
    assetReferenceRegistry,
    languageReferenceRegistry,
  };
}

describe('cms boot hooks: the Hook reconcile is probed, the asset scanner is not', () => {
  beforeEach(() => {
    reconcile.mockClear();
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  it('reconciles nothing while the module is off', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['cms'] });
    expect(effectiveState.isPresent('cms'), 'the fixture did not switch the module off').toBe(
      false,
    );

    const { runBootHooks } = await composeCms();
    await runBootHooks();

    expect(
      reconcile,
      'a switched-off module reconciled its seeded Hooks at boot',
    ).not.toHaveBeenCalled();
  });

  it('still registers its asset-reference scanner while off — integrity is not a surface', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['cms'] });

    const { runBootHooks, assetReferenceRegistry, languageReferenceRegistry } =
      await composeCms();
    await runBootHooks();

    expect(
      assetReferenceRegistry.owners(),
      'the contribution was probed along with the reconcile, so an operator can now ' +
        'delete an asset a deactivated page still embeds',
    ).toContain('cms');
    expect(
      languageReferenceRegistry.owners(),
      'the language scanner was probed too, so an operator can now delete a language a ' +
        'deactivated page still lists',
    ).toContain('cms');
  });

  it('reconciles again once the module is back on', async () => {
    const { runBootHooks, assetReferenceRegistry } = await composeCms();
    await runBootHooks();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(assetReferenceRegistry.owners()).toContain('cms');
  });
});
