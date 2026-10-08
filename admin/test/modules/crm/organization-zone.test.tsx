import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { CRM_BUNDLE_EN, OPPORTUNITY_ID, ORGANIZATION_ID, en, summary } from './crm-fixtures';

/**
 * CRM's panel on the Organization screen (`specs/143-crm-sales-opportunities/`,
 * User Story 14 — task T136; `contracts/admin-surfaces.md` §5).
 *
 * `organizations` mounts `organization.detail.after` and knows nothing of who
 * fills it. CRM contributes one panel: the Organization's open Opportunities,
 * each with its status and value and a link to it, and a "New opportunity" link
 * carrying the Organization. The zone renderer applies both presence axes and
 * the contribution's permission, so with `crm` off, or for somebody without
 * `crm:read`, the Organization screen shows nothing of CRM — and asks nothing.
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

const crm = await import('@endora-commerce/mod-crm/admin');
const REGISTRY = [{ moduleId: 'crm', contributions: crm.contributions }];
const LIST_URL = `/api/v1/admin/crm/opportunities?state=open&organizationId=${ORGANIZATION_ID}&limit=10`;

function renderZone(
  options: { readonly permissions?: readonly string[]; readonly present?: readonly string[] } = {},
): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[`/organizations/${ORGANIZATION_ID}`]}>
          <AdminZone name="organization.detail.after" props={{ organizationId: ORGANIZATION_ID }} />
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['crm:read', 'crm:write'])] }),
        presence: modulePresence({ present: [...(options.present ?? ['crm', 'organizations'])] }),
        contributions: REGISTRY,
      },
    ),
    { crm: CRM_BUNDLE_EN },
  );
  return container;
}

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === LIST_URL) {
      return Promise.resolve({
        data: [
          summary(),
          summary({
            id: '00000000-0000-4000-8000-0000000000b2',
            number: 'OPP-000124',
            title: 'Spare parts contract',
            status: { code: 'proposal', name: 'Proposal', color: '#8b5cf6', kind: 'open' },
            value: null,
          }),
        ],
        pagination: { cursor: null, hasMore: false, limit: 10 },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('crm contributes the organization detail zone', () => {
  it('declares the contribution on crm:read, behind a dynamic import', () => {
    const zone = (crm.contributions.zones ?? []).find((entry) => entry.zone === 'organization.detail.after');
    expect(zone).toBeDefined();
    expect(zone?.requiredPermission).toBe('crm:read');
    expect(zone?.weight).toBe(600);
    expect(zone?.match).toBeUndefined();
    expect(typeof zone?.component).toBe('function');
  });

  it('lists the organization’s open opportunities with status and value, each linking to its screen', async () => {
    renderZone();
    const heading = await screen.findByRole('heading', { name: en('organizationPanel.title') });
    const panel = heading.closest('section') as HTMLElement;
    const first = await within(panel).findByRole('link', { name: /OPP-000001/ });
    expect(first).toHaveAttribute('href', `/crm/opportunities/${OPPORTUNITY_ID}`);
    expect(within(panel).getByText('Fleet renewal')).toBeTruthy();
    expect(within(panel).getByText('New')).toBeTruthy();
    expect(within(panel).getByText(/12[,\s.]?500/)).toBeTruthy();
    expect(within(panel).getByText('Proposal')).toBeTruthy();
    expect(getSpy.mock.calls.map(([path]) => path)).toEqual([LIST_URL]);
  });

  it('offers "New opportunity" carrying the organization, to somebody who may create one', async () => {
    renderZone();
    const link = await screen.findByRole('link', { name: en('organizationPanel.new') });
    expect(link).toHaveAttribute('href', `/crm/opportunities/new?organizationId=${ORGANIZATION_ID}`);
  });

  it('shows the list and no "New opportunity" to somebody who may only read', async () => {
    renderZone({ permissions: ['crm:read'] });
    await screen.findByRole('link', { name: /OPP-000001/ });
    expect(screen.queryByRole('link', { name: en('organizationPanel.new') })).toBeNull();
  });

  it('says so when the organization has no open opportunity', async () => {
    getSpy.mockResolvedValue({ data: [], pagination: { cursor: null, hasMore: false, limit: 10 } });
    renderZone();
    expect(await screen.findByText(en('organizationPanel.empty'))).toBeTruthy();
  });

  it('says so when the list cannot be read', async () => {
    getSpy.mockRejectedValue(new Error('offline'));
    renderZone();
    expect(await screen.findByRole('alert')).toHaveTextContent(en('organizationPanel.error'));
  });

  it('renders nothing and asks nothing without crm:read', async () => {
    const container = renderZone({ permissions: ['customers:read', 'orders:read'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.querySelector('section')).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders nothing and asks nothing while crm is not in the enabled set', async () => {
    const container = renderZone({ present: ['organizations'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.querySelector('section')).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });
});
