import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetaStorefrontConfig } from '@b2b/contracts';
import {
  configureMeta,
  isMetaConfigured,
  resetMetaForTesting,
  trackMetaEvent,
} from '../lib/analytics/meta/pixel';
import { CONSENT_STORAGE_KEY } from '../lib/analytics/consent';

/**
 * Feature 064 — the gates that decide whether a Meta event is reported, and the
 * additive relationship between standard and custom events.
 */

const baseConfig: MetaStorefrontConfig = {
  enabled: true,
  pixelId: '9876543210',
  requireConsent: false,
  customEvents: [],
};

let fbq: ReturnType<typeof vi.fn>;
const store = new Map<string, string>();

beforeEach(() => {
  resetMetaForTesting();
  store.clear();
  fbq = vi.fn();
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { fbq: unknown }).fbq = fbq;
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

afterEach(() => {
  delete (globalThis as unknown as { fbq?: unknown }).fbq;
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe('Meta event dispatch', () => {
  it("reports Meta's standard event for an action", () => {
    configureMeta(baseConfig);
    trackMetaEvent('purchase', { value: 10, currency: 'PLN' });
    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', { value: 10, currency: 'PLN' });
  });

  it('reports nothing standard for an action Meta has no standard name for', () => {
    configureMeta(baseConfig);
    trackMetaEvent('add_to_shopping_list');
    expect(fbq).not.toHaveBeenCalled();
  });

  it('adds a custom event without suppressing the standard one', () => {
    // The whole point of the additive rule: an operator adding an audience
    // event must not silently lose their Purchase reporting.
    configureMeta({
      ...baseConfig,
      customEvents: [{ triggerAction: 'purchase', eventName: 'BigOrder' }],
    });
    trackMetaEvent('purchase', { value: 10, currency: 'PLN' });
    expect(fbq).toHaveBeenCalledTimes(2);
    expect(fbq).toHaveBeenNthCalledWith(1, 'track', 'Purchase', { value: 10, currency: 'PLN' });
    expect(fbq).toHaveBeenNthCalledWith(2, 'trackCustom', 'BigOrder', {
      value: 10,
      currency: 'PLN',
    });
  });

  it('reports a custom event for an action with no standard equivalent', () => {
    configureMeta({
      ...baseConfig,
      customEvents: [{ triggerAction: 'add_to_shopping_list', eventName: 'Wishlisted' }],
    });
    trackMetaEvent('add_to_shopping_list');
    expect(fbq).toHaveBeenCalledOnce();
    expect(fbq).toHaveBeenCalledWith('trackCustom', 'Wishlisted', {});
  });

  it('ignores a custom event bound to a different action', () => {
    configureMeta({
      ...baseConfig,
      customEvents: [{ triggerAction: 'add_to_cart', eventName: 'Carted' }],
    });
    trackMetaEvent('purchase');
    expect(fbq).toHaveBeenCalledOnce();
    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', {});
  });

  it('stays silent while the channel is untracked', () => {
    configureMeta({ ...baseConfig, enabled: false });
    trackMetaEvent('purchase');
    expect(isMetaConfigured()).toBe(false);
    expect(fbq).not.toHaveBeenCalled();
  });

  it('treats a null pixel id as untracked', () => {
    configureMeta({ ...baseConfig, pixelId: null });
    trackMetaEvent('purchase');
    expect(fbq).not.toHaveBeenCalled();
  });

  it('stays silent until consent is granted when the channel requires it', () => {
    configureMeta({ ...baseConfig, requireConsent: true });

    trackMetaEvent('purchase');
    expect(fbq).not.toHaveBeenCalled();

    store.set(CONSENT_STORAGE_KEY, 'denied');
    trackMetaEvent('purchase');
    expect(fbq).not.toHaveBeenCalled();

    store.set(CONSENT_STORAGE_KEY, 'granted');
    trackMetaEvent('purchase');
    expect(fbq).toHaveBeenCalledOnce();
  });
});
