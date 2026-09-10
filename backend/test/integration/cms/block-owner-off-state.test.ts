import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FROZEN_BLOCK_RENAMES,
  renameBlockNames,
} from '@endora-commerce/page-builder-core/migration';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  registerTestExtension,
  TEST_EXTENSION_COMPONENT_NAME,
  TEST_EXTENSION_MODULE_CODE,
} from '../../fixtures/cms/test-extension-module.js';

/**
 * Feature 096, T603/T604/T605 — the switch-off / switch-on round trip for a
 * block whose owning module goes away (User Story 4, FR-019/FR-020, SC-006).
 *
 * This is the half that drives a **real** module switch. The two rendering
 * halves are `storefront/test/ssr/block-degradation.test.tsx` and
 * `admin/test/modules/cms/block-degradation.test.tsx`; neither can reach the
 * lifecycle registry, and this file cannot render React, so the three are
 * deliberately three.
 *
 * ## What this file asserts that an off-state test cannot
 *
 * Constitution XVII item 6's five surfaces are asserted for these modules
 * already — `backend/test/integration/{cms,invoices,ksef}/off-state.test.ts`,
 * each through `expectModuleAbsent`, which is the argument
 * `check:off-state-coverage` keys on. They are not repeated here: two
 * derivations of one claim are two answers waiting to disagree, and the cms
 * off-state file makes the same choice about the palette action.
 *
 * The surface **none** of them can see is the block. A block is not a route, a
 * setting or a permission: it is a name inside a `jsonb` column that outlives
 * every switch, so "absent" for it means *withdrawn from the palette while the
 * stored node is left exactly where it is*. Getting that wrong in either
 * direction is a defect item 6's sweep reports as a clean pass — a palette that
 * keeps offering a switched-off module's blocks, and a resolver that "cleans"
 * the node away and takes the operator's content with it.
 *
 * ## Two owners, because they answer different halves
 *
 * `ksef` is a real, deactivatable, block-owning module and is the subject of the
 * descriptor assertions. It is also the one whose block a seeded document
 * genuinely carries: `invoices`' generic invoice template seeds
 * `ksef.InvoiceSection`, deliberately, and that is the accepted cost recorded in
 * T505 rather than something to repair.
 *
 * `test_ext` is the synthetic CMS-context owner, seeded into the registry cache
 * in the shape `check:off-state-coverage` recognises for a module a test builds
 * for itself. It exists because **no real module in this tree owns a
 * deactivatable CMS-context block**: the CMS palette is `cms`' own 30 blocks and
 * `catalog`'s five, and `catalog` is `nonDeactivatable` while switching `cms`
 * off takes the page routes with it, so there would be no page left to render.
 * That is the honest caveat `plan.md` records — for a `nonDeactivatable` owner
 * the gain from namespacing is legibility and collision safety, not degradation
 * — and it is why the end-to-end round trip needs a synthetic owner to have a
 * subject at all.
 */

/**
 * A name no module declares. The migration leaves it byte-identical (FR-014)
 * and every rendering surface treats it exactly as an absent owner (FR-020);
 * that it is *genuinely* unrecognised is asserted below rather than assumed,
 * because a fixture that had quietly become a real name would make the whole
 * third-cause assertion vacuous.
 */
const UNRECOGNISED_NAME = 'LegacyPromoBanner';

/**
 * The synthetic owner's id, written as a literal on purpose.
 *
 * `check:off-state-coverage` keys on the **argument** of `withModuleOff` and
 * `expectModuleAbsent` and refuses one it cannot read as a literal — an
 * unreadable subject taken for "some module is covered" is the direction that
 * agrees with the defect (issue #113). The same goes for the registry seeding
 * that excuses a module a test builds for itself. So the id is spelled here and
 * reconciled against the fixture's own export below, which is what keeps the
 * copy from becoming a second answer.
 */
const TEST_EXTENSION_ID = 'test_ext';

describe('a block whose owning module is switched off (FR-019, FR-020, SC-006)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let channelCode: string;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
    channelCode = channel.code;
    registerTestExtension(h.cms.pageBuilderRegistry);
    // The literal is inside the seeding call on purpose: `check:off-state-coverage`
    // derives the synthetic-module exemption from this file's own
    // `__setEnabledForTesting` arguments, read as literals, and fails closed on
    // ids that arrive through a name it cannot read.
    registryCache.__setEnabledForTesting([...registryCache.enabledIds(), 'test_ext']);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function descriptorNames(): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/page-builder/config',
      cookies: admin,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { components: Array<{ name: string }> } };
    return body.data.components.map((component) => component.name);
  }

  async function sectionKeys(): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/cms/page-builder/config',
      cookies: admin,
    });
    const body = res.json() as { data: { categories?: Array<{ key: string }> } };
    return (body.data.categories ?? []).map((category) => category.key);
  }

  it('spells the synthetic owner’s id as the fixture declares it', () => {
    expect(TEST_EXTENSION_ID).toBe(TEST_EXTENSION_MODULE_CODE);
    expect(TEST_EXTENSION_COMPONENT_NAME.startsWith(`${TEST_EXTENSION_ID}.`)).toBe(true);
  });

  it('the fixture name is genuinely unrecognised (T605)', async () => {
    // FR-014's population is *names the migration does not know*, and the only
    // way to be in it is to be in neither the frozen map's domain nor its
    // codomain nor any manifest. Asserted, because the fixture is what makes
    // every other unrecognised-name assertion in this feature mean anything.
    expect(Object.keys(FROZEN_BLOCK_RENAMES)).not.toContain(UNRECOGNISED_NAME);
    expect(Object.values(FROZEN_BLOCK_RENAMES)).not.toContain(UNRECOGNISED_NAME);
    expect([...h.cms.pageBuilderRegistry.knownNames()]).not.toContain(UNRECOGNISED_NAME);
    expect(await descriptorNames()).not.toContain(UNRECOGNISED_NAME);
  });

  it('the migration leaves an unrecognised name byte-identical (T605, FR-014)', () => {
    const document = {
      root: { props: {} },
      content: [
        { type: 'Hero', props: { id: 'a', headline: 'Renamed' } },
        { type: UNRECOGNISED_NAME, props: { id: 'b', headline: 'Left alone' } },
      ],
    };
    const result = renameBlockNames(document, FROZEN_BLOCK_RENAMES);
    const content = (result.value as typeof document).content;

    // The recognised sibling moves and the unrecognised name does not — which
    // is why an unrecognised name reaches the rendering surfaces at all, and so
    // why FR-020's third cause exists.
    expect(content[0]!.type).toBe(FROZEN_BLOCK_RENAMES['Hero']);
    expect(content[1]).toEqual(document.content[1]);
    expect(result.renamed).toBe(1);
  });

  it('withdraws a switched-off owner’s blocks from the palette and restores them (T604)', async () => {
    expect(await descriptorNames()).toContain('ksef.InvoiceSection');

    // Axis 1 — the operator switched it off and the platform still offers it.
    // This is the case Constitution XVII names, and it is the one an operator
    // creates: `ksef` ships with its activation control defaulting to `false`,
    // so a shop that has not enrolled in KSeF is in exactly this state.
    await withModuleOff('ksef', 'deactivated', async () => {
      expect(await descriptorNames()).not.toContain('ksef.InvoiceSection');
      // The section `ksef` joins is `invoices`', so it survives its joiner.
      expect(await sectionKeys()).toContain('invoice');
    });
    expect(await descriptorNames()).toContain('ksef.InvoiceSection');

    // Axis 2 — the deployment does not offer the module at all.
    await withModuleOff('ksef', 'platform-unavailable', async () => {
      expect(await descriptorNames()).not.toContain('ksef.InvoiceSection');
    });
    expect(await descriptorNames()).toContain('ksef.InvoiceSection');
  });

  it('keeps the stored document byte-identical across the round trip (T603, SC-006)', async () => {
    const slug = `block-owner-off-${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: admin,
      payload: JSON.stringify({
        name: 'Block owner off-state page',
        slug,
        active: true,
        salesChannelIds: [channelId],
        languages: ['en-US'],
      }),
    });
    expect(created.statusCode).toBe(201);
    const page = (created.json() as { data: { id: string; version: number } }).data;

    const tree = {
      root: { props: {} },
      content: [
        { type: 'cms.Heading', props: { id: 'kept', text: 'Still here' } },
        { type: TEST_EXTENSION_COMPONENT_NAME, props: { id: 'gone', title: 'Heads up', tone: 'warning' } },
        { type: UNRECOGNISED_NAME, props: { id: 'legacy', headline: 'Left alone' } },
      ],
    };
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: admin,
      payload: JSON.stringify({ data: tree, version: page.version }),
    });
    expect(put.statusCode).toBe(200);
    const published = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${page.id}/publish`,
      cookies: admin,
    });
    expect(published.statusCode).toBe(200);

    const resolve = async (): Promise<string> => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
        headers: { 'x-sales-channel': channelCode },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { content: { data: unknown } } };
      return JSON.stringify(body.data.content.data);
    };

    const before = await resolve();
    expect(await descriptorNames()).toContain(TEST_EXTENSION_COMPONENT_NAME);

    await withModuleOff('test_ext', 'deactivated', async () => {
      // The palette withdraws the block…
      expect(await descriptorNames()).not.toContain(TEST_EXTENSION_COMPONENT_NAME);
      // …and the resolver does not. A "clean-up" here would be the operator's
      // content deleted by a switch that Constitution XVII says is
      // non-destructive and reversible, and the props are the only thing that
      // can make the block come back as it was.
      expect(await resolve()).toBe(before);
    });

    expect(await descriptorNames()).toContain(TEST_EXTENSION_COMPONENT_NAME);
    expect(await resolve()).toBe(before);
    // FR-020's third cause never appears in the palette in any of the three
    // states, and never leaves the document either.
    expect(before).toContain(UNRECOGNISED_NAME);
  });
});
