import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { EditorSection } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { markup } from '../../helpers/react-ids';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `quote_request.detail.sidebar` — the quote request detail's sidebar card
 * (issue #1452, UX audit DS-20; WORK-12, #1526), on `order.detail.sidebar`'s
 * terms: the column is drawn only while the zone has a contribution, and then
 * it is one labelled `<aside>` holding one card whose sections are the
 * contributions, in weight order. The contributors are stand-ins.
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

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, ProductPicker: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const QR_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/quote_requests/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const QR_PL = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/quote_requests/i18n/pl.json'), 'utf8'),
) as Record<string, string>;
const SIDEBAR_LABEL = QR_EN['detail.sidebar.label']!;

const RFQ_ID = '00000000-0000-4000-8000-0000000000a9';

function FirstProbe({ quoteRequestId }: { quoteRequestId: string }): ReactNode {
  return <EditorSection title="First probe">{`first for ${quoteRequestId}`}</EditorSection>;
}
function SecondProbe({ quoteRequestId }: { quoteRequestId: string }): ReactNode {
  return <EditorSection title="Second probe">{`second for ${quoteRequestId}`}</EditorSection>;
}

/** Two stand-in contributors behind a permission of their own, declared out of weight order. */
const PROBE: AdminContributions = {
  zones: [
    zoneComponent('quote_request.detail.sidebar', () => Promise.resolve({ default: SecondProbe }), {
      weight: 200,
      requiredPermission: 'probe:read',
    }),
    zoneComponent('quote_request.detail.sidebar', () => Promise.resolve({ default: FirstProbe }), {
      weight: 100,
      requiredPermission: 'probe:read',
    }),
  ],
};
const REGISTRY = [{ moduleId: 'blog', contributions: PROBE }];

const RFQ = {
  id: RFQ_ID,
  businessId: 'RFQ-0001',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  customerAccountId: '00000000-0000-4000-8000-0000000000c1',
  organization: null,
  customer: null,
  createdByAdminUserId: null,
  assignedAdminUserId: null,
  status: 'Pending',
  awaitingCustomerRevisionAcceptance: false,
  currentRevisionNumber: 1,
  headerNote: null,
  cancellationReason: null,
  customFieldValues: {},
  items: [],
  events: [],
  submittedAt: '2026-08-01T10:00:00.000Z',
  approvedAt: null,
  canceledAt: null,
  completedAt: null,
  expiredAt: null,
  expiresAt: null,
  convertedOrderId: null,
  taxRate: 0,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  version: 3,
};

async function renderDetail(options: {
  readonly registry: typeof REGISTRY | [];
  readonly permissions: readonly string[];
  readonly present: readonly string[];
}): Promise<HTMLElement> {
  cleanup();
  getSpy.mockImplementation((url: string) => {
    if (url === '/api/v1/admin/custom-fields/definitions?entityType=quote_request') {
      return Promise.resolve({ data: [] });
    }
    if (url.startsWith('/api/v1/admin/quote-requests/')) return Promise.resolve({ data: RFQ });
    return Promise.resolve({ data: [] });
  });
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/quote-requests/${RFQ_ID}`]}>
        <Routes>
          <Route path="/quote-requests/:id" element={<RfqDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...options.permissions] }),
        presence: modulePresence({ present: [...options.present] }),
        contributions: options.registry,
      },
    ),
    { core: CORE_EN, quote_requests: QR_EN },
  );
  await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
  return container;
}

beforeEach(() => {
  getSpy.mockReset();
});

describe('RfqDetail — the quote_request.detail.sidebar zone', () => {
  it('draws one labelled sidebar card whose sections are the contributions, in weight order', async () => {
    await renderDetail({ registry: REGISTRY, permissions: ['rfqs:handle', 'probe:read'], present: ['quote_requests', 'blog'] });
    const aside = await screen.findByRole('complementary', { name: SIDEBAR_LABEL });
    await within(aside).findByRole('region', { name: 'Second probe' });
    const sections = within(aside).getAllByRole('region');
    expect(sections.map((node) => node.textContent)).toEqual([
      `First probefirst for ${RFQ_ID}`,
      `Second probesecond for ${RFQ_ID}`,
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
      permissions: ['rfqs:handle', 'probe:read'],
      present: ['quote_requests', 'blog'],
    });
    const aside = await screen.findByRole('complementary', { name: SIDEBAR_LABEL });
    await within(aside).findByRole('region', { name: 'Second probe' });
    await expectNoAxeViolations(container);
  });

  it('draws no column and is identical to the screen without the zone when the contributor is switched off', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['rfqs:handle', 'probe:read'], present: ['quote_requests'] }));
    const off = await renderDetail({ registry: REGISTRY, permissions: ['rfqs:handle', 'probe:read'], present: ['quote_requests'] });
    expect(markup(off)).toBe(baseline);
    expect(off.querySelector('aside')).toBeNull();
  });

  it('is identical to it for somebody without the contribution’s permission', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['rfqs:handle'], present: ['quote_requests', 'blog'] }));
    const refused = await renderDetail({ registry: REGISTRY, permissions: ['rfqs:handle'], present: ['quote_requests', 'blog'] });
    expect(markup(refused)).toBe(baseline);
    expect(refused.querySelector('aside')).toBeNull();
  });

  it('is the control: the two renders do differ once the contributions are shown', async () => {
    const baseline = markup(await renderDetail({ registry: [], permissions: ['rfqs:handle', 'probe:read'], present: ['quote_requests', 'blog'] }));
    const shown = await renderDetail({ registry: REGISTRY, permissions: ['rfqs:handle', 'probe:read'], present: ['quote_requests', 'blog'] });
    await screen.findByRole('region', { name: 'First probe' });
    expect(markup(shown)).not.toBe(baseline);
  });

  it('leaves the host naming no contributor, and ships the label in English and Polish', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/quote_requests/src/admin/pages/RfqDetail.tsx'),
      'utf8',
    );
    expect(source).toContain('<AdminZone name="quote_request.detail.sidebar" props={{ quoteRequestId: id }} chrome="section" />');
    expect(source).not.toMatch(/mod-crm|mod-projects|mod-tasks|crm:|opportunit/i);
    expect(QR_EN['detail.sidebar.label']).toBeTruthy();
    expect(QR_PL['detail.sidebar.label']).toBeTruthy();
  });
});
