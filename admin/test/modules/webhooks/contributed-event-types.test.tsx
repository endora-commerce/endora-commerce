import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { setMobileViewport } from '../../setup';
import {
  CATALOG_WEBHOOK_EVENT_TYPES,
  CREDIT_LIMIT_WEBHOOK_EVENT_TYPES,
  QUOTE_REQUEST_WEBHOOK_EVENT_TYPES,
  WEBHOOK_BUILT_IN_EVENT_TYPES,
  deliverableWebhookEventTypes,
} from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * What the webhook subscription form offers.
 *
 * **It offers what is delivered and nothing else** (issue #173). The form used
 * to carry thirteen names of its own, of which the backend bridged two, so an
 * operator could subscribe to an event that would never arrive. It now renders
 * one option per element of `deliverableWebhookEventTypes(...)` — the contracts
 * function the backend bridges from and validates against — over the built-in
 * constant and the answer of `GET /api/v1/admin/webhooks/event-types`.
 *
 * **Contributed types** (`specs/143-crm-sales-opportunities/`, User Story 16 —
 * T165, T168; research R-27) come after the built-in ones, each once, and can
 * be subscribed to like any other.
 *
 * **A subscription stored before the rule** may carry a name nothing delivers.
 * It is listed as stored and marked, never hidden and never a failure.
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

/** The built-in event types — the contracts constant the backend bridges from. */
const BUILT_IN: string[] = [...WEBHOOK_BUILT_IN_EVENT_TYPES];

/**
 * The eleven names the form offered while nothing delivered them. Five are
 * still emitted by nothing. The other six — the catalogue, quote and credit
 * events — are delivered now, and are offered only when the module that owns
 * them contributes them: with nothing contributed the form offers none.
 */
const NEVER_DELIVERED = [
  'product.created.v1',
  'product.updated.v1',
  'product.archived.v1',
  'rfq.created.v1',
  'rfq.quoted.v1',
  'rfq.accepted.v1',
  'rfq.expired.v1',
  'order.cancelled.v1',
  'payment.settled.v1',
  'credit_limit.adjusted.v1',
  'credit_limit.reservation_released.v1',
];

const WEBHOOKS_PATH = '/api/v1/admin/webhooks';
const NOT_DELIVERED = 'Not delivered';

let contributed: Array<{ ownerModuleId: string; eventType: string }>;
let stored: Array<Record<string, unknown>>;

function subscription(id: string, eventTypes: string[]): Record<string, unknown> {
  return {
    id,
    name: `Hook ${id}`,
    url: `https://example.test/${id}`,
    eventTypes,
    status: 'active',
    organizationId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** The stored event types the list marks as not delivered. */
function marked(): string[] {
  return Array.from(document.querySelectorAll('[data-undelivered-event-type]')).map(
    (node) => node.getAttribute('data-undelivered-event-type') ?? '',
  );
}

/** The event types the form offers, in the order it offers them. */
function offered(): string[] {
  return Array.from(document.querySelectorAll('form code')).map((node) => node.textContent ?? '');
}

async function renderPage(): Promise<void> {
  renderWithI18n(
    <MemoryRouter>
      <WebhooksPage />
    </MemoryRouter>,
    { core: {}, webhooks: { 'subscription.eventType.notDelivered': NOT_DELIVERED } },
  );
  await waitFor(() => expect(getSpy).toHaveBeenCalledWith(EVENT_TYPES_PATH));
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  contributed = [];
  stored = [];
  getSpy.mockImplementation((path: string) => {
    if (path === EVENT_TYPES_PATH) return Promise.resolve({ data: contributed });
    if (path === WEBHOOKS_PATH) return Promise.resolve({ data: stored });
    return Promise.resolve({ data: [] });
  });
  postSpy.mockResolvedValue({ data: { id: 'w1', secret: '' } });
});

describe('the webhook subscription form — it offers what is delivered', () => {
  it('offers exactly the built-in event types when nothing is contributed', async () => {
    await renderPage();
    await waitFor(() => expect(offered()).toEqual(BUILT_IN));
    expect(offered()).toEqual(['order.created.v1', 'order.status_changed.v1']);
  });

  it('offers none of the names nothing delivers', async () => {
    await renderPage();
    await waitFor(() => expect(offered()).toEqual(BUILT_IN));
    for (const eventType of NEVER_DELIVERED) expect(offered()).not.toContain(eventType);
  });

  it('offers the contributed types after the built-in ones, each once', async () => {
    contributed = [
      { ownerModuleId: 'crm', eventType: 'crm.opportunity.status_changed.v1' },
      { ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' },
      // Already built in: not offered a second time.
      { ownerModuleId: 'orders', eventType: 'order.created.v1' },
    ];
    await renderPage();
    await waitFor(() =>
      expect(offered()).toEqual([...BUILT_IN, 'crm.opportunity.status_changed.v1', 'crm.opportunity.created.v1']),
    );
    // The same function the backend bridges from and validates against.
    expect(offered()).toEqual(deliverableWebhookEventTypes(contributed.map((descriptor) => descriptor.eventType)));
  });

  it('offers the six catalogue, quote and credit events when their modules contribute them, and subscribes to them', async () => {
    const six = [
      ...CATALOG_WEBHOOK_EVENT_TYPES.map((eventType) => ({ ownerModuleId: 'catalog', eventType })),
      ...QUOTE_REQUEST_WEBHOOK_EVENT_TYPES.map((eventType) => ({ ownerModuleId: 'quote_requests', eventType })),
      ...CREDIT_LIMIT_WEBHOOK_EVENT_TYPES.map((eventType) => ({ ownerModuleId: 'credit_limits', eventType })),
    ];
    contributed = six;
    stored = [subscription('w-six', ['rfq.created.v1', 'credit_limit.adjusted.v1'])];
    await renderPage();
    await waitFor(() =>
      expect(offered()).toEqual([
        ...BUILT_IN,
        'product.created.v1',
        'product.updated.v1',
        'product.archived.v1',
        'rfq.created.v1',
        'rfq.expired.v1',
        'credit_limit.adjusted.v1',
      ]),
    );
    // A stored subscription naming them is not marked as undelivered.
    await screen.findByText('Hook w-six');
    expect(marked()).toEqual([]);

    const user = userEvent.setup();
    for (const eventType of ['product.archived.v1', 'rfq.expired.v1', 'credit_limit.adjusted.v1']) {
      await user.click(
        Array.from(document.querySelectorAll('form code')).find((node) => node.textContent === eventType) as HTMLElement,
      );
    }
    await user.type(document.getElementById('webhook-name') as HTMLElement, 'ERP feed');
    await user.type(document.getElementById('webhook-url') as HTMLElement, 'https://example.test/hook');
    await user.click(document.querySelector('form button[type="submit"]') as HTMLElement);
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/webhooks', {
      name: 'ERP feed',
      url: 'https://example.test/hook',
      eventTypes: ['product.archived.v1', 'rfq.expired.v1', 'credit_limit.adjusted.v1'],
    });
  });

  it('with quote_requests and credit_limits switched off their events are not offered, and a stored one is marked', async () => {
    // What `GET …/event-types` answers while those two owners are off: the registry leaves them out.
    contributed = CATALOG_WEBHOOK_EVENT_TYPES.map((eventType) => ({ ownerModuleId: 'catalog', eventType }));
    stored = [subscription('w-off', ['product.created.v1', 'rfq.created.v1', 'credit_limit.adjusted.v1'])];
    await renderPage();
    await waitFor(() => expect(offered()).toEqual([...BUILT_IN, ...CATALOG_WEBHOOK_EVENT_TYPES]));
    await waitFor(() => expect(marked()).toEqual(['rfq.created.v1', 'credit_limit.adjusted.v1']));
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

  it('offers the built-in types when the endpoint cannot be read', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === EVENT_TYPES_PATH) return Promise.reject(new Error('503'));
      return Promise.resolve({ data: [] });
    });
    await renderPage();
    await waitFor(() => expect(offered()).toEqual(BUILT_IN));
    expect(document.body.textContent).not.toContain('503');
  });
});

describe('the webhook list — a subscription stored with a type nothing delivers', () => {
  it('shows every stored type and marks the ones that are not delivered', async () => {
    contributed = [{ ownerModuleId: 'crm', eventType: 'crm.opportunity.created.v1' }];
    stored = [subscription('w1', ['order.created.v1', 'product.updated.v1', 'crm.opportunity.created.v1'])];
    await renderPage();

    await waitFor(() => expect(marked()).toEqual(['product.updated.v1']));
    const row = screen.getByText('Hook w1').closest('tr') as HTMLElement;
    for (const eventType of ['order.created.v1', 'product.updated.v1', 'crm.opportunity.created.v1']) {
      expect(row.textContent).toContain(eventType);
    }
    const badge = document.querySelector('[data-undelivered-event-type="product.updated.v1"]') as HTMLElement;
    expect(badge.getAttribute('title')).toBe(NOT_DELIVERED);
    expect(badge.textContent).toContain(NOT_DELIVERED);
  });

  it('marks nothing on a subscription whose every type is delivered', async () => {
    stored = [subscription('w2', ['order.created.v1', 'order.status_changed.v1'])];
    await renderPage();
    await screen.findByText('Hook w2');
    expect(marked()).toEqual([]);
  });

  it('marks nothing while the contributed types could not be read — an unread list is not an empty one', async () => {
    stored = [subscription('w3', ['crm.opportunity.created.v1', 'order.created.v1'])];
    getSpy.mockImplementation((path: string) => {
      if (path === EVENT_TYPES_PATH) return Promise.reject(new Error('503'));
      if (path === WEBHOOKS_PATH) return Promise.resolve({ data: stored });
      return Promise.resolve({ data: [] });
    });
    await renderPage();
    await screen.findByText('Hook w3');
    expect(marked()).toEqual([]);
  });
});
