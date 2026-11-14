import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { ORGANIZATION_ID, PROJECT_ID, en, renderProjects, summary } from './projects-fixtures';

/**
 * Projects' panel on the Organization screen (`specs/163-projects-and-tasks/`,
 * User Story 11 — task T133; `contracts/admin-surfaces.md` §3, §7).
 *
 * `organizations` mounts `organization.detail.after` and knows nothing of who
 * fills it. Projects contributes one panel, behind `projects:read`: the
 * Organization's Projects the reader may see — the list endpoint applies
 * Organization reach and visibility — each with its state and current Stage
 * and a link to it, and a "New project" link carrying the Organization, offered
 * only to somebody who may create one. With `projects` off, or without
 * `projects:read`, the Organization screen shows nothing of Projects and asks
 * nothing.
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

const projects = await import('@endora-commerce/mod-projects/admin');
const REGISTRY = [{ moduleId: 'projects', contributions: projects.contributions }];
const LIST_URL = `/api/v1/admin/projects?organizationId=${ORGANIZATION_ID}&limit=10`;
const SECOND_ID = '00000000-0000-4000-8000-0000000000f2';

function renderZone(
  options: { readonly permissions?: readonly string[]; readonly present?: readonly string[] } = {},
): HTMLElement {
  cleanup();
  const { container } = renderProjects(
    <AdminZone name="organization.detail.after" props={{ organizationId: ORGANIZATION_ID }} />,
    {
      permissions: options.permissions ?? ['projects:read', 'projects:write'],
      present: options.present ?? ['projects', 'organizations'],
      path: `/organizations/${ORGANIZATION_ID}`,
      contributions: REGISTRY,
    },
  );
  return container;
}

beforeEach(() => {
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === LIST_URL) {
      return Promise.resolve({
        items: [
          summary(),
          summary({
            id: SECOND_ID,
            number: 'PRJ-000002',
            title: 'Showroom refit',
            state: 'completed',
            currentStage: null,
            closedAt: '2026-10-25T10:00:00.000Z',
          }),
        ],
        nextCursor: null,
        total: 2,
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('projects contributes the organization detail zone', () => {
  it('declares the contribution on projects:read, behind a dynamic import', () => {
    const zone = (projects.contributions.zones ?? []).find((entry) => entry.zone === 'organization.detail.after');
    expect(zone).toBeDefined();
    expect(zone?.requiredPermission).toBe('projects:read');
    expect(zone?.weight).toBe(650);
    expect(typeof zone?.component).toBe('function');
  });

  it('lists the organization’s Projects with state and current Stage, each linking to its screen', async () => {
    renderZone();
    const heading = await screen.findByRole('heading', { name: en('organizationPanel.title') });
    const panel = heading.closest('section') as HTMLElement;
    const first = await within(panel).findByRole('link', { name: 'PRJ-000001' });
    expect(first).toHaveAttribute('href', `/projects/${PROJECT_ID}`);
    expect(within(panel).getByText('Warehouse fit-out')).toBeTruthy();
    expect(within(panel).getByText(en('state.open'))).toBeTruthy();
    expect(within(panel).getByText('Design')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'PRJ-000002' })).toHaveAttribute('href', `/projects/${SECOND_ID}`);
    expect(within(panel).getByText(en('state.completed'))).toBeTruthy();
    expect(within(panel).getByText(en('organizationPanel.noStage'))).toBeTruthy();
    expect(getSpy.mock.calls.map(([path]) => path)).toEqual([LIST_URL]);
  });

  it('offers "New project" carrying the organization, to somebody who may create one', async () => {
    renderZone();
    const link = await screen.findByRole('link', { name: en('organizationPanel.new') });
    expect(link).toHaveAttribute('href', `/projects/new?organizationId=${ORGANIZATION_ID}`);
  });

  it('shows the list and no "New project" to somebody who may only read', async () => {
    renderZone({ permissions: ['projects:read'] });
    await screen.findByRole('link', { name: 'PRJ-000001' });
    expect(screen.queryByRole('link', { name: en('organizationPanel.new') })).toBeNull();
  });

  it('says how many more there are, and links to the list narrowed to this organization (issue #454)', async () => {
    getSpy.mockResolvedValue({ items: [summary()], nextCursor: 'next', total: 14 });
    renderZone();
    expect(await screen.findByText(en('organizationPanel.more', { shown: 1, total: 14 }), { exact: false })).toBeTruthy();
    expect(screen.getByRole('link', { name: en('organizationPanel.all') })).toHaveAttribute(
      'href',
      `/projects?organizationId=${ORGANIZATION_ID}`,
    );
  });

  it('says so when the organization has no Project the reader may see', async () => {
    getSpy.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    renderZone();
    expect(await screen.findByText(en('organizationPanel.empty'))).toBeTruthy();
  });

  it('says so when the list cannot be read', async () => {
    getSpy.mockRejectedValue(new Error('offline'));
    renderZone();
    expect(await screen.findByRole('alert')).toHaveTextContent(en('organizationPanel.error'));
  });

  it('renders nothing and asks nothing without projects:read', async () => {
    const container = renderZone({ permissions: ['customers:read', 'orders:read'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.querySelector('section')).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders nothing and asks nothing while projects is not in the enabled set', async () => {
    const container = renderZone({ present: ['organizations'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(container.querySelector('section')).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });
});
