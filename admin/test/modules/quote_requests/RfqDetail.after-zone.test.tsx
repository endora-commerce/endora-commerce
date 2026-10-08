import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `quote_request.detail.after` — the stack of panels a quote request's screen
 * ends with (`specs/143-crm-sales-opportunities/contracts/foreign-module-changes.md` §J).
 *
 * The host mounts the zone once, below its tab card, hands it the request's id
 * and knows nothing of who fills it. **With nobody contributing — no module, a
 * module that is switched off, or a person without the contribution's
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

const RFQ_ID = '00000000-0000-4000-8000-0000000000a9';

function Probe({ quoteRequestId }: { quoteRequestId: string }): ReactNode {
  return <aside data-testid="after-probe">{`panel for ${quoteRequestId}`}</aside>;
}

/** A stand-in contributor: one panel, behind a permission of its own. */
const PROBE: AdminContributions = {
  zones: [
    zoneComponent('quote_request.detail.after', () => Promise.resolve({ default: Probe }), {
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
    { core: CORE_EN },
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

describe('RfqDetail — the quote_request.detail.after zone', () => {
  it('renders a contribution with the request’s id, after the tab card', async () => {
    const container = await renderDetail({
      registry: REGISTRY,
      permissions: ['rfqs:handle', 'probe:read'],
      present: ['quote_requests', 'blog'],
    });
    const probe = await screen.findByTestId('after-probe');
    expect(probe).toHaveTextContent(`panel for ${RFQ_ID}`);
    const tablist = screen.getByRole('tablist');
    expect(tablist.compareDocumentPosition(probe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.lastElementChild?.contains(probe)).toBe(true);
  });

  it('is identical to the screen with nobody contributing when the contributor is switched off', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: ['rfqs:handle', 'probe:read'], present: ['quote_requests'] }),
    );
    const off = markup(
      await renderDetail({ registry: REGISTRY, permissions: ['rfqs:handle', 'probe:read'], present: ['quote_requests'] }),
    );
    expect(off).toBe(baseline);
    expect(off).not.toContain('after-probe');
  });

  it('is identical to it for somebody without the contribution’s permission', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: ['rfqs:handle'], present: ['quote_requests', 'blog'] }),
    );
    const refused = markup(
      await renderDetail({ registry: REGISTRY, permissions: ['rfqs:handle'], present: ['quote_requests', 'blog'] }),
    );
    expect(refused).toBe(baseline);
  });

  it('adds no element of its own: with nobody contributing the screen ends with the tab card', async () => {
    const container = await renderDetail({ registry: [], permissions: ['rfqs:handle'], present: ['quote_requests'] });
    const tablist = screen.getByRole('tablist');
    expect(container.lastElementChild?.contains(tablist)).toBe(true);
  });

  it('is the control: the two renders do differ once the contribution is shown', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: ['rfqs:handle', 'probe:read'], present: ['quote_requests', 'blog'] }),
    );
    const shown = await renderDetail({
      registry: REGISTRY,
      permissions: ['rfqs:handle', 'probe:read'],
      present: ['quote_requests', 'blog'],
    });
    await screen.findByTestId('after-probe');
    expect(markup(shown)).not.toBe(baseline);
  });

  it('leaves the host naming no contributor, and the module importing none', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/quote_requests/src/admin/pages/RfqDetail.tsx'),
      'utf8',
    );
    expect(source).toContain('<AdminZone name="quote_request.detail.after" props={{ quoteRequestId: id }} />');
    expect(source).not.toMatch(/mod-crm|crm:|opportunit/i);
    const manifest = readFileSync(
      resolve(process.cwd(), '../packages/modules/quote_requests/package.json'),
      'utf8',
    );
    expect(manifest).not.toContain('mod-crm');
  });
});
