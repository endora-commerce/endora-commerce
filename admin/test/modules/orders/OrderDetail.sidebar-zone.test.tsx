import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { EditorSection } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { markup } from '../../helpers/react-ids';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `order.detail.sidebar` — the order detail's sidebar card (issue #1452, UX
 * audit DS-20; WORK-12, #1526).
 *
 * The host draws a 20rem column beside its tabs **only while the zone has a
 * contribution**: with nobody contributing — no module, a module that is
 * switched off, or a person without the contribution's permission — the screen
 * is the single column it was, byte for byte. With contributors, the column is
 * one labelled `<aside>` holding one card, and every contribution is a section
 * of it, never a card in a card, in weight order. The contributors here are
 * stand-ins, so the host's test names no real module.
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

const ORDERS_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/orders/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const ORDERS_PL = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/orders/i18n/pl.json'), 'utf8'),
) as Record<string, string>;
const SIDEBAR_LABEL = ORDERS_EN['detail.sidebar.label']!;

function FirstProbe({ orderId }: { orderId: string }): ReactNode {
  return <EditorSection title="First probe">{`first for ${orderId}`}</EditorSection>;
}
function SecondProbe({ orderId }: { orderId: string }): ReactNode {
  return <EditorSection title="Second probe">{`second for ${orderId}`}</EditorSection>;
}

/** Two stand-in contributors behind a permission of their own, declared out of weight order. */
const PROBE: AdminContributions = {
  zones: [
    zoneComponent('order.detail.sidebar', () => Promise.resolve({ default: SecondProbe }), {
      weight: 200,
      requiredPermission: 'probe:read',
    }),
    zoneComponent('order.detail.sidebar', () => Promise.resolve({ default: FirstProbe }), {
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

const BUNDLE = {
  ...passthroughBundle('core', ['orderDetail.tabs.overview', 'orderDetail.tabs.delivery']),
  orders: ORDERS_EN,
};

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

beforeEach(() => {
  getSpy.mockReset();
});

describe('OrderDetail — the order.detail.sidebar zone', () => {
  it('draws one labelled sidebar card whose sections are the contributions, in weight order', async () => {
    await renderDetail({ registry: REGISTRY, permissions: ['orders:read', 'probe:read'], present: ['orders', 'blog'] });
    const aside = await screen.findByRole('complementary', { name: SIDEBAR_LABEL });
    await within(aside).findByRole('region', { name: 'Second probe' });
    const sections = within(aside).getAllByRole('region');
    expect(sections.map((node) => node.textContent)).toEqual([
      'First probefirst for o1',
      'Second probesecond for o1',
    ]);
    // One card; each contribution a section of it, never a card in a card.
    expect(aside.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    for (const section of sections) expect(section.closest('[data-slot="card"]')?.parentElement).toBe(aside);
    expect(aside.querySelectorAll('[data-slot="editor-section"]')).toHaveLength(2);
    // After the tabs in DOM order, so the main content comes first on a narrow screen.
    const tablist = screen.getByRole('tablist');
    expect(tablist.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('passes axe with the sidebar drawn', async () => {
    const container = await renderDetail({
      registry: REGISTRY,
      permissions: ['orders:read', 'probe:read'],
      present: ['orders', 'blog'],
    });
    const aside = await screen.findByRole('complementary', { name: SIDEBAR_LABEL });
    await within(aside).findByRole('region', { name: 'Second probe' });
    await expectNoAxeViolations(container);
  });

  it('draws no column and is identical to the screen without the zone when the contributor is switched off', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['orders:read', 'probe:read'], present: ['orders'] }));
    const off = await renderDetail({ registry: REGISTRY, permissions: ['orders:read', 'probe:read'], present: ['orders'] });
    expect(markup(off)).toBe(baseline);
    expect(off.querySelector('aside')).toBeNull();
  });

  it('is identical to it for somebody without the contribution’s permission', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['orders:read'], present: ['orders', 'blog'] }));
    const refused = await renderDetail({ registry: REGISTRY, permissions: ['orders:read'], present: ['orders', 'blog'] });
    expect(markup(refused)).toBe(baseline);
    expect(refused.querySelector('aside')).toBeNull();
  });

  it('is the control: the two renders do differ once the contributions are shown', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['orders:read', 'probe:read'], present: ['orders', 'blog'] }));
    const shown = await renderDetail({ registry: REGISTRY, permissions: ['orders:read', 'probe:read'], present: ['orders', 'blog'] });
    await screen.findByRole('region', { name: 'First probe' });
    expect(markup(shown)).not.toBe(baseline);
  });

  it('leaves the host naming no contributor, and ships the label in English and Polish', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/orders/src/admin/pages/OrderDetail.tsx'),
      'utf8',
    );
    expect(source).toContain('<AdminZone name="order.detail.sidebar" props={{ orderId: id }} chrome="section" />');
    expect(source).not.toMatch(/mod-crm|mod-projects|mod-tasks|crm:|opportunit/i);
    expect(ORDERS_EN['detail.sidebar.label']).toBeTruthy();
    expect(ORDERS_PL['detail.sidebar.label']).toBeTruthy();
  });
});
