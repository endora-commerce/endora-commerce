import { describe, expect, it } from 'vitest';
import {
  PWA_SETTING_CODES,
  type CustomerAccountRecord,
  type OrderRecord,
  type OrderStatusDefinitionRecord,
  type PushPreferences,
  type QuoteRequestRecord,
} from '@endora-commerce/contracts';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import type { CreateMessageInput } from './push-message-service.js';
import {
  createStatusPushComposer,
  type StatusPushComposerDeps,
} from './status-push-composer.js';

/** The channel as the kernel's resolution port answers it (the cache's own type is not published). */
type CachedChannel = NonNullable<Awaited<ReturnType<SalesChannelResolutionPort['getById']>>>;

/**
 * `specs/149-pwa-order-status-push/` T010 / T028 — the status push composer
 * over stub ports, one case per gate in research R-11's order: subject →
 * channel → push and category switches → account → customer preference →
 * render and enqueue.
 */

const CHANNEL_PL = 'chan-pl';
const CHANNEL_DEFAULT = 'chan-default';

function channel(overrides: Partial<CachedChannel>): CachedChannel {
  return {
    id: CHANNEL_DEFAULT,
    code: 'default',
    name: { en: 'Default' },
    active: true,
    anonymousAccess: true,
    prefixDefaultLanguage: false,
    systemDefault: true,
    defaultLanguage: 'en-US',
    defaultCurrency: 'PLN',
    themeCode: null,
    logoAssetId: null,
    languages: ['en-US'],
    currencies: ['PLN'],
    version: 1,
    ...overrides,
  };
}

const CHANNELS: Record<string, CachedChannel> = {
  [CHANNEL_PL]: channel({ id: CHANNEL_PL, code: 'pl', defaultLanguage: 'pl-PL', systemDefault: false }),
  [CHANNEL_DEFAULT]: channel({}),
};

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'order-1',
    businessId: 'ORD-1001',
    placedByCustomerAccountId: 'cust-1',
    salesChannelId: CHANNEL_PL,
    ...overrides,
  } as OrderRecord;
}

function quote(overrides: Partial<QuoteRequestRecord> = {}): QuoteRequestRecord {
  return {
    id: 'quote-1',
    businessId: 'QR-77',
    customerAccountId: 'cust-1',
    salesChannelId: CHANNEL_DEFAULT,
    ...overrides,
  } as QuoteRequestRecord;
}

function account(overrides: Partial<CustomerAccountRecord> = {}): CustomerAccountRecord {
  return {
    id: 'cust-1',
    organizationId: 'org-1',
    deletedAt: null,
    anonymizedAt: null,
    ...overrides,
  } as CustomerAccountRecord;
}

const STATUS: OrderStatusDefinitionRecord = {
  code: 'shipment_sent',
  name: { en: 'Shipped', pl: 'Wysłane' },
  defaultName: 'Sent',
};

interface Harness {
  deps: StatusPushComposerDeps;
  enqueued: CreateMessageInput[];
  quoteReads: string[];
  preferenceReads: string[];
  debugLines: string[];
}

function harness(
  options: {
    order?: OrderRecord | null;
    quote?: QuoteRequestRecord | null;
    quotesPresent?: boolean;
    account?: CustomerAccountRecord | null;
    settings?: Partial<Record<string, boolean>>;
    channelSettings?: Record<string, Partial<Record<string, boolean>>>;
    preferences?: PushPreferences;
    status?: OrderStatusDefinitionRecord | null;
  } = {},
): Harness {
  const enqueued: CreateMessageInput[] = [];
  const quoteReads: string[] = [];
  const preferenceReads: string[] = [];
  const debugLines: string[] = [];
  const globalSettings: Record<string, boolean> = {
    [PWA_SETTING_CODES.PUSH_ENABLED]: true,
    [PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED]: true,
    [PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED]: true,
    ...(options.settings as Record<string, boolean> | undefined),
  };
  const noop = () => undefined;
  const deps: StatusPushComposerDeps = {
    orders: {
      findById: async () => ('order' in options ? options.order! : order()),
      findStatusDefinition: async () => ('status' in options ? options.status! : STATUS),
    },
    quotes: {
      findById: async (id) => {
        quoteReads.push(id);
        return 'quote' in options ? options.quote! : quote();
      },
    },
    isQuoteRequestsPresent: () => options.quotesPresent ?? true,
    customerAccounts: {
      findById: async () => ('account' in options ? options.account! : account()),
    },
    channels: {
      getById: async (id) => CHANNELS[id] ?? null,
      getSystemDefault: async () => CHANNELS[CHANNEL_DEFAULT]!,
    },
    isSettingOn: async (code, channelId) =>
      options.channelSettings?.[channelId]?.[code] ?? globalSettings[code] ?? false,
    preferences: {
      read: async (customerAccountId) => {
        preferenceReads.push(customerAccountId);
        return options.preferences ?? { orderStatus: true, quoteStatus: true };
      },
    },
    translate: {
      translate: async (moduleId, key, language, params) =>
        `[${moduleId}:${language}] ${key} ${JSON.stringify(params ?? {})}`,
    },
    messageService: {
      createAndEnqueue: async (input) => {
        enqueued.push(input);
        return { messageId: 'm-1', queuedDeliveries: 1 };
      },
    },
    runInSystemScope: (_reason, run) => run(),
    log: () => ({
      debug: (_obj: unknown, msg?: string) => {
        if (msg) debugLines.push(msg);
      },
      info: noop,
      warn: noop,
      error: noop,
    }) as never,
  };
  return { deps, enqueued, quoteReads, preferenceReads, debugLines };
}

const ORDER_EVENT = {
  eventId: 'evt-o-1',
  orderId: 'order-1',
  salesChannelId: CHANNEL_PL,
  to: 'shipment_sent',
};
const QUOTE_EVENT = { eventId: 'evt-q-1', rfqId: 'quote-1', what: 'approved' as const };

describe('status push composer — order status', () => {
  it('queues exactly one localised notification for the placing account', async () => {
    const h = harness();
    const outcome = await createStatusPushComposer(h.deps).order(ORDER_EVENT);

    expect(outcome).toBe('enqueued');
    expect(h.enqueued).toEqual([
      {
        salesChannelId: CHANNEL_PL,
        title: '[pwa:pl] notification.orderStatus.title {"orderNumber":"ORD-1001","status":"Wysłane"}',
        body: '[pwa:pl] notification.orderStatus.body {"orderNumber":"ORD-1001","status":"Wysłane"}',
        url: '/orders/order-1',
        audience: { kind: 'customers', customerAccountIds: ['cust-1'] },
        trigger: 'order_status',
        sourceEventId: 'evt-o-1',
      },
    ]);
  });

  it('skips a guest order and an order nobody can read', async () => {
    // `OrderRecord` has no guest order; the composer guards against one anyway.
    const guest = harness({ order: order({ placedByCustomerAccountId: null as unknown as string }) });
    expect(await createStatusPushComposer(guest.deps).order(ORDER_EVENT)).toBe('skipped:no_subject');
    const missing = harness({ order: null });
    expect(await createStatusPushComposer(missing.deps).order(ORDER_EVENT)).toBe(
      'skipped:no_subject',
    );
    expect([...guest.enqueued, ...missing.enqueued]).toEqual([]);
  });

  it('skips while push is off for the channel, whatever the category says', async () => {
    const h = harness({ settings: { [PWA_SETTING_CODES.PUSH_ENABLED]: false } });
    expect(await createStatusPushComposer(h.deps).order(ORDER_EVENT)).toBe('skipped:switched_off');
    expect(h.enqueued).toEqual([]);
  });

  it('skips while the order category is off, and honours a per-channel override', async () => {
    const off = harness({ settings: { [PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED]: false } });
    expect(await createStatusPushComposer(off.deps).order(ORDER_EVENT)).toBe('skipped:switched_off');

    const onForChannel = harness({
      settings: { [PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED]: false },
      channelSettings: { [CHANNEL_PL]: { [PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED]: true } },
    });
    expect(await createStatusPushComposer(onForChannel.deps).order(ORDER_EVENT)).toBe('enqueued');
  });

  it('does not let the quote category switch order pushes', async () => {
    const h = harness({ settings: { [PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED]: false } });
    expect(await createStatusPushComposer(h.deps).order(ORDER_EVENT)).toBe('enqueued');
  });

  it.each([
    ['missing', null],
    ['deleted', account({ deletedAt: new Date() })],
    ['anonymised', account({ anonymizedAt: new Date() })],
  ])('skips a %s account (FR-016)', async (_label, record) => {
    const h = harness({ account: record });
    expect(await createStatusPushComposer(h.deps).order(ORDER_EVENT)).toBe('skipped:no_account');
    expect(h.enqueued).toEqual([]);
  });

  it('labels the status with the code when the shop has no definition for it', async () => {
    const h = harness({ status: null });
    await createStatusPushComposer(h.deps).order(ORDER_EVENT);
    expect(h.enqueued[0]!.body).toContain('"status":"shipment_sent"');
  });

  it('sends on an order channel the resolver does not know, in English', async () => {
    const h = harness({ order: order({ salesChannelId: 'chan-unknown' }) });
    expect(await createStatusPushComposer(h.deps).order(ORDER_EVENT)).toBe('enqueued');
    expect(h.enqueued[0]!.salesChannelId).toBe('chan-unknown');
    expect(h.enqueued[0]!.title).toContain('[pwa:en]');
  });

  it('uses the channel the order was placed on, not the event payload', async () => {
    const h = harness({ order: order({ salesChannelId: CHANNEL_DEFAULT }) });
    await createStatusPushComposer(h.deps).order(ORDER_EVENT);
    expect(h.enqueued[0]!.salesChannelId).toBe(CHANNEL_DEFAULT);
    expect(h.enqueued[0]!.title).toContain('[pwa:en]');
    expect(h.enqueued[0]!.body).toContain('"status":"Shipped"');
  });
});

describe('status push composer — quote status', () => {
  it('queues exactly one notification for the requesting account', async () => {
    const h = harness();
    const outcome = await createStatusPushComposer(h.deps).quote(QUOTE_EVENT);

    expect(outcome).toBe('enqueued');
    expect(h.enqueued).toEqual([
      {
        salesChannelId: CHANNEL_DEFAULT,
        title: '[pwa:en] notification.quote.title {"quoteNumber":"QR-77"}',
        body: '[pwa:en] notification.quote.body.approved {"quoteNumber":"QR-77"}',
        url: '/quote-requests/quote-1',
        audience: { kind: 'customers', customerAccountIds: ['cust-1'] },
        trigger: 'quote_request',
        sourceEventId: 'evt-q-1',
      },
    ]);
  });

  it('never calls the quote port while quote_requests is absent', async () => {
    const h = harness({ quotesPresent: false });
    expect(await createStatusPushComposer(h.deps).quote(QUOTE_EVENT)).toBe(
      'skipped:quote_requests_absent',
    );
    expect(h.quoteReads).toEqual([]);
    expect(h.enqueued).toEqual([]);
  });

  it('sends a channel-less quote on the system default channel', async () => {
    const h = harness({ quote: quote({ salesChannelId: null }) });
    await createStatusPushComposer(h.deps).quote(QUOTE_EVENT);
    expect(h.enqueued[0]!.salesChannelId).toBe(CHANNEL_DEFAULT);
  });

  it('uses a Polish channel’s language', async () => {
    const h = harness({ quote: quote({ salesChannelId: CHANNEL_PL }) });
    await createStatusPushComposer(h.deps).quote({ ...QUOTE_EVENT, what: 'expired' });
    expect(h.enqueued[0]!.body).toBe(
      '[pwa:pl] notification.quote.body.expired {"quoteNumber":"QR-77"}',
    );
  });

  it('skips while the quote category is off, independently of orders', async () => {
    const quoteOff = harness({ settings: { [PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED]: false } });
    expect(await createStatusPushComposer(quoteOff.deps).quote(QUOTE_EVENT)).toBe(
      'skipped:switched_off',
    );
    const orderOff = harness({ settings: { [PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED]: false } });
    expect(await createStatusPushComposer(orderOff.deps).quote(QUOTE_EVENT)).toBe('enqueued');
  });

  it('skips an unknown quote', async () => {
    const h = harness({ quote: null });
    expect(await createStatusPushComposer(h.deps).quote(QUOTE_EVENT)).toBe('skipped:no_subject');
  });
});

describe('status push composer — customer preference (US3)', () => {
  it('drops order pushes and keeps quote pushes when the order choice is off', async () => {
    const h = harness({ preferences: { orderStatus: false, quoteStatus: true } });
    const composer = createStatusPushComposer(h.deps);
    expect(await composer.order(ORDER_EVENT)).toBe('skipped:customer_preference');
    expect(await composer.quote(QUOTE_EVENT)).toBe('enqueued');
    expect(h.enqueued.map((m) => m.trigger)).toEqual(['quote_request']);
    expect(h.debugLines).toContain('pwa.push_skipped_customer_preference');
  });

  it('drops quote pushes and keeps order pushes when the quote choice is off', async () => {
    const h = harness({ preferences: { orderStatus: true, quoteStatus: false } });
    const composer = createStatusPushComposer(h.deps);
    expect(await composer.quote(QUOTE_EVENT)).toBe('skipped:customer_preference');
    expect(await composer.order(ORDER_EVENT)).toBe('enqueued');
    expect(h.enqueued.map((m) => m.trigger)).toEqual(['order_status']);
  });

  it('reads the preference only after every cheaper gate passed', async () => {
    const h = harness({ settings: { [PWA_SETTING_CODES.PUSH_ENABLED]: false } });
    await createStatusPushComposer(h.deps).order(ORDER_EVENT);
    expect(h.preferenceReads).toEqual([]);
  });
});

describe('status push composer — scope', () => {
  it('runs the whole sequence inside one system scope', async () => {
    const h = harness();
    const reasons: string[] = [];
    let inside = false;
    h.deps.runInSystemScope = async (reason, run) => {
      reasons.push(reason);
      inside = true;
      try {
        return await run();
      } finally {
        inside = false;
      }
    };
    h.deps.messageService = {
      createAndEnqueue: async (input) => {
        expect(inside).toBe(true);
        h.enqueued.push(input);
        return { messageId: 'm', queuedDeliveries: 1 };
      },
    };
    await createStatusPushComposer(h.deps).order(ORDER_EVENT);
    expect(reasons).toHaveLength(1);
    expect(h.enqueued).toHaveLength(1);
  });
});
