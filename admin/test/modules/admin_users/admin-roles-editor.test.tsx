import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle } from '../../helpers/core-bundle';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import AdminRolesPage from '../../../../packages/modules/admin_users/src/admin/pages/AdminRolesPage';

/**
 * Issue #1521 (UX audit 2026-11-17, SHELL-13; DS-03 #1437) — the role editor is
 * one card of sections: the permission groups are sections named by the
 * module's name, each with a "3 / 7" count and a tri-state group checkbox; a
 * permission reads by its label with the code as a muted second line; a filter
 * narrows the list; full access is a switch whose warning shows only when it is
 * on; and the role list marks the open role without a second filled block.
 *
 * What a role grants is unchanged: full access still saves `['*']`, and a code
 * the catalogue does not offer still survives the round trip.
 */
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const SHIPPED = shippedCoreBundle('en');
const core = SHIPPED.core!;
const EN = { ...SHIPPED, widgets: { 'module.name': 'Sales orders' } };

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
}

const ROLE = {
  id: '00000000-0000-4000-8000-0000000000aa',
  code: 'accounting',
  name: 'Accounting',
  // `blog.read` has no catalogue row (its module is off) and must survive a save.
  permissions: ['widgets:read', 'blog.read'],
  requiresTwoFactor: false,
  updatedAt: '2026-11-07T00:00:00.000Z',
};

const OTHER = { ...ROLE, id: '00000000-0000-4000-8000-0000000000bb', code: 'warehouse', name: 'Warehouse', permissions: [] };

const PERMISSIONS = [
  { code: 'widgets:read', module: 'widgets', label: 'Read widgets', owners: ['widgets'] },
  { code: 'widgets:write', module: 'widgets', label: 'Write widgets', owners: ['widgets'], requires: ['widgets:read'] },
  { code: 'gadgets:read', module: 'gadget_store', label: 'View gadgets', owners: ['gadget_store'] },
];

function mockApi(): void {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/admin-roles') return { data: [ROLE, OTHER] } as never;
    if (url === '/api/v1/admin/permissions') return { data: PERMISSIONS } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(apiClient.put).mockImplementation(
    async () => ({ data: { ...ROLE, signedOutAdministrators: 0 } }) as never,
  );
}

async function openRole(code = 'accounting'): Promise<void> {
  mockApi();
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <AdminRolesPage />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['admin_users'] }) },
    ),
    EN,
  );
  fireEvent.click(await screen.findByText(code));
  await screen.findByRole('button', { name: core['adminRoles.save']! });
}

function group(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('AdminRolesPage — the permission groups', () => {
  afterEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
  });

  it('names each group by its module, not its id, with a selected count', async () => {
    await openRole();
    const orders = group('Sales orders');
    expect(orders.querySelector('h4')).toHaveTextContent('Sales orders');
    expect(orders).toHaveTextContent(fill(core['adminRoles.group.count']!, { selected: 1, total: 2 }));
    // A module whose bundle has no name reads as words, never as a bare id in a legend.
    expect(group('Gadget store')).toBeTruthy();
    expect(document.querySelector('fieldset')).toBeNull();
  });

  it('shows the label as the name and the code as a second line', async () => {
    await openRole();
    const box = screen.getByRole('checkbox', { name: 'Write widgets' });
    const description = document.getElementById(box.getAttribute('aria-describedby')!.split(' ')[0]!);
    expect(description).toHaveTextContent('widgets:write');
    expect(description?.querySelector('code')).toHaveClass('font-mono');
  });

  it('ticks and clears a whole group with a tri-state checkbox', async () => {
    await openRole();
    const all = within(group('Sales orders')).getByRole('checkbox', {
      name: fill(core['adminRoles.group.selectAll']!, { module: 'Sales orders' }),
    }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    fireEvent.click(all);
    expect(screen.getByRole('checkbox', { name: 'Write widgets' })).toBeChecked();
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    fireEvent.click(all);
    expect(screen.getByRole('checkbox', { name: 'Read widgets' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Write widgets' })).not.toBeChecked();
  });

  it('collapses a group with nothing selected and opens it on demand', async () => {
    await openRole();
    const toggle = within(group('Gadget store')).getByRole('button', { name: 'Gadget store' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox', { name: 'View gadgets' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('checkbox', { name: 'View gadgets' })).toBeTruthy();
    expect(within(group('Sales orders')).getByRole('button', { name: 'Sales orders' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('filters by label, code or module, and offers to clear a filter that matches nothing', async () => {
    await openRole();
    const filter = screen.getByRole('searchbox', { name: core['adminRoles.filter.label']! });
    fireEvent.change(filter, { target: { value: 'gadget' } });
    expect(screen.getByRole('checkbox', { name: 'View gadgets' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Read widgets' })).toBeNull();
    fireEvent.change(filter, { target: { value: 'nothing like it' } });
    const clear = screen.getByRole('button', { name: core['common.emptyState.clearFilters']! });
    fireEvent.click(clear);
    expect(screen.getByRole('checkbox', { name: 'Read widgets' })).toBeTruthy();
  });

  it('suggests a needed permission by its label', async () => {
    await openRole('warehouse');
    fireEvent.click(within(group('Sales orders')).getByRole('button', { name: 'Sales orders' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write widgets' }));
    fireEvent.click(screen.getByRole('button', { name: fill(core['adminRoles.dependencies.add']!, { label: 'Read widgets' }) }));
    expect(screen.getByRole('checkbox', { name: 'Read widgets' })).toBeChecked();
  });

  it('keeps a code the catalogue does not offer when saving', async () => {
    await openRole();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write widgets' }));
    fireEvent.click(screen.getByRole('button', { name: core['adminRoles.save']! }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
    const body = vi.mocked(apiClient.put).mock.calls[0]![1] as { permissions: string[] };
    expect([...body.permissions].sort()).toEqual(['blog.read', 'widgets:read', 'widgets:write']);
  });
});

describe('AdminRolesPage — full access', () => {
  afterEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
  });

  it('is a switch, warns only when on, and still saves the wildcard', async () => {
    await openRole();
    const full = screen.getByRole('switch', { name: core['adminRoles.wildcardToggle']! });
    expect(full).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(core['adminRoles.wildcard.onWarning']!)).toBeNull();
    expect(document.querySelector('[data-slot="alert"][data-variant="warning"]')).toBeNull();

    fireEvent.click(full);
    expect(full).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(core['adminRoles.wildcard.onWarning']!)).toBeTruthy();
    // Every permission is granted, so the list of them is not offered.
    expect(screen.queryByRole('checkbox', { name: 'Read widgets' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: core['adminRoles.save']! }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
    expect(vi.mocked(apiClient.put).mock.calls[0]![1]).toMatchObject({ permissions: ['*'] });
  });
});

describe('AdminRolesPage — the role list and the editor header', () => {
  afterEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
  });

  it('marks the open role with a muted state, not a filled primary block', async () => {
    await openRole();
    const current = screen.getAllByText('accounting')[0]!.closest('button')!;
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current.className).not.toMatch(/\bbg-primary\b/);
    expect(screen.getByText('warehouse').closest('button')).not.toHaveAttribute('aria-current');
  });

  it('titles the editor with the role and puts Delete in its header', async () => {
    await openRole();
    const heading = screen.getByRole('heading', { level: 2, name: 'Accounting' });
    const header = heading.closest('[data-slot="card-header"]')!;
    expect(within(header as HTMLElement).getByRole('button', { name: core['adminRoles.delete']! })).toBeTruthy();
  });

  it('asks before discarding unsaved changes when another role is opened', async () => {
    await openRole();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Write widgets' }));
    fireEvent.click(screen.getByText('warehouse'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(core['adminRoles.discardChanges.confirm']!);
    fireEvent.click(within(dialog).getByRole('button', { name: core['form.unsavedChanges.stay']! }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { level: 2, name: 'Accounting' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Write widgets' })).toBeChecked();
  });
});
