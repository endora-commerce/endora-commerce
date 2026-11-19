import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OrganizationRoleView } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/170-organization-roles/` T094 — the members of an Organization and
 * their roles on the operator's Organization screen (US 7, FR-062;
 * `contracts/operator-api.md` §3 and §5).
 *
 * Assigning a role stays under `customers:manage` (FR-062), so the role select
 * cannot depend on the role-reading code: with `organizations:read-roles` its
 * options are the Organization's roles from `GET …/roles`, every custom role
 * included; without it they are the roles the members hold plus the predefined
 * *Member*, and the role endpoint is not asked. The member endpoints take a
 * `roleId` (WP-03): the role change, the invitation and the direct create. The
 * forms preselect *Member*; when its id is not known (no role list) the default
 * sends no `roleId`, which the server reads as *Member*. Last-administrator protection keys off
 * `organizationRole.kind`, never off a role name. The *Roles* tab is not offered
 * for a personal Organization.
 *
 * Since issue #1516 (SALES-14) the role is changed in the member's *Edit* dialog, written
 * on its Save, rather than by a row select that wrote on change; the invitation and the
 * direct create are the two ways of the *Add member* dialog.
 *
 * **Waits for WP-03** at the boundary: these tests drive the screen against the
 * member shapes WP-03 ships (`organizationRole` on embedded members, `roleId` in
 * the three bodies); the backend routes accepting them are WP-03's.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();

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
      delete: vi.fn(),
    },
  };
});

// Sibling panels with data chains of their own; none is under test here.
vi.mock('../../../../packages/modules/organizations/src/admin/panels/FulfilmentStrategyPanel', () => ({
  FulfilmentStrategyPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/ModerationActionsPanel', () => ({
  ModerationActionsPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/ApplicablePriceListsPanel', () => ({
  ApplicablePriceListsPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/HierarchyPanel', () => ({ HierarchyPanel: () => null }));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/VatValidationPanel', () => ({
  VatValidationPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/RestrictionsPanel', () => ({
  RestrictionsPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/panels/SalesChannelsPanel', () => ({
  SalesChannelsPanel: () => null,
}));
vi.mock('../../../../packages/modules/organizations/src/admin/components/OrganizationSalesRepsTab', () => ({
  OrganizationSalesRepsTab: () => null,
}));

const { OrganizationDetail } = await import(
  '../../../../packages/modules/organizations/src/admin/pages/OrganizationDetail'
);

const CORE_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const OWN_EN = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/organizations/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const bundle = { core: CORE_EN, organizations: OWN_EN };
const core = (key: string): string => {
  const value = CORE_EN[key];
  if (value === undefined) throw new Error(`missing core key ${key}`);
  return value;
};

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const UPDATED_AT = '2026-05-01T09:00:00.000Z';
const ADMIN_ROLE = '00000000-0000-4000-8000-000000000001';
const MEMBER_ROLE = '00000000-0000-4000-8000-000000000002';
const BUYER_ROLE = '00000000-0000-4000-8000-000000000003';
const APPROVER_ROLE = '00000000-0000-4000-8000-000000000004';
const ADA = '00000000-0000-4000-8000-0000000000c1';
const BEA = '00000000-0000-4000-8000-0000000000c2';
const CAL = '00000000-0000-4000-8000-0000000000c3';

function member(id: string, email: string, role: { id: string; name: string; kind: string }) {
  return {
    id,
    email,
    firstName: email.split('@')[0],
    lastName: 'Doe',
    organizationRole: role,
    emailVerifiedAt: null,
    twoFactorEnabled: false,
    lastLoginAt: null,
    updatedAt: UPDATED_AT,
  };
}

const ADMINISTRATOR = { id: ADMIN_ROLE, name: 'Administrator', kind: 'administrator' };
const BUYER = { id: BUYER_ROLE, name: 'Junior buyer', kind: 'custom' };

function org(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    name: 'Acme',
    legalName: null,
    taxId: '1234567890',
    status: 'active',
    vatStatus: 'vat_payer',
    isPersonal: false,
    registeredAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
    orderConfirmationEmails: [],
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    customFieldValues: {},
    parentId: null,
    members: [
      member(ADA, 'ada@acme.test', ADMINISTRATOR),
      member(BEA, 'bea@acme.test', BUYER),
      member(CAL, 'cal@acme.test', BUYER),
    ],
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function roleView(id: string, kind: OrganizationRoleView['kind'], name: string): OrganizationRoleView {
  return {
    id,
    kind,
    name,
    description: null,
    permissions: [],
    memberCount: 0,
    pendingInvitationCount: 0,
    version: 1,
    updatedAt: UPDATED_AT,
  };
}

const ROLES: OrganizationRoleView[] = [
  roleView(ADMIN_ROLE, 'administrator', 'Administrator'),
  roleView(MEMBER_ROLE, 'member', 'Member'),
  roleView(APPROVER_ROLE, 'custom', 'Approver'),
  roleView(BUYER_ROLE, 'custom', 'Junior buyer'),
];

const ROLES_PATH = `/api/v1/admin/organizations/${ORG_ID}/roles`;

function renderDetail(permissions: readonly string[], detail = org()): ReturnType<typeof renderWithI18n> {
  getSpy.mockImplementation((path: string) => {
    if (path === `/api/v1/admin/organizations/${ORG_ID}`) return Promise.resolve({ data: detail });
    if (path === ROLES_PATH) return Promise.resolve({ data: ROLES });
    if (path.endsWith('/permission-catalogue')) return Promise.resolve({ data: { groups: [] } });
    if (path.startsWith('/api/v1/admin/warehouses')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: [] });
  });
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <Routes>
          <Route path="/organizations/:id" element={<OrganizationDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions }),
        presence: modulePresence({ present: ['organizations', 'audit_logs'] }),
        contributions: [],
      },
    ),
    bundle,
  );
}

const own = (key: string, vars: Record<string, string> = {}): string => {
  const value = OWN_EN[key];
  if (value === undefined) throw new Error(`missing organizations key ${key}`);
  return Object.entries(vars).reduce((text, [name, v]) => text.replace(`{${name}}`, v), value);
};

/** Issue #1516 (SALES-14) — a member's role is changed in its edit dialog, not in the row. */
async function openEdit(email: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: own('members.row.edit', { email }) }));
  return screen.findByRole('dialog', { name: core('organizations.detail.editMember') });
}

/** Issue #1516 — invitation and direct create are the two ways of one *Add member* dialog. */
async function openAdd(way: 'invite' | 'create' = 'invite'): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: own('members.add') }));
  const dialog = await screen.findByRole('dialog', { name: own('members.add') });
  if (way === 'create') fireEvent.click(within(dialog).getByRole('radio', { name: own('members.add.create') }));
  return dialog;
}

/** A field by its label, the required asterisk (hidden from assistive technology) aside. */
function labelPattern(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*)?$`);
}

function byLabel(container: HTMLElement, text: string): HTMLInputElement {
  return within(container).getByLabelText(labelPattern(text)) as HTMLInputElement;
}

function roleSelectIn(dialog: HTMLElement): HTMLSelectElement {
  return within(dialog).getByLabelText(labelPattern(core('organizations.detail.role'))) as HTMLSelectElement;
}

function optionsOf(select: HTMLElement): string[] {
  return within(select).getAllByRole('option').map((o) => o.textContent ?? '');
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  postSpy.mockResolvedValue({ data: {} });
  patchSpy.mockResolvedValue({ data: {} });
});

describe('OrganizationDetail — members and their roles', () => {
  it('shows each member\'s role and offers the Organization\'s roles when the operator reads them', async () => {
    renderDetail(['customers:read', 'customers:manage', 'organizations:read-roles']);

    await screen.findByText('ada@acme.test');
    const row = screen.getByText('bea@acme.test').closest('li') as HTMLElement;
    expect(within(row).getByText('Junior buyer')).toBeInTheDocument();
    await waitFor(() => expect(getSpy.mock.calls.map((c) => c[0])).toContain(ROLES_PATH));

    const dialog = await openEdit('bea@acme.test');
    await waitFor(() => expect(optionsOf(roleSelectIn(dialog))).toContain('Approver'));
    expect(optionsOf(roleSelectIn(dialog))).toEqual(['Administrator', 'Member', 'Approver', 'Junior buyer']);
    expect(roleSelectIn(dialog)).toHaveValue(BUYER_ROLE);
  });

  it('changes a member\'s role by id under customers:manage alone, without reading the roles', async () => {
    renderDetail(['customers:read', 'customers:manage']);

    await screen.findByText('bea@acme.test');
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain(ROLES_PATH);
    // No select in the row: picking a role there committed it at once (DS-18, SALES-14).
    expect(screen.queryByRole('combobox')).toBeNull();

    const dialog = await openEdit('bea@acme.test');
    // The members' own roles; Member is offered on the add form as the default, not here,
    // because its id is not known without the role list.
    expect(optionsOf(roleSelectIn(dialog))).toEqual(['Administrator', 'Junior buyer']);

    fireEvent.change(roleSelectIn(dialog), { target: { value: ADMIN_ROLE } });
    expect(patchSpy).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.save') }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${ORG_ID}/members/${BEA}/role`, {
      roleId: ADMIN_ROLE,
      expectedUpdatedAt: UPDATED_AT,
    });
  });

  it('invites with the chosen role, and with no roleId on the Member default', async () => {
    renderDetail(['customers:read', 'customers:manage', 'organizations:read-roles']);

    await screen.findByText('ada@acme.test');
    await waitFor(() => expect(getSpy.mock.calls.map((c) => c[0])).toContain(ROLES_PATH));
    let dialog = await openAdd();
    await waitFor(() => expect(optionsOf(roleSelectIn(dialog))).toContain('Approver'));
    expect(roleSelectIn(dialog)).toHaveValue(MEMBER_ROLE);

    fireEvent.change(byLabel(dialog, core('organizations.detail.email')), {
      target: { value: 'dan@acme.test' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.sendInvite') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]).toEqual([
      `/api/v1/admin/organizations/${ORG_ID}/members/invite`,
      { email: 'dan@acme.test', roleId: MEMBER_ROLE },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await openAdd();
    fireEvent.change(roleSelectIn(dialog), { target: { value: APPROVER_ROLE } });
    fireEvent.change(byLabel(dialog, core('organizations.detail.email')), {
      target: { value: 'eve@acme.test' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.sendInvite') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(2));
    expect(postSpy.mock.calls[1]?.[1]).toEqual({ email: 'eve@acme.test', roleId: APPROVER_ROLE });
  });

  it('without the role list, the add form defaults to Member and sends no roleId', async () => {
    renderDetail(['customers:read', 'customers:manage']);

    await screen.findByText('ada@acme.test');
    const dialog = await openAdd();
    expect(optionsOf(roleSelectIn(dialog))).toEqual([OWN_EN['organizationRoles.member.name'], 'Administrator', 'Junior buyer']);
    fireEvent.change(byLabel(dialog, core('organizations.detail.email')), {
      target: { value: 'dan@acme.test' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.sendInvite') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]?.[1]).toEqual({ email: 'dan@acme.test' });
  });

  it('creates a member directly with the chosen role', async () => {
    renderDetail(['customers:read', 'customers:manage', 'organizations:read-roles']);

    await screen.findByText('ada@acme.test');
    await waitFor(() => expect(getSpy.mock.calls.map((c) => c[0])).toContain(ROLES_PATH));
    const dialog = await openAdd('create');
    await waitFor(() => expect(optionsOf(roleSelectIn(dialog))).toContain('Approver'));
    fireEvent.change(byLabel(dialog, core('organizations.detail.email')), {
      target: { value: 'fay@acme.test' },
    });
    fireEvent.change(byLabel(dialog, core('organizations.detail.tempPassword')), {
      target: { value: 'a-long-password-1' },
    });
    fireEvent.change(byLabel(dialog, core('organizations.detail.firstName')), {
      target: { value: 'Fay' },
    });
    fireEvent.change(byLabel(dialog, core('organizations.detail.lastName')), {
      target: { value: 'Doe' },
    });
    fireEvent.change(roleSelectIn(dialog), { target: { value: BUYER_ROLE } });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.createMember') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy.mock.calls[0]).toEqual([
      `/api/v1/admin/organizations/${ORG_ID}/members`,
      { email: 'fay@acme.test', firstName: 'Fay', lastName: 'Doe', password: 'a-long-password-1', roleId: BUYER_ROLE },
    ]);
  });

  it('protects the last administrator by role kind, whatever the role is called', async () => {
    renderDetail(['customers:read', 'customers:manage'], org({
      members: [
        member(ADA, 'ada@acme.test', { id: ADMIN_ROLE, name: 'Administratorka', kind: 'administrator' }),
        // A custom role named like the predefined one is still not an administrator.
        member(BEA, 'bea@acme.test', { id: BUYER_ROLE, name: 'Administrator', kind: 'custom' }),
      ],
    }));

    await screen.findByText('ada@acme.test');
    const removeOf = (email: string): HTMLElement =>
      screen.getByRole('button', { name: own('members.row.remove', { email }) });
    expect(removeOf('ada@acme.test')).toBeDisabled();
    // The reason is said, not only implied by a disabled button.
    expect(removeOf('ada@acme.test')).toHaveAccessibleDescription(own('members.lastAdministrator'));
    expect(removeOf('bea@acme.test')).not.toBeDisabled();

    // Nor can the last administrator be demoted from the edit dialog.
    const dialog = await openEdit('ada@acme.test');
    expect(roleSelectIn(dialog)).toBeDisabled();
  });

  it('offers the Roles tab for a company Organization to an operator reading roles', async () => {
    renderDetail(['customers:read', 'organizations:read-roles']);

    expect(await screen.findByRole('heading', { name: OWN_EN['roles.tab.title'] as string })).toBeTruthy();
  });

  it('offers no Roles tab, and asks for no roles, on a personal Organization', async () => {
    renderDetail(['*'], org({ isPersonal: true, members: [member(ADA, 'ada@acme.test', ADMINISTRATOR)] }));

    await screen.findByText('ada@acme.test');
    expect(screen.queryByRole('heading', { name: OWN_EN['roles.tab.title'] as string })).toBeNull();
    expect(getSpy.mock.calls.map((c) => c[0])).not.toContain(ROLES_PATH);
  });

  it('keeps the screen and the edit dialog clean under axe', async () => {
    const { container } = renderDetail(['customers:read', 'customers:manage', 'organizations:read-roles']);

    await screen.findByText('ada@acme.test');
    await waitFor(() => expect(getSpy.mock.calls.map((c) => c[0])).toContain(ROLES_PATH));
    await expectNoAxeViolations(container);
    const dialog = await openEdit('bea@acme.test');
    await waitFor(() => expect(optionsOf(roleSelectIn(dialog))).toContain('Approver'));
    await expectNoAxeViolations(document.body);
  });
});
