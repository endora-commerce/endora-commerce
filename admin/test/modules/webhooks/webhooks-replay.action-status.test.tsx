import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import core from '../../../../packages/modules/_i18n/i18n/en.json';
import webhooks from '../../../../packages/modules/webhooks/i18n/en.json';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — "Replay queued"
 * was a success banner above the subscriptions, far from the Replay button in
 * the deliveries card. It is said in that card's toolbar now, in a region
 * mounted before it has text; a refused replay stays a page-level banner and
 * empties it.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { default: WebhooksPage } = await import('../../../../packages/modules/webhooks/src/admin/pages/WebhooksPage');

const WEBHOOK_ID = '00000000-0000-4000-8000-0000000000a1';
const DELIVERY = {
  id: '00000000-0000-4000-8000-0000000000d1',
  webhookId: WEBHOOK_ID,
  eventId: 'e1',
  eventType: 'order.placed.v1',
  status: 'failed',
  attemptCount: 3,
  dispatchedAt: null,
  completedAt: null,
  deadLetteredAt: null,
  lastResponseStatus: 500,
  lastError: 'boom',
  createdAt: '2026-11-20T00:00:00.000Z',
};

beforeEach(() => {
  getSpy.mockReset().mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/webhooks') return { data: [] };
    if (url.startsWith('/api/v1/admin/webhooks/deliveries')) return { data: [DELIVERY] };
    if (url === '/api/v1/admin/webhooks/event-types') return { data: [] };
    throw new Error(`unexpected GET ${url}`);
  });
  postSpy.mockReset().mockResolvedValue({ data: DELIVERY });
});

const bundle = { core: core as Record<string, string>, webhooks: webhooks as Record<string, string> };

describe('WebhooksPage — replay result beside the deliveries (SALES-17)', () => {
  it('says "Replay queued" in the deliveries toolbar; a refused replay empties it', async () => {
    renderWithI18n(
      <MemoryRouter>
        <WebhooksPage />
      </MemoryRouter>,
      bundle,
    );
    const title = await screen.findByText(core['webhooks.deliveries.title']);
    const region = within(title.parentElement!).getByRole('status');
    expect(region.textContent).toBe('');

    fireEvent.click(await screen.findByRole('button', { name: core['webhooks.action.replay'] }));
    await waitFor(() => expect(region).toHaveTextContent(core['webhooks.delivery.replayQueued']));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();

    postSpy.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: core['webhooks.action.replay'] }));
    await waitFor(() => expect(document.querySelector('[data-slot="alert"][data-variant="destructive"]')).not.toBeNull());
    expect(region.textContent).toBe('');
  });
});
