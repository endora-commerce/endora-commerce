import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { AssetReferenceRegistry } from '../../../src/modules/assets_library/services/reference-registry.js';
import { LanguageReferenceRegistry } from '../../../src/modules/languages/services/language-reference-registry.js';

/**
 * Issue #146 / D-68 — `blog`'s boot hook was **mixed**, and one probe at the top
 * of it would have been the wrong repair.
 *
 * The hook did three things: it registered `blog`'s two asset-reference
 * descriptors into `assets_library`' registry, then seeded the Default category
 * and the two blog roles. The last two are work — a switched-off module writing
 * rows at every boot, which is Constitution XVII failing. The first is an
 * *integrity contribution*: `assets_library` consults the registry before every
 * soft-delete, and a switched-off `blog`'s posts still embed assets. Probing the
 * combined hook would have stopped the scanner too, and an operator could then
 * delete an asset a deactivated post references — data damage discovered at
 * reactivation.
 *
 * So the hook is split: the contribution runs always, the seeds run only when
 * the module is present. Both halves are asserted here, because "add a presence
 * check at the top" applied to a mixed hook is a regression rather than a fix.
 * `test/integration/blog/asset-reference-while-off.test.ts` proves the
 * consequence end to end, against the database.
 */

const seedDefaultCategory = vi.fn(async () => undefined);
const seedBlogRoles = vi.fn(async () => undefined);

vi.mock('../../../../packages/modules/blog/src/backend/services/seed-default-category.js', () => ({
  seedDefaultCategory: (...args: unknown[]) => seedDefaultCategory(...(args as [])),
}));
vi.mock('../../../../packages/modules/blog/src/backend/services/seed-roles.js', () => ({
  seedBlogRoles: (...args: unknown[]) => seedBlogRoles(...(args as [])),
}));

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

interface Composed {
  runBootHooks: () => Promise<void>;
  assetReferenceRegistry: AssetReferenceRegistry;
  languageReferenceRegistry: LanguageReferenceRegistry;
}

async function composeBlog(): Promise<Composed> {
  const { registerModule } = await import('../../../../packages/modules/blog/src/backend/index.js');
  const container = createRootContainer();
  const assetReferenceRegistry = new AssetReferenceRegistry();
  // What the hooks reach, and nothing more: no database connection, no Redis
  // client, no route surface.
  // `languages` owns `languageReferenceRegistry` and is not composed here, so
  // the root supplies it exactly as it supplies `assets_library`'. The same
  // shape of contribution: a deactivated post still carries a language code, so
  // `languages` must still refuse to delete one out from under it (feature 077,
  // D-87).
  const languageReferenceRegistry = new LanguageReferenceRegistry();
  registerValues(container, {
    emFactory: (): EntityManager => ({}) as EntityManager,
    redis: undefined,
    assetReferenceRegistry,
    languageReferenceRegistry,
  });
  const composed = composeModules([{ id: 'blog', version: '1.0.0', registerModule }], {
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

describe('blog boot hooks: the seeds are probed, the asset scanner is not', () => {
  beforeEach(() => {
    seedDefaultCategory.mockClear();
    seedBlogRoles.mockClear();
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(() => {
    // The cache is a process singleton and the suite shares one fork.
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  it('seeds nothing while the module is off', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['blog'] });
    expect(effectiveState.isPresent('blog'), 'the fixture did not switch the module off').toBe(
      false,
    );

    const { runBootHooks } = await composeBlog();
    await runBootHooks();

    expect(
      seedDefaultCategory,
      'a switched-off module wrote its Default category at boot',
    ).not.toHaveBeenCalled();
    expect(seedBlogRoles, 'a switched-off module wrote its roles at boot').not.toHaveBeenCalled();
  });

  it('still registers its asset-reference scanners while off — integrity is not a surface', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['blog'] });

    const { runBootHooks, assetReferenceRegistry } = await composeBlog();
    await runBootHooks();

    expect(
      assetReferenceRegistry.owners().filter((owner) => owner === 'blog'),
      'the contribution was probed along with the seeds, so an operator can now delete ' +
        'an asset a deactivated post still embeds',
    ).toHaveLength(2);
  });

  it('seeds again once the module is back on', async () => {
    const { runBootHooks, assetReferenceRegistry } = await composeBlog();
    await runBootHooks();

    expect(seedDefaultCategory).toHaveBeenCalledTimes(1);
    expect(seedBlogRoles).toHaveBeenCalledTimes(1);
    expect(assetReferenceRegistry.owners()).toHaveLength(2);
  });
});
