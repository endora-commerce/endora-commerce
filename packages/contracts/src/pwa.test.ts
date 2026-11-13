import { describe, expect, it } from 'vitest';
import {
  PWA_SETTING_CODES,
  PushPreferencesSchema,
  PwaAdminConfigSchema,
  PwaPublicConfigSchema,
  UpdatePushPreferencesRequestSchema,
  UpdatePwaConfigRequestSchema,
  type CustomerPushInput,
  type CustomerPushOutcome,
  type CustomerPushPort,
} from './pwa.js';

/**
 * `specs/149-pwa-order-status-push/` — the additive contract surface: two
 * category switches (settings, admin config, effective public flags) and the
 * customer's account-wide push preferences.
 */

const PUBLIC_CONFIG = {
  appName: 'Shop',
  shortName: 'Shop',
  themeColor: '#1d4ed8',
  backgroundColor: '#fafafa',
  displayMode: 'standalone',
  icons: [],
  cachingEnabled: false,
  pushEnabled: true,
  vapidPublicKey: 'BPub',
  orderStatusPushEnabled: true,
  quoteStatusPushEnabled: false,
} as const;

const ADMIN_CONFIG = {
  salesChannelId: null,
  appName: 'Shop',
  shortName: 'Shop',
  themeColor: '#1d4ed8',
  backgroundColor: '#fafafa',
  displayMode: 'standalone',
  iconAssetId: '',
  cachingEnabled: false,
  pushEnabled: true,
  vapidPublicKey: '',
  vapidPrivateKeyIsSet: false,
  fcmServiceAccountIsSet: false,
  orderStatusPushEnabled: true,
  quoteStatusPushEnabled: true,
} as const;

describe('pwa contracts — status push category switches', () => {
  it('names the two category settings', () => {
    expect(PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED).toBe('pwa.push_order_status_enabled');
    expect(PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED).toBe('pwa.push_quote_status_enabled');
  });

  it('requires both effective flags on the public config', () => {
    expect(PwaPublicConfigSchema.safeParse(PUBLIC_CONFIG).success).toBe(true);
    const { orderStatusPushEnabled: _o, ...withoutOrder } = PUBLIC_CONFIG;
    const { quoteStatusPushEnabled: _q, ...withoutQuote } = PUBLIC_CONFIG;
    expect(PwaPublicConfigSchema.safeParse(withoutOrder).success).toBe(false);
    expect(PwaPublicConfigSchema.safeParse(withoutQuote).success).toBe(false);
  });

  it('requires both raw values on the admin config', () => {
    expect(PwaAdminConfigSchema.safeParse(ADMIN_CONFIG).success).toBe(true);
    const { orderStatusPushEnabled: _o, ...withoutOrder } = ADMIN_CONFIG;
    const { quoteStatusPushEnabled: _q, ...withoutQuote } = ADMIN_CONFIG;
    expect(PwaAdminConfigSchema.safeParse(withoutOrder).success).toBe(false);
    expect(PwaAdminConfigSchema.safeParse(withoutQuote).success).toBe(false);
  });

  it('accepts either switch as an optional boolean on the admin update', () => {
    expect(UpdatePwaConfigRequestSchema.safeParse({}).success).toBe(true);
    expect(
      UpdatePwaConfigRequestSchema.safeParse({ orderStatusPushEnabled: false }).success,
    ).toBe(true);
    expect(
      UpdatePwaConfigRequestSchema.safeParse({ quoteStatusPushEnabled: true }).success,
    ).toBe(true);
    expect(
      UpdatePwaConfigRequestSchema.safeParse({ quoteStatusPushEnabled: 'yes' }).success,
    ).toBe(false);
  });
});

describe('pwa contracts — customer push preferences', () => {
  it('reads both choices as booleans', () => {
    expect(PushPreferencesSchema.parse({ orderStatus: true, quoteStatus: false })).toEqual({
      orderStatus: true,
      quoteStatus: false,
    });
    expect(PushPreferencesSchema.safeParse({ orderStatus: true }).success).toBe(false);
  });

  it('accepts a partial update naming at least one choice', () => {
    expect(UpdatePushPreferencesRequestSchema.safeParse({ orderStatus: false }).success).toBe(true);
    expect(UpdatePushPreferencesRequestSchema.safeParse({ quoteStatus: true }).success).toBe(true);
    expect(
      UpdatePushPreferencesRequestSchema.safeParse({ orderStatus: true, quoteStatus: false })
        .success,
    ).toBe(true);
  });

  it('refuses an empty body, an unknown key and a non-boolean', () => {
    expect(UpdatePushPreferencesRequestSchema.safeParse({}).success).toBe(false);
    expect(
      UpdatePushPreferencesRequestSchema.safeParse({ orderStatus: true, email: false }).success,
    ).toBe(false);
    expect(UpdatePushPreferencesRequestSchema.safeParse({ orderStatus: 'false' }).success).toBe(
      false,
    );
  });
});

describe('179 — customerPushPort (contracts/delivery-and-ports.md §2, type surface)', () => {
  it('is implementable, takes a pre-rendered quote push and answers one of five outcomes', async () => {
    const outcomes = [
      'enqueued',
      'skipped:switched_off',
      'skipped:customer_preference',
      'skipped:no_account',
      'skipped:no_subscription',
    ] as const satisfies readonly CustomerPushOutcome[];
    const seen: CustomerPushInput[] = [];
    const port: CustomerPushPort = {
      push: (input) => {
        seen.push(input);
        return Promise.resolve(outcomes[seen.length - 1] ?? 'enqueued');
      },
    };
    const input: CustomerPushInput = {
      organizationId: '00000000-0000-4000-8000-000000000001',
      customerAccountId: '00000000-0000-4000-8000-000000000002',
      salesChannelId: null,
      category: 'quote',
      title: 'Quote request RFQ-0042',
      body: 'Your quote request was approved.',
      url: '/quote-requests/00000000-0000-4000-8000-000000000003',
      sourceKey: '00000000-0000-4000-8000-000000000004',
    };
    expect(await port.push(input)).toBe('enqueued');
    expect(await port.push(input)).toBe('skipped:switched_off');
    expect(seen).toHaveLength(2);
  });
});
