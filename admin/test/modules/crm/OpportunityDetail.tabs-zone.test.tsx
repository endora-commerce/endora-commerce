import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { recordTabComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import { CRM_BUNDLE_EN, OPPORTUNITY_ID, ORDER_STATUS_GRAPH, WORKFLOW, detail, en } from './crm-fixtures';

/**
 * `opportunity.detail.tabs` — the tabs other modules add to the Opportunity's
 * tab strip (`specs/183-record-tab-contributions/`, FR-010, FR-011, User
 * Stories 1–3).
 *
 * `crm` enumerates the zone with `useRecordTabZone`, splices the contributed
 * tabs in after Events and before Notes, and selects one from `?tab=<id>`. It
 * names no contributor: the contributor here is a stand-in, `blog`.
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

function ProbePanel({ opportunityId }: { opportunityId: string }): ReactNode {
  return <p>{`probe panel for ${opportunityId}`}</p>;
}

const counter = vi.fn((_props: { opportunityId: string }, _signal: AbortSignal) => Promise.resolve(3));
const countModule = vi.fn(() => Promise.resolve({ default: counter }));
const panelModule = vi.fn(() => Promise.resolve({ default: ProbePanel }));

/** A stand-in contributor's tab, behind a permission of its own. */
const PROBE: AdminContributions = {
  zones: [
    recordTabComponent('opportunity.detail.tabs', panelModule, {
      tab: { id: 'probe', labelKey: 'recordTab.label', countLabelKey: 'recordTab.countLabel' },
      count: countModule,
      weight: 100,
      requiredPermission: 'probe:read',
    }),
    // A contribution taking a host tab's id is never drawn: the host's tab wins.
    recordTabComponent('opportunity.detail.tabs', panelModule, {
      tab: { id: 'notes', labelKey: 'recordTab.label' },
      weight: 200,
      requiredPermission: 'probe:read',
    }),
  ],
};
const REGISTRY = [{ moduleId: 'blog', contributions: PROBE }];
const BLOG_BUNDLE = { 'recordTab.label': 'Probe', 'recordTab.countLabel': '{label}, open: {count}' };

function LocationProbe(): ReactNode {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <>
      <span data-testid="address">{`${location.pathname}${location.search}`}</span>
      <span data-testid="navigation">{type}</span>
    </>
  );
}

const CRM_PRESENT = ['crm', 'orders', 'organizations', 'sales_channels'];

async function renderDetail(
  options: {
    readonly search?: string;
    readonly registry?: typeof REGISTRY | [];
    readonly permissions?: readonly string[];
    readonly present?: readonly string[];
  } = {},
): Promise<HTMLElement> {
  cleanup();
  const { container } = renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[`/crm/opportunities/${OPPORTUNITY_ID}${options.search ?? ''}`]}>
          <Routes>
            <Route
              path="/crm/opportunities/:id"
              element={
                <>
                  <OpportunityDetail />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['crm:read', 'probe:read'])] }),
        presence: modulePresence({ present: [...(options.present ?? [...CRM_PRESENT, 'blog'])] }),
        contributions: options.registry ?? REGISTRY,
      },
    ),
    { crm: CRM_BUNDLE_EN, blog: BLOG_BUNDLE },
  );
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  const panel = await screen.findByRole('tabpanel');
  await waitFor(() => expect(within(panel).queryByText('common.state.loading')).toBeNull());
  return container;
}

const tabNames = (): string[] =>
  within(screen.getByRole('tablist')).getAllByRole('tab').map((tab) => tab.textContent ?? '');

const selected = (): HTMLElement =>
  within(screen.getByRole('tablist'))
    .getAllByRole('tab')
    .find((tab) => tab.getAttribute('aria-selected') === 'true')!;

const address = (): string => screen.getByTestId('address').textContent ?? '';

beforeEach(() => {
  getSpy.mockReset();
  counter.mockClear();
  countModule.mockClear();
  panelModule.mockClear();
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`) return Promise.resolve({ data: detail() });
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    return Promise.resolve({ data: [] });
  });
});

describe('OpportunityDetail — the opportunity.detail.tabs zone', () => {
  it('puts a contributed tab after Events and before Notes, with its count and its accessible name', async () => {
    await renderDetail();
    const events = en('opportunity.tabs.events');
    const notes = en('opportunity.tabs.notes');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Probe, open: 3' })).toBeInTheDocument());
    const names = tabNames();
    const at = names.findIndex((name) => name.startsWith('Probe'));
    expect(names[at - 1]).toMatch(new RegExp(`^${events}`));
    expect(names[at + 1]).toMatch(new RegExp(`^${notes}`));
    expect(names[at]).toBe('Probe 3');
    expect(counter).toHaveBeenCalledWith({ opportunityId: OPPORTUNITY_ID }, expect.any(AbortSignal));
    // The colliding contribution is not drawn: one Notes tab, the host's.
    expect(names.filter((name) => name.startsWith(notes))).toHaveLength(1);
    // Nothing of the panel is fetched until the tab is opened.
    expect(panelModule).not.toHaveBeenCalled();
  });

  it('opens it on select, replacing the address, and renders its panel', async () => {
    await renderDetail();
    await userEvent.click(await screen.findByRole('tab', { name: 'Probe, open: 3' }));
    await waitFor(() => expect(address()).toBe(`/crm/opportunities/${OPPORTUNITY_ID}?tab=probe`));
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE');
    const panel = screen.getByRole('tabpanel');
    expect(await within(panel).findByText(`probe panel for ${OPPORTUNITY_ID}`)).toBeInTheDocument();
    expect(panel).toHaveAttribute('aria-labelledby', selected().id);
  });

  it('selects it on first paint from ?tab=<id>', async () => {
    await renderDetail({ search: '?tab=probe' });
    expect(selected().textContent).toMatch(/^Probe/);
    expect(await within(screen.getByRole('tabpanel')).findByText(`probe panel for ${OPPORTUNITY_ID}`)).toBeInTheDocument();
  });

  it('passes axe on the strip and the contributed panel', async () => {
    const container = await renderDetail({ search: '?tab=probe' });
    await within(screen.getByRole('tabpanel')).findByText(`probe panel for ${OPPORTUNITY_ID}`);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Probe, open: 3' })).toBeInTheDocument());
    await expectNoAxeViolations(container.querySelector('[role="tablist"]')!.closest('[data-slot="card"]')!);
  });

  it('opens the Overview for ?tab=<id> of a tab the reader may not see, and leaves the address alone', async () => {
    for (const hidden of [
      { permissions: ['crm:read'] },
      { present: CRM_PRESENT },
    ] as const) {
      await renderDetail({ search: '?tab=probe', ...hidden });
      expect(selected().textContent).toBe(en('opportunity.tabs.overview'));
      expect(tabNames().some((name) => name.startsWith('Probe'))).toBe(false);
      expect(address()).toBe(`/crm/opportunities/${OPPORTUNITY_ID}?tab=probe`);
    }
    // Hidden: neither its count nor its panel was imported.
    expect(countModule).not.toHaveBeenCalled();
    expect(panelModule).not.toHaveBeenCalled();
  });

  it('draws the host’s own strip unchanged when nobody contributes', async () => {
    await renderDetail({ registry: [] });
    expect(tabNames().map((name) => name.replace(/ \d+$/, ''))).toEqual(
      ['overview', 'links', 'events', 'notes', 'messages', 'attachments', 'history'].map((id) =>
        en(`opportunity.tabs.${id}`),
      ),
    );
  });

  it('leaves the host naming no contributor', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/crm/src/admin/pages/OpportunityDetail.tsx'),
      'utf8',
    );
    expect(source).toContain("useRecordTabZone('opportunity.detail.tabs'");
    expect(source).not.toMatch(/mod-tasks|tasks:|TasksPanel|'tasks'/i);
  });
});
