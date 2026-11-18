import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { CRM_BUNDLE_EN, OPPORTUNITY_ID, ORDER_STATUS_GRAPH, WORKFLOW, detail, en } from './crm-fixtures';
import { markup } from '../../helpers/react-ids';

/**
 * `opportunity.detail.after` — the stack of panels an Opportunity's screen ends
 * with (`specs/163-projects-and-tasks/contracts/admin-surfaces.md` §3, task
 * T095; model `orders/OrderDetail.after-zone.test.tsx`).
 *
 * `crm` mounts the zone once, after the card holding the tabs, hands it the
 * Opportunity's id and knows nothing of who fills it. **With nobody
 * contributing — no module, a module that is switched off, or a person
 * without the contribution's permission — the rendered screen is the one
 * without the zone, byte for byte.** The contributor here is a stand-in, so
 * the host's test names no real module.
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

const { OpportunityDetail } = await import('../../../../packages/modules/crm/src/admin/pages/OpportunityDetail');

function Probe({ opportunityId }: { opportunityId: string }): ReactNode {
  return <aside data-testid="after-probe">{`panel for ${opportunityId}`}</aside>;
}

/** A stand-in contributor: one panel, behind a permission of its own. */
const PROBE: AdminContributions = {
  zones: [
    zoneComponent('opportunity.detail.after', () => Promise.resolve({ default: Probe }), {
      weight: 100,
      requiredPermission: 'probe:read',
    }),
  ],
};
const REGISTRY = [{ moduleId: 'blog', contributions: PROBE }];

async function renderDetail(options: {
  readonly registry: typeof REGISTRY | [];
  readonly permissions: readonly string[];
  readonly present: readonly string[];
}): Promise<HTMLElement> {
  cleanup();
  const { container } = renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[`/crm/opportunities/${OPPORTUNITY_ID}`]}>
          <Routes>
            <Route path="/crm/opportunities/:id" element={<OpportunityDetail />} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: [...options.permissions] }),
        presence: modulePresence({ present: [...options.present] }),
        contributions: options.registry,
      },
    ),
    { crm: CRM_BUNDLE_EN },
  );
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  // The tab is a lazy component, and the stage bar reads the workflow after the header.
  const panel = await screen.findByRole('tabpanel');
  await waitFor(() => expect(within(panel).queryByText('common.state.loading')).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole('region', { name: en('opportunity.section.status') })).not.toHaveAttribute('aria-busy', 'true'),
  );
  return container;
}

const CRM_PRESENT = ['crm', 'orders', 'organizations', 'sales_channels'];

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`) return Promise.resolve({ data: detail() });
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    return Promise.resolve({ data: [] });
  });
});

describe('OpportunityDetail — the opportunity.detail.after zone', () => {
  it('renders a contribution with the Opportunity’s id, after the card holding the tabs', async () => {
    const container = await renderDetail({
      registry: REGISTRY,
      permissions: ['crm:read', 'probe:read'],
      present: [...CRM_PRESENT, 'blog'],
    });
    const probe = await screen.findByTestId('after-probe');
    expect(probe).toHaveTextContent(`panel for ${OPPORTUNITY_ID}`);
    const tablist = screen.getByRole('tablist');
    expect(tablist.compareDocumentPosition(probe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.lastElementChild?.contains(probe)).toBe(true);
  });

  it('is identical to the screen with nobody contributing when the contributor is switched off', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: ['crm:read', 'probe:read'], present: CRM_PRESENT }),
    );
    const off = markup(
      await renderDetail({ registry: REGISTRY, permissions: ['crm:read', 'probe:read'], present: CRM_PRESENT }),
    );
    expect(off).toBe(baseline);
    expect(off).not.toContain('after-probe');
  });

  it('is identical to it for somebody without the contribution’s permission', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: ['crm:read'], present: [...CRM_PRESENT, 'blog'] }),
    );
    const refused = markup(
      await renderDetail({ registry: REGISTRY, permissions: ['crm:read'], present: [...CRM_PRESENT, 'blog'] }),
    );
    expect(refused).toBe(baseline);
  });

  it('is the control: the two renders do differ once the contribution is shown', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: ['crm:read', 'probe:read'], present: [...CRM_PRESENT, 'blog'] }),
    );
    const shown = await renderDetail({
      registry: REGISTRY,
      permissions: ['crm:read', 'probe:read'],
      present: [...CRM_PRESENT, 'blog'],
    });
    await screen.findByTestId('after-probe');
    expect(markup(shown)).not.toBe(baseline);
  });

  it('leaves the host naming no contributor', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/crm/src/admin/pages/OpportunityDetail.tsx'),
      'utf8',
    );
    expect(source).toContain('<AdminZone name="opportunity.detail.after" props={{ opportunityId: id }} chrome="card" />');
    expect(source).not.toMatch(/mod-projects|projects:|ProjectPanel/i);
  });
});
