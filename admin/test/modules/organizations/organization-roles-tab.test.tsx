import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type {
  OrganizationPermissionCatalogueResponse,
  OrganizationRoleView,
} from '@endora-commerce/contracts';
import { adminSession, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/170-organization-roles/` T094 — the operator's *Roles* tab on an
 * Organization (US 7, FR-060, FR-061, FR-066; `contracts/operator-api.md` §5).
 *
 * The tab is mounted only for an operator holding `organizations:read-roles` or
 * `organizations:manage-roles` and only for a company Organization — hidden
 * means *nothing requested*, so the role endpoints are not even asked. The read
 * code shows the roles read-only; the manage code creates, edits and deletes
 * them, a held role's delete asking for the role to move its holders to. The
 * editor groups the permission catalogue by module, in the labels the server
 * translated, and the tab links to the Organization's history, where every role
 * change is audited (R-32).
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { OrganizationRolesTab } = await import(
  '../../../../packages/modules/organizations/src/admin/components/OrganizationRolesTab'
);

const ownEn = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/organizations/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const coreEn = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { organizations: ownEn, core: coreEn };
const tr = (key: string): string => {
  const value = ownEn[key];
  if (value === undefined) throw new Error(`missing organizations key ${key}`);
  return value;
};

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ADMIN_ROLE = '00000000-0000-4000-8000-000000000001';
const MEMBER_ROLE = '00000000-0000-4000-8000-000000000002';
const BUYER_ROLE = '00000000-0000-4000-8000-000000000003';
const UNUSED_ROLE = '00000000-0000-4000-8000-000000000004';
const UPDATED = '2026-11-01T10:00:00.000Z';

const ROLES: OrganizationRoleView[] = [
  {
    id: ADMIN_ROLE,
    kind: 'administrator',
    name: 'Administrator',
    description: null,
    permissions: ['carts.approve', 'carts.create', 'shopping_lists.create'],
    memberCount: 1,
    pendingInvitationCount: 0,
    version: 1,
    updatedAt: UPDATED,
  },
  {
    id: MEMBER_ROLE,
    kind: 'member',
    name: 'Member',
    description: null,
    permissions: ['carts.create', 'shopping_lists.create'],
    memberCount: 2,
    pendingInvitationCount: 1,
    version: 2,
    updatedAt: UPDATED,
  },
  {
    id: BUYER_ROLE,
    kind: 'custom',
    name: 'Junior buyer',
    description: 'Orders below the limit',
    permissions: ['carts.create'],
    memberCount: 1,
    pendingInvitationCount: 2,
    version: 3,
    updatedAt: UPDATED,
  },
  {
    id: UNUSED_ROLE,
    kind: 'custom',
    name: 'Unused',
    description: null,
    permissions: [],
    memberCount: 0,
    pendingInvitationCount: 0,
    version: 1,
    updatedAt: UPDATED,
  },
];

const CATALOGUE: OrganizationPermissionCatalogueResponse = {
  data: {
    groups: [
      {
        moduleId: 'carts',
        moduleLabel: 'Carts',
        permissions: [
          { code: 'carts.create', label: 'Add to the basket', description: 'Fill and edit the basket', memberDefault: true },
          { code: 'carts.approve', label: 'Approve baskets', description: 'Approve a colleague\'s basket', memberDefault: false },
        ],
      },
      {
        moduleId: 'shopping_lists',
        moduleLabel: 'Shopping lists',
        permissions: [
          { code: 'shopping_lists.create', label: 'Create shopping lists', description: 'Create and edit lists', memberDefault: true },
        ],
      },
    ],
  },
};

const ROLES_PATH = `/api/v1/admin/organizations/${ORG}/roles`;
const CATALOGUE_PATH = `/api/v1/admin/organizations/${ORG}/permission-catalogue`;

function answer(path: string): Promise<unknown> {
  if (path === ROLES_PATH) return Promise.resolve({ data: ROLES });
  if (path === CATALOGUE_PATH) return Promise.resolve(CATALOGUE);
  return Promise.reject(new Error(`unexpected GET ${path}`));
}

function renderTab(permissions: readonly string[], options: { isPersonal?: boolean } = {}) {
  return renderWithSession(
    <MemoryRouter>
      <OrganizationRolesTab organizationId={ORG} isPersonal={options.isPersonal ?? false} />
    </MemoryRouter>,
    { session: adminSession({ permissions }), presence: modulePresence({ present: ['organizations', 'audit_logs'] }), bundle },
  );
}

function rowOf(name: string): HTMLElement {
  const cell = screen.getByText(name, { selector: 'td *, td' });
  const row = cell.closest('tr');
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  deleteSpy.mockReset();
  getSpy.mockImplementation(answer);
});

describe('OrganizationRolesTab — visibility', () => {
  it('renders nothing and requests nothing for an operator holding neither role code', async () => {
    const { container } = renderTab(['customers:read', 'customers:manage']);
    await Promise.resolve();
    expect(container.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('renders nothing and requests nothing for a personal Organization', async () => {
    const { container } = renderTab(['*'], { isPersonal: true });
    await Promise.resolve();
    expect(container.textContent).toBe('');
    expect(getSpy).not.toHaveBeenCalled();
  });
});

describe('OrganizationRolesTab — read-only with organizations:read-roles', () => {
  it('lists every role with its counts and offers no write', async () => {
    renderTab(['customers:read', 'organizations:read-roles']);

    expect(await screen.findByRole('heading', { name: tr('roles.tab.title') })).toBeTruthy();
    expect(await screen.findByText('Junior buyer')).toBeTruthy();
    const admin = rowOf('Administrator');
    expect(within(admin).getByText(tr('roles.list.allPermissions'))).toBeTruthy();
    expect(within(admin).queryByRole('button')).toBeNull();
    const buyer = rowOf('Junior buyer');
    expect(within(buyer).getByText(tr('roles.kind.custom'))).toBeTruthy();
    expect(within(buyer).getByText('Orders below the limit')).toBeTruthy();
    expect(within(rowOf('Member')).getByText(tr('roles.kind.predefined'))).toBeTruthy();

    expect(screen.queryByRole('button', { name: tr('roles.action.create') })).toBeNull();
    expect(screen.queryByRole('button', { name: tr('roles.action.edit') })).toBeNull();
    expect(screen.queryByRole('button', { name: tr('roles.action.delete') })).toBeNull();
    // No History link either: the audit log is not this operator's to open.
    expect(screen.queryByRole('link', { name: tr('roles.tab.history') })).toBeNull();
  });

  it('opens a role read-only: its permissions grouped by module, nothing to save', async () => {
    renderTab(['organizations:read-roles']);

    fireEvent.click(await screen.findByRole('button', { name: 'Junior buyer' }));
    const dialog = await screen.findByRole('dialog', { name: 'Junior buyer' });
    const carts = within(dialog).getByRole('group', { name: 'Carts' });
    const create = within(carts).getByRole('checkbox', { name: /Add to the basket/ });
    expect(create).toBeChecked();
    expect(create).toBeDisabled();
    expect(within(carts).getByRole('checkbox', { name: /Approve baskets/ })).not.toBeChecked();
    expect(within(dialog).getByRole('group', { name: 'Shopping lists' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: tr('roles.action.save') })).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: coreEn['common.action.close'] as string }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('links to the Organization\'s history', async () => {
    renderTab(['organizations:read-roles', 'audit_log:read']);

    const link = await screen.findByRole('link', { name: tr('roles.tab.history') });
    expect(link.getAttribute('href')).toBe(`/audit-log?objectType=organization&objectId=${ORG}`);
  });

  it('is clean under axe, list and open role alike', async () => {
    const { container } = renderTab(['organizations:read-roles', 'audit_log:read']);
    await screen.findByText('Junior buyer');
    await expectNoAxeViolations(container);

    fireEvent.click(screen.getByRole('button', { name: 'Junior buyer' }));
    await expectNoAxeViolations(await screen.findByRole('dialog'));
  });
});

describe('OrganizationRolesTab — managing with organizations:manage-roles', () => {
  it('creates a custom role with the ticked permissions', async () => {
    postSpy.mockResolvedValue({ data: { ...ROLES[3], id: '00000000-0000-4000-8000-000000000005', name: 'Approver' } });
    renderTab(['organizations:manage-roles']);

    fireEvent.click(await screen.findByRole('button', { name: tr('roles.action.create') }));
    const dialog = await screen.findByRole('dialog', { name: tr('roles.editor.createTitle') });
    fireEvent.change(within(dialog).getByLabelText(tr('roles.editor.field.name')), { target: { value: '  Approver ' } });
    fireEvent.change(within(dialog).getByLabelText(tr('roles.editor.field.description')), {
      target: { value: 'Approves baskets' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Approve baskets/ }));
    expect(within(dialog).getAllByText(tr('roles.editor.memberDefault')).length).toBe(2);
    fireEvent.click(within(dialog).getByRole('button', { name: tr('roles.action.save') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(ROLES_PATH, {
      name: 'Approver',
      description: 'Approves baskets',
      permissions: ['carts.approve'],
    });
    expect(await screen.findByText(tr('roles.info.created'))).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  /**
   * T140 (owner ruling OR-9, FR-004a, R-39) — characterization: a new custom
   * role starts with no permissions. The editor ticks nothing, the
   * *member-default* hint is a hint and not a selection, there is no control to
   * copy another role's permissions, and saving untouched sends `permissions: []`.
   */
  it('opens the create editor empty: nothing ticked, the member-default hint only, no copy-from-role, and saves []', async () => {
    postSpy.mockResolvedValue({ data: { ...ROLES[3], id: '00000000-0000-4000-8000-000000000006', name: 'Viewer' } });
    renderTab(['organizations:manage-roles']);

    fireEvent.click(await screen.findByRole('button', { name: tr('roles.action.create') }));
    const dialog = await screen.findByRole('dialog', { name: tr('roles.editor.createTitle') });

    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box).not.toBeChecked();
    // The two member defaults (carts.create, shopping_lists.create) carry the
    // hint, and the hint ticks neither.
    expect(within(dialog).getAllByText(tr('roles.editor.memberDefault')).length).toBe(2);
    expect(within(dialog).getByRole('checkbox', { name: /Add to the basket/ })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Create shopping lists/ })).not.toBeChecked();

    // No copy-from-role control: no role picker, and no existing role offered.
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).queryByRole('listbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /copy/i })).toBeNull();
    for (const role of ROLES) expect(within(dialog).queryByText(role.name)).toBeNull();

    fireEvent.change(within(dialog).getByLabelText(tr('roles.editor.field.name')), { target: { value: 'Viewer' } });
    fireEvent.click(within(dialog).getByRole('button', { name: tr('roles.action.save') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(ROLES_PATH, { name: 'Viewer', permissions: [] });
  });

  it('edits a custom role against the version it read', async () => {
    patchSpy.mockResolvedValue({ data: ROLES[2] });
    renderTab(['organizations:manage-roles']);

    await screen.findByText('Junior buyer');
    fireEvent.click(within(rowOf('Junior buyer')).getByRole('button', { name: tr('roles.action.edit') }));
    const dialog = await screen.findByRole('dialog', { name: tr('roles.editor.editTitle') });
    expect(within(dialog).getByLabelText(tr('roles.editor.field.name'))).toHaveValue('Junior buyer');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Create shopping lists/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: tr('roles.action.save') }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${ROLES_PATH}/${BUYER_ROLE}`, {
      expectedVersion: 3,
      name: 'Junior buyer',
      description: 'Orders below the limit',
      permissions: ['carts.create', 'shopping_lists.create'],
    });
    expect(await screen.findByText(tr('roles.info.saved'))).toBeTruthy();
  });

  it('edits the Member role\'s permissions only — no name, no description, no delete', async () => {
    patchSpy.mockResolvedValue({ data: ROLES[1] });
    renderTab(['organizations:manage-roles']);

    await screen.findByText('Junior buyer');
    const member = rowOf('Member');
    expect(within(member).queryByRole('button', { name: tr('roles.action.delete') })).toBeNull();
    expect(within(rowOf('Administrator')).queryByRole('button')).toBeNull();
    fireEvent.click(within(member).getByRole('button', { name: tr('roles.action.edit') }));
    const dialog = await screen.findByRole('dialog', { name: tr('roles.editor.editTitle') });
    expect(within(dialog).getByText(tr('roles.editor.memberNotice'))).toBeTruthy();
    expect(within(dialog).queryByLabelText(tr('roles.editor.field.name'))).toBeNull();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Create shopping lists/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: tr('roles.action.save') }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${ROLES_PATH}/${MEMBER_ROLE}`, {
      expectedVersion: 2,
      permissions: ['carts.create'],
    });
  });

  it('shows the server\'s refusal inside the editor and keeps it open', async () => {
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    patchSpy.mockRejectedValue(
      new ApiError(409, { error: { code: 'ORGANIZATION_ROLE_NAME_TAKEN', message: 'Another role has this name.' } }),
    );
    renderTab(['organizations:manage-roles']);

    await screen.findByText('Junior buyer');
    fireEvent.click(within(rowOf('Junior buyer')).getByRole('button', { name: tr('roles.action.edit') }));
    const dialog = await screen.findByRole('dialog', { name: tr('roles.editor.editTitle') });
    fireEvent.click(within(dialog).getByRole('button', { name: tr('roles.action.save') }));

    expect(await within(dialog).findByText('Another role has this name.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('deletes a held role only with a replacement, Member preselected', async () => {
    deleteSpy.mockResolvedValue({ data: { reassignedMembers: 1, reassignedInvitations: 2 } });
    renderTab(['organizations:manage-roles']);

    await screen.findByText('Junior buyer');
    fireEvent.click(within(rowOf('Junior buyer')).getByRole('button', { name: tr('roles.action.delete') }));
    const dialog = await screen.findByRole('dialog', { name: tr('roles.delete.title') });
    expect(
      within(dialog).getByText(tr('roles.delete.held').replace('{members}', '1').replace('{invitations}', '2')),
    ).toBeTruthy();
    const replacement = within(dialog).getByLabelText(tr('roles.delete.replacement'));
    expect(replacement).toHaveValue(MEMBER_ROLE);
    const offered = within(replacement as HTMLElement)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(offered).not.toContain('Junior buyer');
    fireEvent.change(replacement, { target: { value: UNUSED_ROLE } });
    fireEvent.click(within(dialog).getByRole('button', { name: tr('roles.delete.confirm') }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    const [path, init] = deleteSpy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`${ROLES_PATH}/${BUYER_ROLE}`);
    expect(JSON.parse(init.body as string)).toEqual({ expectedVersion: 3, replacementRoleId: UNUSED_ROLE });
    expect(await screen.findByText(tr('roles.info.deleted'))).toBeTruthy();
  });

  it('deletes a role nobody holds without asking for a replacement', async () => {
    deleteSpy.mockResolvedValue({ data: { reassignedMembers: 0, reassignedInvitations: 0 } });
    renderTab(['organizations:manage-roles']);

    await screen.findByText('Unused');
    fireEvent.click(within(rowOf('Unused')).getByRole('button', { name: tr('roles.action.delete') }));
    const dialog = await screen.findByRole('dialog', { name: tr('roles.delete.title') });
    expect(within(dialog).queryByLabelText(tr('roles.delete.replacement'))).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: tr('roles.delete.confirm') }));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    const [, init] = deleteSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ expectedVersion: 1 });
  });

  it('is clean under axe with the editor and the delete dialog open', async () => {
    renderTab(['organizations:manage-roles']);

    fireEvent.click(await screen.findByRole('button', { name: tr('roles.action.create') }));
    await expectNoAxeViolations(await screen.findByRole('dialog'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: tr('roles.action.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(within(rowOf('Junior buyer')).getByRole('button', { name: tr('roles.action.delete') }));
    await expectNoAxeViolations(await screen.findByRole('dialog'));
  });
});
