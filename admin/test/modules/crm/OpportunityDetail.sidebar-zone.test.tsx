import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { EditorSection } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { CRM_BUNDLE_EN, OPPORTUNITY_ID, ORDER_STATUS_GRAPH, WORKFLOW, detail, en } from './crm-fixtures';
import { markup } from '../../helpers/react-ids';

/**
 * `opportunity.detail.sidebar` — the last sections of the Opportunity's
 * sidebar card (issues #1452 and #1526, UX audit DS-20 and WORK-12).
 *
 * `crm` mounts the zone once, inside `OpportunitySidebar`'s card, hands it the
 * Opportunity's id and knows nothing of who fills it. A contribution is a
 * section of that card — never a card in a card, and never after the grid.
 * **With nobody contributing the rendered screen is the one without the zone,
 * byte for byte.** The contributors here are stand-ins.
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

function FirstProbe({ opportunityId }: { opportunityId: string }): ReactNode {
  return <EditorSection title="First probe">{`first for ${opportunityId}`}</EditorSection>;
}
function SecondProbe({ opportunityId }: { opportunityId: string }): ReactNode {
  return <EditorSection title="Second probe">{`second for ${opportunityId}`}</EditorSection>;
}

/** Two stand-in contributors behind a permission of their own, declared out of weight order. */
const PROBE: AdminContributions = {
  zones: [
    zoneComponent('opportunity.detail.sidebar', () => Promise.resolve({ default: SecondProbe }), {
      weight: 200,
      requiredPermission: 'probe:read',
    }),
    zoneComponent('opportunity.detail.sidebar', () => Promise.resolve({ default: FirstProbe }), {
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

describe('OpportunityDetail — the opportunity.detail.sidebar zone', () => {
  it('renders the contributions as the last sections of the sidebar card, in weight order', async () => {
    const container = await renderDetail({
      registry: REGISTRY,
      permissions: ['crm:read', 'probe:read'],
      present: [...CRM_PRESENT, 'blog'],
    });
    const aside = screen.getByRole('complementary', { name: en('opportunity.section.details') });
    const second = await within(aside).findByRole('region', { name: 'Second probe' });
    const first = within(aside).getByRole('region', { name: 'First probe' });
    expect(first).toHaveTextContent(`first for ${OPPORTUNITY_ID}`);
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Sections of the one sidebar card: no card in a card.
    expect(aside.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    // Last in the card: nothing of the host's follows them.
    const content = aside.querySelector('[data-slot="card-content"]')!;
    expect(content.lastElementChild?.contains(second)).toBe(true);
    // Nothing renders after the grid.
    expect(container.lastElementChild?.contains(aside)).toBe(true);
  });

  it('is identical to the screen with nobody contributing when the contributor is switched off', async () => {
    const baseline = markup(
      await renderDetail({ registry: [], permissions: ['crm:read', 'probe:read'], present: CRM_PRESENT }),
    );
    const off = markup(
      await renderDetail({ registry: REGISTRY, permissions: ['crm:read', 'probe:read'], present: CRM_PRESENT }),
    );
    expect(off).toBe(baseline);
    expect(off).not.toContain('First probe');
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

  it('leaves the host naming no contributor', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/crm/src/admin/pages/opportunity-detail/OpportunitySidebar.tsx'),
      'utf8',
    );
    expect(source).toContain(
      '<AdminZone name="opportunity.detail.sidebar" props={{ opportunityId: opportunity.id }} chrome="section" />',
    );
    expect(source).not.toMatch(/mod-projects|mod-tasks|projects:|tasks:|ProjectPanel|TasksPanel/i);
  });
});
