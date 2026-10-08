import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `order.detail.after` — the stack of panels an order's screen ends with
 * (`specs/143-crm-sales-opportunities/contracts/foreign-module-changes.md` §J).
 *
 * The host mounts the zone once, below its tab panels, hands it the order's id
 * and knows nothing of who fills it. **With nobody contributing — no module,
 * a module that is switched off, or a person without the contribution's
 * permission — the rendered screen is the one without the zone, byte for
 * byte**: no heading, no wrapper element, no spacing. That is the half this
 * file exists for; the contributor used here is a stand-in, so the host's test
 * names no real module.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OrderDetail } = await import('../../../../packages/modules/orders/src/admin/pages/OrderDetail');

function Probe({ orderId }: { orderId: string }): ReactNode {
  return <aside data-testid="after-probe">{`panel for ${orderId}`}</aside>;
}

/** A stand-in contributor: one panel, behind a permission of its own. */
const PROBE: AdminContributions = {
  zones: [
    zoneComponent('order.detail.after', () => Promise.resolve({ default: Probe }), {
      weight: 100,
      requiredPermission: 'probe:read',
    }),
  ],
};
const REGISTRY = [{ moduleId: 'blog', contributions: PROBE }];

const ORDER = {
  id: 'o1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'on_hold',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'DM' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'PM' }, kind: 'gateway' },
  items: [],
  subtotal: 10,
  taxTotal: 0,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 10,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-05-22T12:00:00Z',
};

const BUNDLE = passthroughBundle('core', ['orderDetail.tabs.overview', 'orderDetail.tabs.delivery']);

async function renderDetail(options: {
  readonly registry: typeof REGISTRY | [];
  readonly permissions: readonly string[];
  readonly present: readonly string[];
}): Promise<HTMLElement> {
  cleanup();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: { statuses: [{ code: 'on_hold', name: { en: 'On Hold' }, isTerminal: false }], transitions: [] },
      });
    }
    return Promise.resolve({ data: [] });
  });
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...options.permissions] }),
        presence: modulePresence({ present: [...options.present] }),
        contributions: options.registry,
      },
    ),
    BUNDLE,
  );
  await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
  return container;
}

/** The screen's markup with React's per-render ids taken out, so two renders compare. */
function markup(container: HTMLElement): string {
  return container.innerHTML.replace(/(id|for|aria-[a-z]+)="(:r[0-9a-z]+:|«r[0-9a-z]+»)"/g, '$1="_"');
}

beforeEach(() => {
  getSpy.mockReset();
});

describe('OrderDetail — the order.detail.after zone', () => {
  it('renders a contribution with the order’s id, after the tab panels', async () => {
    const container = await renderDetail({
      registry: REGISTRY,
      permissions: ['orders:read', 'probe:read'],
      present: ['orders', 'blog'],
    });
    const probe = await screen.findByTestId('after-probe');
    expect(probe).toHaveTextContent('panel for o1');
    // Below the tab panels: it follows the card that holds them.
    const tablist = screen.getByRole('tablist');
    expect(tablist.compareDocumentPosition(probe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.lastElementChild?.contains(probe)).toBe(true);
  });

  it('is identical to the screen with nobody contributing when the contributor is switched off', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['orders:read', 'probe:read'], present: ['orders'] }));
    const off = markup(
      await renderDetail({ registry: REGISTRY, permissions: ['orders:read', 'probe:read'], present: ['orders'] }),
    );
    expect(off).toBe(baseline);
    expect(off).not.toContain('after-probe');
  });

  it('is identical to it for somebody without the contribution’s permission', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['orders:read'], present: ['orders', 'blog'] }));
    const refused = markup(
      await renderDetail({ registry: REGISTRY, permissions: ['orders:read'], present: ['orders', 'blog'] }),
    );
    expect(refused).toBe(baseline);
  });

  it('adds no element of its own: with nobody contributing the screen ends with the tab card', async () => {
    const container = await renderDetail({ registry: [], permissions: ['orders:read'], present: ['orders'] });
    const tablist = screen.getByRole('tablist');
    // The last element of the screen is the card holding the tabs — nothing after it.
    expect(container.lastElementChild?.contains(tablist)).toBe(true);
  });

  it('is the control: the two renders do differ once the contribution is shown', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['orders:read', 'probe:read'], present: ['orders', 'blog'] }));
    const shown = await renderDetail({
      registry: REGISTRY,
      permissions: ['orders:read', 'probe:read'],
      present: ['orders', 'blog'],
    });
    await screen.findByTestId('after-probe');
    expect(markup(shown)).not.toBe(baseline);
  });

  it('leaves the host naming no contributor', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/orders/src/admin/pages/OrderDetail.tsx'),
      'utf8',
    );
    expect(source).toContain('<AdminZone name="order.detail.after" props={{ orderId: id }} />');
    expect(source).not.toMatch(/mod-crm|crm:|opportunit/i);
  });
});
