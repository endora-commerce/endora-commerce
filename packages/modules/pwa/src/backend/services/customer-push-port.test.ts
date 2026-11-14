import { describe, expect, it } from 'vitest';
import {
  PWA_SETTING_CODES,
  type CustomerAccountRecord,
  type CustomerPushInput,
  type PushPreferences,
} from '@endora-commerce/contracts';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import type { CreateMessageInput } from './push-message-service.js';
import { createCustomerPushPort, type CustomerPushPortDeps } from './customer-push-port.js';

/**
 * `specs/179-rfq-and-customer-notifications/` T090 (FR-060) — `customerPushPort`
 * over stub dependencies, one case per gate in the order
 * `contracts/delivery-and-ports.md` §2 writes down: channel → `pwa.push_enabled`
 * and the category switch → account live → preference → subscription →
 * enqueue. A gate that refuses answers its `skipped:*` and nothing behind it is
 * asked; a repeated `sourceKey` writes nothing and still answers `enqueued`.
 */

type CachedChannel = NonNullable<Awaited<ReturnType<SalesChannelResolutionPort['getById']>>>;

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

function account(overrides: Partial<CustomerAccountRecord> = {}): CustomerAccountRecord {
  return {
    id: 'cust-1',
    organizationId: 'org-1',
    deletedAt: null,
    anonymizedAt: null,
    ...overrides,
  } as CustomerAccountRecord;
}

const INPUT: CustomerPushInput = {
  organizationId: 'org-1',
  customerAccountId: 'cust-1',
  salesChannelId: CHANNEL_PL,
  category: 'quote',
  title: 'Aktualizacja zapytania ofertowego',
  body: 'Zapytanie ofertowe QR-000153 zostało zatwierdzone',
  url: '/quote-requests/rfq-1',
  sourceKey: 'record-1',
};

interface Harness {
  deps: CustomerPushPortDeps;
  /** Every dependency the port asked, in order — what tells the gates apart. */
  asked: string[];
  enqueued: CreateMessageInput[];
  /** Messages already written, by `sourceKey`: what the idempotency answers from. */
  written: Set<string>;
  scopes: string[];
}

function harness(
  options: {
    account?: CustomerAccountRecord | null;
    settings?: Partial<Record<string, boolean>>;
    channelSettings?: Record<string, Partial<Record<string, boolean>>>;
    preferences?: PushPreferences;
    subscribed?: boolean;
  } = {},
): Harness {
  const asked: string[] = [];
  const enqueued: CreateMessageInput[] = [];
  const written = new Set<string>();
  const scopes: string[] = [];
  const globalSettings: Record<string, boolean> = {
    [PWA_SETTING_CODES.PUSH_ENABLED]: true,
    [PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED]: true,
    [PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED]: true,
    ...(options.settings as Record<string, boolean> | undefined),
  };
  const deps: CustomerPushPortDeps = {
    channels: {
      getSystemDefault: async () => {
        asked.push('channel:system-default');
        return CHANNELS[CHANNEL_DEFAULT]!;
      },
    },
    isSettingOn: async (code, channelId) => {
      asked.push(`setting:${code}@${channelId}`);
      return options.channelSettings?.[channelId]?.[code] ?? globalSettings[code] ?? false;
    },
    customerAccounts: {
      findById: async (id) => {
        asked.push(`account:${id}`);
        return 'account' in options ? options.account! : account();
      },
    },
    preferences: {
      read: async (id) => {
        asked.push(`preference:${id}`);
        return options.preferences ?? { orderStatus: true, quoteStatus: true };
      },
    },
    hasActiveSubscription: async (id, channelId) => {
      asked.push(`subscription:${id}@${channelId}`);
      return options.subscribed ?? true;
    },
    messageService: {
      createAndEnqueue: async (input) => {
        asked.push('enqueue');
        if (input.sourceEventId && written.has(input.sourceEventId)) {
          return { messageId: 'existing', queuedDeliveries: 0 };
        }
        if (input.sourceEventId) written.add(input.sourceEventId);
        enqueued.push(input);
        return { messageId: 'm-1', queuedDeliveries: 1 };
      },
    },
    runInSystemScope: async (reason, run) => {
      scopes.push(reason);
      return run();
    },
  };
  return { deps, asked, enqueued, written, scopes };
}

describe('customerPushPort — enqueue (FR-060)', () => {
  it('writes one push message for the one account, under trigger quote_request keyed by sourceKey', async () => {
    const h = harness();
    expect(await createCustomerPushPort(h.deps).push(INPUT)).toBe('enqueued');
    expect(h.enqueued).toEqual([
      {
        salesChannelId: CHANNEL_PL,
        title: INPUT.title,
        body: INPUT.body,
        url: INPUT.url,
        audience: { kind: 'customers', customerAccountIds: ['cust-1'] },
        trigger: 'quote_request',
        sourceEventId: 'record-1',
      },
    ]);
  });

  it('asks the gates in the contract’s order, each once', async () => {
    const h = harness();
    await createCustomerPushPort(h.deps).push(INPUT);
    expect(h.asked).toEqual([
      `setting:${PWA_SETTING_CODES.PUSH_ENABLED}@${CHANNEL_PL}`,
      `setting:${PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED}@${CHANNEL_PL}`,
      'account:cust-1',
      'preference:cust-1',
      `subscription:cust-1@${CHANNEL_PL}`,
      'enqueue',
    ]);
  });

  it('a repeated sourceKey writes nothing and answers enqueued', async () => {
    const h = harness();
    const port = createCustomerPushPort(h.deps);
    expect(await port.push(INPUT)).toBe('enqueued');
    expect(await port.push(INPUT)).toBe('enqueued');
    expect(h.enqueued).toHaveLength(1);
  });

  it('pushes a channel-less input on the system default channel', async () => {
    const h = harness();
    expect(await createCustomerPushPort(h.deps).push({ ...INPUT, salesChannelId: null })).toBe('enqueued');
    expect(h.enqueued[0]!.salesChannelId).toBe(CHANNEL_DEFAULT);
  });

  it('takes the caller’s channel as it is, without resolving it', async () => {
    const h = harness();
    expect(await createCustomerPushPort(h.deps).push({ ...INPUT, salesChannelId: 'chan-gone' })).toBe('enqueued');
    expect(h.enqueued[0]!.salesChannelId).toBe('chan-gone');
    expect(h.asked.some((line) => line.startsWith('channel:'))).toBe(false);
  });

  it('runs the whole sequence in one system scope', async () => {
    const h = harness();
    await createCustomerPushPort(h.deps).push(INPUT);
    expect(h.scopes).toHaveLength(1);
  });
});

describe('customerPushPort — the gates, in order', () => {
  it('push off on the channel: skipped:switched_off, before the account is read', async () => {
    const h = harness({ settings: { [PWA_SETTING_CODES.PUSH_ENABLED]: false } });
    expect(await createCustomerPushPort(h.deps).push(INPUT)).toBe('skipped:switched_off');
    expect(h.asked.some((line) => line.startsWith('account:'))).toBe(false);
    expect(h.enqueued).toEqual([]);
  });

  it('the quote category off: skipped:switched_off; the order category does not decide it', async () => {
    const quoteOff = harness({ settings: { [PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED]: false } });
    expect(await createCustomerPushPort(quoteOff.deps).push(INPUT)).toBe('skipped:switched_off');
    const orderOff = harness({ settings: { [PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED]: false } });
    expect(await createCustomerPushPort(orderOff.deps).push(INPUT)).toBe('enqueued');
  });

  it('honours a per-channel override of the quote category', async () => {
    const h = harness({
      settings: { [PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED]: false },
      channelSettings: { [CHANNEL_PL]: { [PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED]: true } },
    });
    expect(await createCustomerPushPort(h.deps).push(INPUT)).toBe('enqueued');
  });

  it.each([
    ['missing', null],
    ['deleted', account({ deletedAt: new Date() })],
    ['anonymised', account({ anonymizedAt: new Date() })],
    ['in another Organization', account({ organizationId: 'org-2' })],
  ])('a %s account: skipped:no_account, the preference never read', async (_label, record) => {
    const h = harness({ account: record });
    expect(await createCustomerPushPort(h.deps).push(INPUT)).toBe('skipped:no_account');
    expect(h.asked.some((line) => line.startsWith('preference:'))).toBe(false);
    expect(h.enqueued).toEqual([]);
  });

  it('quote updates off in the account’s preference: skipped:customer_preference, devices not counted', async () => {
    const h = harness({ preferences: { orderStatus: true, quoteStatus: false } });
    expect(await createCustomerPushPort(h.deps).push(INPUT)).toBe('skipped:customer_preference');
    expect(h.asked.some((line) => line.startsWith('subscription:'))).toBe(false);
    expect(h.enqueued).toEqual([]);
  });

  it('the order choice off does not stop a quote push', async () => {
    const h = harness({ preferences: { orderStatus: false, quoteStatus: true } });
    expect(await createCustomerPushPort(h.deps).push(INPUT)).toBe('enqueued');
  });

  it('no active device on the channel: skipped:no_subscription, nothing written', async () => {
    const h = harness({ subscribed: false });
    expect(await createCustomerPushPort(h.deps).push(INPUT)).toBe('skipped:no_subscription');
    expect(h.asked).not.toContain('enqueue');
    expect(h.enqueued).toEqual([]);
  });
});
