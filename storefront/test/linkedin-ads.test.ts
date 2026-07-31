import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedInStorefrontConfig } from '@b2b/contracts';
import {
  configureLinkedIn,
  isLinkedInConfigured,
  resetLinkedInForTesting,
  trackLinkedInConversions,
} from '../lib/analytics/linkedin/tag';
import { CONSENT_STORAGE_KEY } from '../lib/analytics/consent';

/**
 * Feature 063 — the gates that decide whether a LinkedIn conversion is reported
 * at all: channel configured, consent granted, and browser-vs-server transport.
 */

const baseConfig: LinkedInStorefrontConfig = {
  enabled: true,
  partnerId: '1234567',
  requireConsent: false,
  serverSide: false,
  conversionMappings: [
    { triggerAction: 'purchase', conversionId: '111' },
    { triggerAction: 'add_to_cart', conversionId: '222' },
  ],
};

let lintrk: ReturnType<typeof vi.fn>;
const store = new Map<string, string>();

beforeEach(() => {
  resetLinkedInForTesting();
  store.clear();
  lintrk = vi.fn();
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { lintrk: unknown }).lintrk = lintrk;
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

afterEach(() => {
  delete (globalThis as unknown as { lintrk?: unknown }).lintrk;
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe('LinkedIn conversion dispatch', () => {
  it('reports every mapping bound to the action, and nothing else', () => {
    configureLinkedIn(baseConfig);
    trackLinkedInConversions('purchase');
    expect(lintrk).toHaveBeenCalledTimes(1);
    expect(lintrk).toHaveBeenCalledWith('track', { conversion_id: '111' });
  });

  it('reports nothing for an action with no mapping', () => {
    configureLinkedIn(baseConfig);
    trackLinkedInConversions('begin_checkout');
    expect(lintrk).not.toHaveBeenCalled();
  });

  it('reports every mapping when one action maps more than once', () => {
    configureLinkedIn({
      ...baseConfig,
      conversionMappings: [
        { triggerAction: 'purchase', conversionId: '111' },
        { triggerAction: 'purchase', conversionId: '333' },
      ],
    });
    trackLinkedInConversions('purchase');
    expect(lintrk.mock.calls.map((c) => c[1])).toEqual([
      { conversion_id: '111' },
      { conversion_id: '333' },
    ]);
  });

  it('stays silent while the channel is untracked', () => {
    configureLinkedIn({ ...baseConfig, enabled: false });
    trackLinkedInConversions('purchase');
    expect(isLinkedInConfigured()).toBe(false);
    expect(lintrk).not.toHaveBeenCalled();
  });

  it('treats a null partner id as untracked', () => {
    configureLinkedIn({ ...baseConfig, partnerId: null });
    trackLinkedInConversions('purchase');
    expect(lintrk).not.toHaveBeenCalled();
  });

  it('stays silent until consent is granted when the channel requires it', () => {
    configureLinkedIn({ ...baseConfig, requireConsent: true });

    trackLinkedInConversions('purchase');
    expect(lintrk).not.toHaveBeenCalled();

    store.set(CONSENT_STORAGE_KEY, 'denied');
    trackLinkedInConversions('purchase');
    expect(lintrk).not.toHaveBeenCalled();

    store.set(CONSENT_STORAGE_KEY, 'granted');
    trackLinkedInConversions('purchase');
    expect(lintrk).toHaveBeenCalledTimes(1);
  });

  it('suppresses the browser path when the channel reports server-side', () => {
    // Each conversion has exactly one transport, so the backend owning it means
    // the browser must not also fire.
    configureLinkedIn({ ...baseConfig, serverSide: true });
    trackLinkedInConversions('purchase');
    expect(lintrk).not.toHaveBeenCalled();
  });
});
