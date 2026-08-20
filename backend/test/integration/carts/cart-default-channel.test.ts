import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 053 — FR-010: a null-channel cart/quote must not reach pricing or
 * checkout with a null channel (the old silent no-op). This is enforced by
 * construction: CartService assigns the system-default channel at cart creation
 * (`#defaultSalesChannelId`), so every cart carries a concrete channel by the
 * time its promotion/pricing snapshot is built — the promotion gate and price
 * rule dimension always receive a real `salesChannelId`.
 */
describe('cart carries a concrete sales channel at creation (feature 053 / FR-010)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('assigns the system-default channel to a freshly created guest cart — never null', async () => {
    const cartService = h.cartService();
    expect(cartService).not.toBeNull();

    const def = await h.salesChannels.resolver.getSystemDefault();
    expect(def).not.toBeNull();

    const cart = await cartService!.getOrCreateForAnon(h.em(), 'fr010-anon-token');
    expect(cart.salesChannelId).toBe(def.id);
    expect(cart.salesChannelId).not.toBeNull();
  });
});
