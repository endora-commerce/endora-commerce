import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { setMobileViewport } from '../../setup';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * The webhook subscription form offers the event types other modules
 * contribute (`specs/143-crm-sales-opportunities/`, User Story 16 — T165,
 * T168; research R-27).
 *
 * `GET /api/v1/admin/webhooks/event-types` answers the contributed types whose
 * owner is switched on. The form offers them **in addition to** its own list,
 * which this change leaves exactly as it was — so with nothing contributed the
 * form is unchanged, and with something contributed the new options come after
 * the existing ones and can be subscribed to.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
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

// The organization picker fetches through the kit's own client, which the mock
// above does not reach; the form's event options are the subject here.
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, OrganizationPicker: () => <span data-testid="organization-picker" /> };
});

const { default: WebhooksPage } = await import(
  '../../../../packages/modules/webhooks/src/admin/pages/WebhooksPage'
);

const EVENT_TYPES_PATH = '/api/v1/admin/webhooks/event-types';

/** The form's own list, as it stood before this change — the thirteen it has always offered. */
const KNOWN = [
  'product.created.v1',
  'product.updated.v1',
  'product.archived.v1',
  'rfq.created.v1',
  'rfq.quoted.v1',
  'rfq.accepted.v1',
  'rfq.expired.v1',
  'order.created.v1',
  'order.status_changed.v1',
  'order.cancelled.v1',
  'payment.settled.v1',
  'credit_limit.adjusted.v1',
  'credit_limit.reservation_released.v1',
];

let contributed: Array<{ ownerModuleId: string; eventType: string }>;

/** The event types the form offers, in the order it offers them. */
function offered(): string[] {
  return Array.from(document.querySelectorAll('form code')).map((node) => node.textContent ?? '');
}

async function renderPage(): Promise<void> {
  renderWithI18n(
    <MemoryRouter>
      <WebhooksPage />
    </MemoryRouter>,
    { core: {} },
  );
  await waitFor(() => expect(getSpy).toHaveBeenCalledWith(EVENT_TYPES_PATH));
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  contributed = [];
  getSpy.mockImplementation((path: string) => {
    if (path === EVENT_TYPES_PATH) return Promise.resolve({ data: contributed });
    return Promise.resolve({ data: [] });
  });
  postSpy.mockResolvedValue({ data: { id: 'w1', secret: '' } });
});

describe('the webhook subscription form — contributed event types', () => {
  it('is unchanged when the endpoint returns none', async () => {
    await renderPage();
    await waitFor(() => expect(offered()).toEqual(KNOWN));
  });

  it('offers the contributed types after its own, each once', async () => {
    contributed = [
      { ownerModuleId: 'crm', eventType: 'crm.opportunity.status_changed.v1' },
      { ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' },
      // Already on the form's own list: not offered a second time.
      { ownerModuleId: 'orders', eventType: 'order.created.v1' },
    ];
    await renderPage();
    await waitFor(() =>
      expect(offered()).toEqual([...KNOWN, 'crm.opportunity.status_changed.v1', 'crm.opportunity.created.v1']),
    );
  });

  it('subscribes to a contributed type like to any other', async () => {
    contributed = [{ ownerModuleId: 'crm', eventType: 'crm.opportunity.status_changed.v1' }];
    await renderPage();
    const user = userEvent.setup();
    const option = await screen.findByText('crm.opportunity.status_changed.v1');
    await user.click(option);
    await user.type(document.getElementById('webhook-name') as HTMLElement, 'CRM feed');
    await user.type(document.getElementById('webhook-url') as HTMLElement, 'https://example.test/hook');
    await user.click(document.querySelector('form button[type="submit"]') as HTMLElement);

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/webhooks', {
      name: 'CRM feed',
      url: 'https://example.test/hook',
      eventTypes: ['crm.opportunity.status_changed.v1'],
    });
  });

  it('keeps its own list when the endpoint cannot be read', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === EVENT_TYPES_PATH) return Promise.reject(new Error('503'));
      return Promise.resolve({ data: [] });
    });
    await renderPage();
    await waitFor(() => expect(offered()).toEqual(KNOWN));
    expect(document.body.textContent).not.toContain('503');
  });
});
