import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Feature 075 — the criteria scan fails closed when `catalog` is absent.
 *
 * Until the cut, `ProductSelectionService` compiled the operator's rule into a
 * MikroORM `where` object and ran it with `em.find(Product, where as never)`.
 * That is a query against `catalog`'s table, and a deactivation drops no
 * tables — so an operator who switched `catalog` off still got a criteria
 * preview, assembled from a module the platform was refusing every other
 * request into, and a scheduled run would have gone on publishing a feed from
 * it.
 *
 * The scan is `catalogProductFilterPort` now. `catalog` is a **binding**
 * dependency of this manifest, so there is nothing to degrade to and the answer
 * is the 503 `MODULE_DISABLED` envelope: a feed file assembled from a catalogue
 * the platform will not serve is worse than a preview that says why it cannot
 * answer.
 *
 * Absence is driven on the **platform** axis, for the reason
 * `price_lists/absent-owner-refuses.test.ts` records: `catalog` is core, so
 * `effectiveState` forces its operator axis to `true` and a seeded deactivation
 * would pass while the module was present the whole time.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const URL = '/api/v1/admin/feed-previews/selection';

describe('product_feeds — an absent `catalog` refuses the selection scan [integration]', () => {
  let h: BackendServerHandle;
  let channelId: string;

  const preview = async (): Promise<
    Awaited<ReturnType<BackendServerHandle['app']['inject']>>
  > =>
    h.app.inject({
      method: 'POST',
      url: URL,
      ...ADMIN,
      payload: { salesChannelId: channelId, selectionRule: { kind: 'all' } },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
  }, 60_000);

  afterEach(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  it('answers the criteria preview while `catalog` is present', async () => {
    const res = await preview();

    expect(res.statusCode).toBe(200);
  });

  it('refuses the criteria preview while `catalog` is absent', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'catalog'));

    const res = await preview();

    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
  });

  it('answers again once `catalog` is back', async () => {
    const res = await preview();

    expect(res.statusCode).toBe(200);
  });
});
