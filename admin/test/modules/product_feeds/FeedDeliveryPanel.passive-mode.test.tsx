import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import type { FeedDeliveryConfig } from '@endora-commerce/contracts';

/**
 * Issue #1459 (UX audit CAT-14, §4 *Product feeds*) — FTP passive mode is the
 * only mode the platform supports. It was a disabled one-option select with a
 * 147-character paragraph explaining why it could not be changed; a fixed fact
 * is shown as read-only text instead, and the paragraph is gone.
 */

const FTP = {
  protocol: 'ftp',
  httpLabel: null,
  enabled: true,
  host: 'ftp.partner.example',
  port: 21,
  username: 'shop',
  directoryPath: '/in',
  requestUrl: null,
  headers: [],
  version: 1,
} as unknown as FeedDeliveryConfig;

vi.mock('../../../../packages/modules/product_feeds/src/admin/api', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../packages/modules/product_feeds/src/admin/api')
  >('../../../../packages/modules/product_feeds/src/admin/api');
  return {
    ...actual,
    feedDeliveryClient: {
      ...actual.feedDeliveryClient,
      get: (): Promise<{ data: FeedDeliveryConfig | null }> => Promise.resolve({ data: FTP }),
      listAttempts: (): Promise<{ data: [] }> => Promise.resolve({ data: [] }),
    },
  };
});

const { FeedDeliveryPanel } = await import(
  '../../../../packages/modules/product_feeds/src/admin/components/FeedDeliveryPanel'
);

describe('FeedDeliveryPanel — FTP passive mode', () => {
  it('is read-only text, not a disabled select, and carries no explanation paragraph', async () => {
    renderWithI18n(
      withSession(<FeedDeliveryPanel feedId="f1" />, {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['product_feeds'] }),
      }),
      passthroughBundle('product_feeds', ['delivery.field.passiveMode', 'delivery.field.enabled.on']),
    );
    const fact = await screen.findByTestId('delivery-passive');
    expect(fact.textContent).toContain('delivery.field.passiveMode');
    expect(fact.textContent).toContain('delivery.field.enabled.on');
    expect(screen.queryByRole('combobox', { name: 'delivery.field.passiveMode' })).toBeNull();
    expect(document.body.textContent).not.toContain('delivery.field.passiveMode.help');
  });
});
