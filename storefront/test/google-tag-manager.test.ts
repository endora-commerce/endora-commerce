import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import {
  GTM_CLIENT_ONLY_EVENTS,
  GTM_DISABLED_CONFIG,
  GTM_RELAY_ELIGIBLE_EVENTS,
  type GtmRelayEligibleEvent,
  type GtmStorefrontConfig,
} from '@b2b/contracts';

/**
 * Feature 066 — Google Tag Manager.
 *
 * SSR-only harness (node env, `renderToString`, no jsdom/RTL), matching the
 * storefront's established convention: the container snippet is asserted from
 * render-derived output, and the dispatch/consent logic is asserted through the
 * pure functions the emitter exports.
 */

// `next/script` is a thin wrapper here; rendering it as a plain <script> keeps
// the assertions about the emitted snippet honest without pulling in Next's
// runtime.
vi.mock('next/script', () => ({
  default: ({
    id,
    src,
    children,
    strategy,
  }: {
    id?: string;
    src?: string;
    children?: string;
    strategy?: string;
  }): ReactNode =>
    typeof children === 'string'
      ? createElement('script', {
          id,
          'data-strategy': strategy,
          dangerouslySetInnerHTML: { __html: children },
        })
      : createElement('script', { id, src, 'data-strategy': strategy }),
}));

const { GoogleTagManager } = await import('../components/analytics/GoogleTagManager');
const {
  configureGtm,
  isGtmActive,
  gtmConsentGranted,
  pushGtmEvent,
  resolveGtmClientId,
  resetGtmForTesting,
  sendGtmPageView,
  sendGtmSearchResults,
} = await import('../lib/analytics/gtm/dataLayer');
const { CONSENT_STORAGE_KEY } = await import('../lib/analytics/consent');
const { configureGa } = await import('../lib/analytics/gtag');
const { configureMeta, resetMetaForTesting } = await import('../lib/analytics/meta/pixel');
const { configureLinkedIn, resetLinkedInForTesting } = await import(
  '../lib/analytics/linkedin/tag'
);
const ecommerce = await import('../lib/analytics/ecommerce');

const trackedConfig: GtmStorefrontConfig = {
  enabled: true,
  containerId: 'GTM-ABC1234',
  requireConsent: false,
  serverSide: false,
};

function render(config: GtmStorefrontConfig): string {
  return renderToString(createElement(GoogleTagManager, { config }));
}

let dataLayer: unknown[];
const store = new Map<string, string>();
let cookieJar: string;

beforeEach(() => {
  resetGtmForTesting();
  resetMetaForTesting();
  resetLinkedInForTesting();
  store.clear();
  dataLayer = [];
  cookieJar = '';
  (globalThis as Record<string, unknown>)['window'] = {
    dataLayer,
    location: { href: 'https://shop.test/p/widget-9', pathname: '/p/widget-9' },
  };
  (globalThis as Record<string, unknown>)['document'] = {
    get cookie(): string {
      return cookieJar;
    },
    set cookie(value: string) {
      cookieJar = value.split(';')[0] ?? '';
    },
    title: 'Widget 9',
  };
  (globalThis as Record<string, unknown>)['localStorage'] = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)['window'];
  delete (globalThis as Record<string, unknown>)['document'];
  delete (globalThis as Record<string, unknown>)['localStorage'];
});

describe('<GoogleTagManager> container injection', () => {
  it('renders nothing for a disabled config', () => {
    expect(render(GTM_DISABLED_CONFIG)).toBe('');
  });

  it('renders nothing for an untracked channel (no container id)', () => {
    expect(render({ ...trackedConfig, containerId: null })).toBe('');
  });

  it('renders nothing for a malformed container id', () => {
    // A malformed value must never reach a <script src> (FR-005).
    expect(render({ ...trackedConfig, containerId: 'G-ABC1234' })).toBe('');
    expect(render({ ...trackedConfig, containerId: 'not a container' })).toBe('');
  });

  it('renders the container id and the <noscript> fallback (FR-017)', () => {
    const html = render(trackedConfig);
    expect(html).toContain('GTM-ABC1234');
    expect(html).toContain('<noscript>');
    expect(html).toContain('https://www.googletagmanager.com/ns.html?id=GTM-ABC1234');
  });

  it('loads the container afterInteractive so it never blocks first paint (FR-012)', () => {
    expect(render(trackedConfig)).toContain('data-strategy="afterInteractive"');
  });

  it('publishes Consent Mode v2 defaults denied for all four signals when consent is required', () => {
    const html = render({ ...trackedConfig, requireConsent: true });
    for (const signal of [
      'analytics_storage',
      'ad_storage',
      'ad_user_data',
      'ad_personalization',
    ]) {
      expect(html).toContain(`${signal}:'denied'`);
    }
    expect(html).not.toContain("'granted'");
  });

  it('publishes Consent Mode v2 defaults granted when the channel does not require consent', () => {
    const html = render({ ...trackedConfig, requireConsent: false });
    for (const signal of [
      'analytics_storage',
      'ad_storage',
      'ad_user_data',
      'ad_personalization',
    ]) {
      expect(html).toContain(`${signal}:'granted'`);
    }
    expect(html).not.toContain("'denied'");
  });

  it('emits the consent default before the container loader, in one script (FR-013)', () => {
    const html = render({ ...trackedConfig, requireConsent: true });
    const consentAt = html.indexOf("gtag('consent','default'");
    const loaderAt = html.indexOf('googletagmanager.com/gtm.js');
    expect(consentAt).toBeGreaterThan(-1);
    expect(loaderAt).toBeGreaterThan(-1);
    expect(consentAt).toBeLessThan(loaderAt);
    // One script, because two would not guarantee the execution order.
    expect(html.match(/data-strategy="afterInteractive"/g)).toHaveLength(1);
  });

  it('defines window.gtag, the seam updateAnalyticsConsent() reaches the container through', () => {
    const html = render({ ...trackedConfig, requireConsent: true });
    expect(html).toContain('function gtag(){dataLayer.push(arguments);}');
    expect(html).toContain('window.gtag');
  });

  it('still loads the container when consent is required — it is not withheld (research §R16)', () => {
    // Consent Mode governs the operator's Google tags; the platform's own
    // events are gated separately by pushGtmEvent.
    const html = render({ ...trackedConfig, requireConsent: true });
    expect(html).toContain('https://www.googletagmanager.com/gtm.js?id=');
    expect(html).toContain('GTM-ABC1234');
  });
});

describe('pushGtmEvent consent gate (FR-014)', () => {
  it('emits nothing for an untracked channel', () => {
    configureGtm({ ...trackedConfig, enabled: false, containerId: null });
    expect(isGtmActive()).toBe(false);
    pushGtmEvent('add_to_cart', { value: 9 });
    expect(dataLayer).toHaveLength(0);
  });

  it('emits nothing before the visitor decides, and starts once consent is granted', () => {
    configureGtm({ ...trackedConfig, requireConsent: true });

    expect(gtmConsentGranted()).toBe(false);
    pushGtmEvent('add_to_cart', { value: 9 });
    expect(dataLayer).toHaveLength(0);

    store.set(CONSENT_STORAGE_KEY, 'denied');
    pushGtmEvent('add_to_cart', { value: 9 });
    expect(dataLayer).toHaveLength(0);

    store.set(CONSENT_STORAGE_KEY, 'granted');
    expect(gtmConsentGranted()).toBe(true);
    pushGtmEvent('add_to_cart', { value: 9 });
    expect(dataLayer).toEqual([{ event: 'add_to_cart', value: 9 }]);
  });

  it('emits immediately when the channel does not require consent', () => {
    configureGtm(trackedConfig);
    pushGtmEvent('view_item', { currency: 'PLN', value: 249 });
    expect(dataLayer).toEqual([{ event: 'view_item', currency: 'PLN', value: 249 }]);
  });
});

describe('the commerce dataLayer vocabulary (US2)', () => {
  const item = { sku: 'SKU-9', name: 'Widget 9', price: 249, quantity: 5, currency: 'PLN' };
  const itemsJson = JSON.stringify([
    { item_id: 'SKU-9', item_name: 'Widget 9', price: 249, quantity: 5 },
  ]);

  beforeEach(() => {
    configureGtm(trackedConfig);
  });

  it('pushes view_item once, with the documented params', () => {
    ecommerce.trackViewItem(item);
    expect(dataLayer).toEqual([
      { event: 'view_item', currency: 'PLN', value: 249, items: itemsJson },
    ]);
  });

  it('pushes add_to_cart once, with the documented params', () => {
    ecommerce.trackAddToCart(item);
    expect(dataLayer).toEqual([
      { event: 'add_to_cart', currency: 'PLN', value: 1245, items: itemsJson },
    ]);
  });

  it('pushes add_to_quote_request once, with the documented params', () => {
    ecommerce.trackAddToQuoteRequest(item);
    expect(dataLayer).toEqual([
      { event: 'add_to_quote_request', currency: 'PLN', value: 1245, items: itemsJson },
    ]);
  });

  it('pushes add_to_shopping_list once, with items only', () => {
    ecommerce.trackAddToShoppingList(item);
    expect(dataLayer).toEqual([{ event: 'add_to_shopping_list', items: itemsJson }]);
  });

  it('pushes begin_checkout once, with the documented params', () => {
    ecommerce.trackBeginCheckout([item], 'PLN');
    expect(dataLayer).toEqual([
      { event: 'begin_checkout', currency: 'PLN', value: 1245, items: itemsJson },
    ]);
  });

  it('pushes purchase once, with the documented params', () => {
    ecommerce.trackPurchase({
      transactionId: 'ORD-2026-000123',
      value: 1245,
      currency: 'PLN',
      items: [item],
    });
    expect(dataLayer).toEqual([
      {
        event: 'purchase',
        transaction_id: 'ORD-2026-000123',
        value: 1245,
        currency: 'PLN',
        items: itemsJson,
      },
    ]);
  });

  it('pushes place_order_clicked once, forwarding the caller payload', () => {
    ecommerce.trackPlaceOrderClicked({ payment_method: 'transfer', total: 1245 });
    expect(dataLayer).toEqual([
      { event: 'place_order_clicked', payment_method: 'transfer', total: 1245 },
    ]);
  });

  it('pushes contact_form_submitted once, forwarding the caller payload', () => {
    ecommerce.trackContactFormSubmitted({ subject: 'Quote', company: 'ACME' });
    expect(dataLayer).toEqual([
      { event: 'contact_form_submitted', subject: 'Quote', company: 'ACME' },
    ]);
  });

  it('pushes page_view once, with the documented params', () => {
    sendGtmPageView('/p/widget-9');
    expect(dataLayer).toEqual([
      {
        event: 'page_view',
        page_path: '/p/widget-9',
        page_location: 'https://shop.test/p/widget-9',
        page_title: 'Widget 9',
      },
    ]);
  });

  it('pushes view_search_results once, with the search term', () => {
    sendGtmSearchResults('q=drill&page=2');
    expect(dataLayer).toEqual([{ event: 'view_search_results', search_term: 'drill' }]);
  });

  it('pushes nothing for a search-free query string', () => {
    sendGtmSearchResults('page=2');
    expect(dataLayer).toHaveLength(0);
  });

  it('pushes nothing when the channel is untracked', () => {
    configureGtm({ ...trackedConfig, containerId: null });
    ecommerce.trackAddToCart(item);
    sendGtmPageView('/');
    expect(dataLayer).toHaveLength(0);
  });

  it('pushes nothing when the module is off', () => {
    configureGtm(GTM_DISABLED_CONFIG);
    ecommerce.trackPurchase({ transactionId: 'X', value: 1, currency: 'PLN', items: [item] });
    expect(dataLayer).toHaveLength(0);
  });

  it('pushes nothing when consent is required and denied', () => {
    configureGtm({ ...trackedConfig, requireConsent: true });
    store.set(CONSENT_STORAGE_KEY, 'denied');
    ecommerce.trackAddToCart(item);
    sendGtmPageView('/');
    sendGtmSearchResults('q=drill');
    expect(dataLayer).toHaveLength(0);
  });

  it('never forwards a non-scalar value from a caller-supplied payload (FR-021)', () => {
    // The typed signature already forbids it; the runtime filter is what makes
    // the guarantee hold for a JavaScript caller or an `unknown` cast.
    const fileLike = { name: 'offer.pdf', size: 1024, type: 'application/pdf' };
    ecommerce.trackContactFormSubmitted({
      subject: 'Quote',
      attachment: fileLike,
    } as unknown as Record<string, string | number>);
    expect(dataLayer).toEqual([{ event: 'contact_form_submitted', subject: 'Quote' }]);

    dataLayer.length = 0;
    ecommerce.trackPlaceOrderClicked({
      total: 1245,
      receipt: fileLike,
    } as unknown as Record<string, string | number>);
    expect(dataLayer).toEqual([{ event: 'place_order_clicked', total: 1245 }]);
  });
});

describe('coexistence with the other platforms (FR-032)', () => {
  const item = { sku: 'SKU-9', name: 'Widget 9', price: 249, quantity: 2, currency: 'PLN' };

  function enableEveryPlatform(): {
    gtag: ReturnType<typeof vi.fn>;
    fbq: ReturnType<typeof vi.fn>;
    lintrk: ReturnType<typeof vi.fn>;
  } {
    const gtag = vi.fn();
    const fbq = vi.fn();
    const lintrk = vi.fn();
    Object.assign((globalThis as Record<string, unknown>)['window'] as object, {
      gtag,
      fbq,
      lintrk,
    });
    configureGa({
      enabled: true,
      measurementId: 'G-TEST',
      enhancedEcommerce: true,
      serverSide: false,
      requireConsent: false,
      customEvents: [],
    });
    configureLinkedIn({
      enabled: true,
      partnerId: '1234567',
      requireConsent: false,
      serverSide: false,
      conversionMappings: [{ triggerAction: 'add_to_cart', conversionId: '222' }],
    });
    configureMeta({
      enabled: true,
      pixelId: '9876543210',
      requireConsent: false,
      customEvents: [],
    });
    configureGtm(trackedConfig);
    return { gtag, fbq, lintrk };
  }

  it('produces exactly one emission per platform for a single action, with all four on', () => {
    const { gtag, fbq, lintrk } = enableEveryPlatform();

    ecommerce.trackAddToCart(item);

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith(
      'event',
      'add_to_cart',
      expect.objectContaining({ currency: 'PLN', value: 498 }),
    );
    expect(lintrk).toHaveBeenCalledTimes(1);
    expect(lintrk).toHaveBeenCalledWith('track', { conversion_id: '222' });
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledWith('track', 'AddToCart', expect.objectContaining({
      currency: 'PLN',
      value: 498,
    }));
    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).toMatchObject({ event: 'add_to_cart', currency: 'PLN', value: 498 });
  });

  it('leaves the GA / LinkedIn / Meta emissions of the same call untouched', () => {
    const gtag = vi.fn();
    const fbq = vi.fn();
    const lintrk = vi.fn();
    Object.assign((globalThis as Record<string, unknown>)['window'] as object, {
      gtag,
      fbq,
      lintrk,
    });

    configureGa({
      enabled: true,
      measurementId: 'G-TEST',
      enhancedEcommerce: true,
      serverSide: false,
      requireConsent: false,
      customEvents: [],
    });
    configureLinkedIn({
      enabled: true,
      partnerId: '1234567',
      requireConsent: false,
      serverSide: false,
      conversionMappings: [{ triggerAction: 'add_to_cart', conversionId: '222' }],
    });
    configureMeta({
      enabled: true,
      pixelId: '9876543210',
      requireConsent: false,
      customEvents: [],
    });

    // With GTM off first — the baseline the other three produce on their own.
    configureGtm(GTM_DISABLED_CONFIG);
    ecommerce.trackAddToCart(item);
    const baseline = {
      gtag: gtag.mock.calls.length,
      fbq: fbq.mock.calls.length,
      lintrk: lintrk.mock.calls.length,
    };
    expect(baseline).toEqual({ gtag: 1, fbq: 1, lintrk: 1 });
    expect(dataLayer).toHaveLength(0);

    // Turning GTM on adds exactly one dataLayer entry and changes nothing else.
    configureGtm(trackedConfig);
    ecommerce.trackAddToCart(item);
    expect(gtag.mock.calls.length).toBe(baseline.gtag * 2);
    expect(fbq.mock.calls.length).toBe(baseline.fbq * 2);
    expect(lintrk.mock.calls.length).toBe(baseline.lintrk * 2);
    expect(dataLayer).toHaveLength(1);
    expect(dataLayer[0]).toMatchObject({ event: 'add_to_cart' });
  });
});

describe('server-side relay dispatch (US3)', () => {
  const relayConfig: GtmStorefrontConfig = { ...trackedConfig, serverSide: true };
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(
      async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(null, { status: 202 }),
    );
    (globalThis as Record<string, unknown>)['fetch'] = fetchSpy;
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['fetch'];
  });

  it('routes every relay-eligible event to /collect and pushes none to dataLayer (FR-026)', async () => {
    configureGtm(relayConfig);
    for (const name of GTM_RELAY_ELIGIBLE_EVENTS) {
      pushGtmEvent(name, { value: 1 });
    }
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(GTM_RELAY_ELIGIBLE_EVENTS.length);
    // Exactly-once is structural: a relayed event is never also pushed.
    expect(dataLayer).toHaveLength(0);

    const relayed = fetchSpy.mock.calls.map(
      (call) =>
        (
          JSON.parse((call[1] as RequestInit).body as string) as {
            events: Array<{ name: string }>;
          }
        ).events[0]!.name,
    );
    expect(relayed).toEqual([...GTM_RELAY_ELIGIBLE_EVENTS]);
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).toContain('/api/v1/storefront/google-tag-manager/collect');
      expect((call[1] as RequestInit).keepalive).toBe(true);
    }
  });

  it('pushes to dataLayer and makes no outbound call when serverSide is false', async () => {
    configureGtm({ ...trackedConfig, serverSide: false });
    pushGtmEvent('add_to_cart', { value: 9 });
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dataLayer).toEqual([{ event: 'add_to_cart', value: 9 }]);
  });

  it('sends the documented ingest body with the page context and the channel header', async () => {
    configureGtm(relayConfig);
    pushGtmEvent('purchase', { transaction_id: 'ORD-1', value: 1245, currency: 'PLN' });
    await Promise.resolve();

    const [, init] = fetchSpy.mock.calls[0]! as [unknown, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['clientId']).toBeTruthy();
    expect(body['consent']).toEqual({ analyticsStorage: 'granted' });
    expect(body['page']).toMatchObject({
      location: 'https://shop.test/p/widget-9',
      title: 'Widget 9',
    });
    expect(body['events']).toEqual([
      {
        name: 'purchase',
        params: { transaction_id: 'ORD-1', value: 1245, currency: 'PLN' },
      },
    ]);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('relays nothing while consent is required and not granted', async () => {
    configureGtm({ ...relayConfig, requireConsent: true });
    pushGtmEvent('add_to_cart', { value: 9 });
    store.set(CONSENT_STORAGE_KEY, 'denied');
    pushGtmEvent('add_to_cart', { value: 9 });
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dataLayer).toHaveLength(0);
  });

  it('strips a non-scalar param before it can reach the relay (FR-021)', async () => {
    configureGtm(relayConfig);
    pushGtmEvent('contact_form_submitted', {
      subject: 'Quote',
      attachment: { name: 'offer.pdf' },
    } as unknown as Record<string, string | number | boolean>);
    await Promise.resolve();
    const body = JSON.parse(
      (fetchSpy.mock.calls[0]![1] as RequestInit).body as string,
    ) as { events: Array<{ params: Record<string, unknown> }> };
    expect(body.events[0]!.params).toEqual({ subject: 'Quote' });
  });

  it('swallows a failing beacon so a shopper never sees it', async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error('unreachable');
    });
    configureGtm(relayConfig);
    expect(() => pushGtmEvent('add_to_cart', { value: 9 })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('never routes a client-only event name through the relay branch (FR-025)', async () => {
    // The typed signature already forbids these names; the runtime membership
    // check is what holds for a JavaScript caller. Either way they can never
    // acquire a server path — the backend ingest rejects them too.
    configureGtm(relayConfig);
    for (const name of GTM_CLIENT_ONLY_EVENTS) {
      pushGtmEvent(name as unknown as GtmRelayEligibleEvent, {});
    }
    await Promise.resolve();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('client identity (research §R8)', () => {
  it('writes no cookie before consent and owns its own cookie name once granted', () => {
    configureGtm({ ...trackedConfig, requireConsent: true });

    const ephemeral = resolveGtmClientId();
    expect(ephemeral).toBeTruthy();
    expect(cookieJar).toBe('');

    store.set(CONSENT_STORAGE_KEY, 'granted');
    const persisted = resolveGtmClientId();
    expect(cookieJar).toContain('_b2b_gtm_cid=');
    // Never GA's cookie: GTM must work on a deployment with GA switched off.
    expect(cookieJar).not.toContain('_b2b_ga_cid');
    expect(resolveGtmClientId()).toBe(persisted);
  });
});
