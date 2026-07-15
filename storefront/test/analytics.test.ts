import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GaStorefrontConfig } from '@b2b/contracts';
import { configureGa, trackGaEvent, sendPageView } from '../lib/analytics/gtag';
import { emitActionEvents } from '../lib/analytics/collector';
import { trackAddToCart } from '../lib/analytics/ecommerce';
import { installEnhancedMeasurement, trackSiteSearch } from '../lib/analytics/enhancedMeasurement';

/**
 * Feature 049 — storefront analytics logic tests (node env). Exercises the
 * gtag dispatch switch, custom-event field filtering, and Enhanced Ecommerce
 * gating without a DOM renderer.
 */

const baseConfig: GaStorefrontConfig = {
  enabled: true,
  measurementId: 'G-TEST',
  enhancedEcommerce: false,
  serverSide: false,
  requireConsent: false,
  customEvents: [],
};

let gtagSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  gtagSpy = vi.fn();
  (globalThis as Record<string, unknown>)['window'] = {
    gtag: gtagSpy,
    dataLayer: [],
    location: { href: 'http://x/', pathname: '/' },
  };
  (globalThis as Record<string, unknown>)['document'] = { cookie: '', title: 'T' };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['window'];
  delete (globalThis as Record<string, unknown>)['document'];
  vi.restoreAllMocks();
});

describe('gtag dispatch', () => {
  it('client mode sends events straight to gtag', () => {
    configureGa({ ...baseConfig, serverSide: false });
    trackGaEvent('add_to_cart', { value: 9 });
    expect(gtagSpy).toHaveBeenCalledWith('event', 'add_to_cart', { value: 9 });
  });

  it('server mode routes events to the /collect endpoint (no direct gtag)', async () => {
    const fetchSpy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 202 }));
    (globalThis as Record<string, unknown>)['fetch'] = fetchSpy;
    configureGa({ ...baseConfig, serverSide: true });
    trackGaEvent('add_to_cart', { value: 9 });
    await Promise.resolve();
    expect(gtagSpy).not.toHaveBeenCalledWith('event', 'add_to_cart', expect.anything());
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/api/v1/storefront/google-analytics/collect');
  });

  it('server mode forwards the visitor\'s real consent decision to /collect', async () => {
    const fetchSpy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 202 }));
    (globalThis as Record<string, unknown>)['fetch'] = fetchSpy;
    let stored: string | null = 'granted';
    (globalThis as Record<string, unknown>)['localStorage'] = {
      getItem: () => stored,
    };
    configureGa({ ...baseConfig, serverSide: true, requireConsent: true });

    trackGaEvent('add_to_cart', {});
    await Promise.resolve();
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string).consent).toEqual({
      analyticsStorage: 'granted',
    });

    stored = null; // no decision yet ⇒ denied
    trackGaEvent('add_to_cart', {});
    await Promise.resolve();
    expect(JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string).consent).toEqual({
      analyticsStorage: 'denied',
    });
    delete (globalThis as Record<string, unknown>)['localStorage'];
  });

  it('server mode enriches events with session_id + engagement_time_msec (pure MP)', async () => {
    const fetchSpy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 202 }));
    (globalThis as Record<string, unknown>)['fetch'] = fetchSpy;
    configureGa({ ...baseConfig, serverSide: true, requireConsent: false });
    trackGaEvent('add_to_cart', { value: 5 });
    await Promise.resolve();
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.clientId).toBeTruthy();
    expect(body.events[0].params.session_id).toBeTruthy();
    expect(body.events[0].params.engagement_time_msec).toBe(100);
    expect(body.events[0].params.value).toBe(5);
  });

  it('emits nothing when the module is disabled', () => {
    configureGa({ ...baseConfig, enabled: false, measurementId: null });
    sendPageView('/p/1');
    trackGaEvent('add_to_cart', {});
    expect(gtagSpy).not.toHaveBeenCalled();
  });
});

describe('custom-event collector', () => {
  it('emits only the selected fields, omitting absent ones', () => {
    configureGa({
      ...baseConfig,
      customEvents: [
        {
          eventName: 'lead',
          triggerAction: 'add_to_cart',
          buttonId: null,
          fields: [
            { fieldKey: 'sku', payloadKey: 'sku' },
            { fieldKey: 'price', payloadKey: 'unit_price' },
          ],
        },
      ],
    });
    emitActionEvents('add_to_cart', { sku: 'X1', quantity: 3 /* price absent */ });
    expect(gtagSpy).toHaveBeenCalledWith('event', 'lead', { sku: 'X1' });
  });

  it('does not fire custom events bound to other actions', () => {
    configureGa({
      ...baseConfig,
      customEvents: [
        { eventName: 'lead', triggerAction: 'place_order_clicked', buttonId: null, fields: [] },
      ],
    });
    emitActionEvents('add_to_cart', { sku: 'X1' });
    expect(gtagSpy).not.toHaveBeenCalled();
  });
});

describe('Enhanced Measurement (server-side replication)', () => {
  type Handlers = Record<string, (e: unknown) => void>;

  function installWithDom(): Handlers {
    const handlers: Handlers = {};
    const add = (type: string, fn: (e: unknown) => void): void => {
      handlers[type] = fn;
    };
    (globalThis as Record<string, unknown>)['window'] = {
      addEventListener: add,
      removeEventListener: () => {},
      location: { href: 'https://shop.test/', pathname: '/' },
      scrollY: 0,
      gtag: gtagSpy,
      dataLayer: [],
    };
    (globalThis as Record<string, unknown>)['document'] = {
      addEventListener: add,
      removeEventListener: () => {},
      documentElement: { scrollHeight: 1000, clientHeight: 500 },
      cookie: '',
      title: 'T',
    };
    configureGa({ ...baseConfig, serverSide: false }); // route to gtag spy for assertions
    installEnhancedMeasurement();
    return handlers;
  }

  const anchorEvent = (href: string, text = 'link') => ({
    target: {
      closest: (sel: string) =>
        sel === 'a' ? { getAttribute: (n: string) => (n === 'href' ? href : null), textContent: text } : null,
    },
  });

  it('emits an outbound click for an external link', () => {
    const h = installWithDom();
    h['click']!(anchorEvent('https://external.test/page', 'Ext'));
    expect(gtagSpy).toHaveBeenCalledWith(
      'event',
      'click',
      expect.objectContaining({ link_domain: 'external.test', outbound: true }),
    );
  });

  it('emits file_download for a file link', () => {
    const h = installWithDom();
    h['click']!(anchorEvent('https://shop.test/files/manual.pdf'));
    expect(gtagSpy).toHaveBeenCalledWith(
      'event',
      'file_download',
      expect.objectContaining({ file_name: 'manual.pdf', file_extension: 'pdf' }),
    );
  });

  it('emits form_submit with form params', () => {
    const h = installWithDom();
    h['submit']!({
      target: {
        tagName: 'FORM',
        id: 'contact',
        getAttribute: (n: string) => (n === 'name' ? 'contactForm' : null),
        action: 'https://shop.test/kontakt',
      },
    });
    expect(gtagSpy).toHaveBeenCalledWith(
      'event',
      'form_submit',
      expect.objectContaining({ form_id: 'contact', form_name: 'contactForm' }),
    );
  });

  it('emits view_search_results from a search query', () => {
    configureGa({ ...baseConfig, serverSide: false });
    trackSiteSearch('q=drill&page=2');
    expect(gtagSpy).toHaveBeenCalledWith('event', 'view_search_results', { search_term: 'drill' });
  });
});

describe('Enhanced Ecommerce gating', () => {
  it('suppresses the GA4 add_to_cart event when Enhanced Ecommerce is off', () => {
    configureGa({ ...baseConfig, enhancedEcommerce: false });
    trackAddToCart({ sku: 'X1', name: 'Widget', price: 9, quantity: 1, currency: 'EUR' });
    expect(gtagSpy).not.toHaveBeenCalledWith('event', 'add_to_cart', expect.anything());
  });

  it('emits the GA4 add_to_cart event when Enhanced Ecommerce is on', () => {
    configureGa({ ...baseConfig, enhancedEcommerce: true });
    trackAddToCart({ sku: 'X1', name: 'Widget', price: 9, quantity: 2, currency: 'EUR' });
    expect(gtagSpy).toHaveBeenCalledWith(
      'event',
      'add_to_cart',
      expect.objectContaining({ currency: 'EUR', value: 18 }),
    );
  });
});
