import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Issue #1516 (UX audit 2026-11-17, SALES-14) — the Organization screen's members are one
 * section: the list as plain rows, one *Add member* button that opens a dialog choosing
 * between an invitation and creating the account now (the password and the names are asked
 * for only on the second), editing a member — its role included — in a dialog, and Remove
 * asked before it applies. It replaces three cards (invite, direct add, members) and a
 * bordered edit box drawn inside the members card.
 *
 * The member endpoints are the ones feature 170 ships; only the screen changed.
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
const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
  '@endora-commerce/admin-kit/lib',
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
const own = (key: string, vars: Record<string, string> = {}): string => {
  const value = OWN_EN[key];
  if (value === undefined) throw new Error(`missing organizations key ${key}`);
  return Object.entries(vars).reduce((text, [name, v]) => text.replace(`{${name}}`, v), value);
};

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const ORG_URL = `/api/v1/admin/organizations/${ORG_ID}`;
const UPDATED_AT = '2026-05-01T09:00:00.000Z';
const NEWER = '2026-05-01T09:05:00.000Z';
const ADMIN_ROLE = '00000000-0000-4000-8000-000000000001';
const BUYER_ROLE = '00000000-0000-4000-8000-000000000003';
const ADA = '00000000-0000-4000-8000-0000000000c1';
const BEA = '00000000-0000-4000-8000-0000000000c2';

const ADMINISTRATOR = { id: ADMIN_ROLE, name: 'Administrator', kind: 'administrator' };
const BUYER = { id: BUYER_ROLE, name: 'Junior buyer', kind: 'custom' };

function member(id: string, email: string, role: { id: string; name: string; kind: string }, updatedAt = UPDATED_AT) {
  return {
    id,
    email,
    firstName: email.split('@')[0],
    lastName: 'Doe',
    subtreeRollupEnabled: false,
    organizationRole: role,
    emailVerifiedAt: null,
    twoFactorEnabled: false,
    lastLoginAt: null,
    createdAt: UPDATED_AT,
    updatedAt,
  };
}

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
    members: [member(ADA, 'ada@acme.test', ADMINISTRATOR), member(BEA, 'bea@acme.test', BUYER)],
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

let detail: ReturnType<typeof org>;

function renderDetail(permissions: readonly string[] = ['customers:read', 'customers:manage'], first = org()): ReturnType<typeof renderWithI18n> {
  detail = first;
  getSpy.mockImplementation((path: string) => {
    if (path === ORG_URL) return Promise.resolve({ data: detail });
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
        presence: modulePresence({ present: ['organizations'] }),
        contributions: [],
      },
    ),
    bundle,
  );
}

function membersSection(): HTMLElement {
  return screen.getByRole('region', { name: new RegExp(`^${core('organizations.detail.membersCard')}`) });
}

async function openAdd(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: own('members.add') }));
  return screen.findByRole('dialog', { name: own('members.add') });
}

async function openEdit(email: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: own('members.row.edit', { email }) }));
  return screen.findByRole('dialog', { name: core('organizations.detail.editMember') });
}

/** A field by its label, the required asterisk (hidden from assistive technology) aside. */
function labelPattern(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\*)?$`);
}

function byLabel(container: HTMLElement, text: string): HTMLInputElement {
  return within(container).getByLabelText(labelPattern(text)) as HTMLInputElement;
}

function field(dialog: HTMLElement, key: string): HTMLInputElement {
  return byLabel(dialog, core(key));
}

function apiError(status: number, code: string, message: string): Error {
  return new ApiError(status, { error: { code, message, requestId: 'r' } } as never);
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  deleteSpy.mockReset();
  postSpy.mockResolvedValue({ data: {} });
  patchSpy.mockResolvedValue({ data: {} });
  deleteSpy.mockResolvedValue(undefined);
});

describe('OrganizationDetail — one Members section (SALES-14)', () => {
  it('is one section of plain rows with one Add member button, and no invite or direct-add card', async () => {
    renderDetail();
    await screen.findByText('ada@acme.test');

    const section = membersSection();
    expect(within(section).getByRole('button', { name: own('members.add') })).toBeInTheDocument();
    expect(within(section).queryByRole('table')).toBeNull();
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).getByText('Junior buyer')).toBeInTheDocument();
    // No edit box above the list, and no forms of their own beside it.
    expect(screen.queryByLabelText(labelPattern(core('organizations.detail.tempPassword')))).toBeNull();
    expect(screen.queryByText(core('organizations.detail.editMember'))).toBeNull();
    expect(screen.queryByText('Invite member')).toBeNull();
    expect(screen.queryByText('Direct add member')).toBeNull();
  });

  it('asks for the password and the names only when the account is created now', async () => {
    renderDetail();
    const dialog = await openAdd();

    const invite = within(dialog).getByRole('radio', { name: own('members.add.invite') });
    const create = within(dialog).getByRole('radio', { name: own('members.add.create') });
    // The invitation is the recommended default: the member sets their own password.
    expect(invite).toBeChecked();
    expect(field(dialog, 'organizations.detail.email')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(labelPattern(core('organizations.detail.tempPassword')))).toBeNull();
    expect(within(dialog).queryByLabelText(labelPattern(core('organizations.detail.firstName')))).toBeNull();
    expect(within(dialog).getByRole('button', { name: core('organizations.detail.sendInvite') })).toBeInTheDocument();

    fireEvent.click(create);
    expect(field(dialog, 'organizations.detail.tempPassword')).toBeInTheDocument();
    expect(field(dialog, 'organizations.detail.firstName')).toBeInTheDocument();
    expect(field(dialog, 'organizations.detail.lastName')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: core('organizations.detail.createMember') })).toBeInTheDocument();

    fireEvent.click(invite);
    expect(within(dialog).queryByLabelText(labelPattern(core('organizations.detail.tempPassword')))).toBeNull();
  });

  it('checks the form on submit, says what is missing at each field, and sends nothing', async () => {
    renderDetail();
    const dialog = await openAdd();

    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.sendInvite') }));
    const email = field(dialog, 'organizations.detail.email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(own('members.error.emailRequired'));

    fireEvent.click(within(dialog).getByRole('radio', { name: own('members.add.create') }));
    fireEvent.change(email, { target: { value: ' fay@acme.test ' } });
    fireEvent.change(field(dialog, 'organizations.detail.tempPassword'), { target: { value: 'short' } });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.createMember') }));
    expect(field(dialog, 'organizations.detail.tempPassword')).toHaveAccessibleDescription(own('members.error.passwordShort'));
    expect(field(dialog, 'organizations.detail.firstName')).toHaveAttribute('aria-invalid', 'true');
    expect(field(dialog, 'organizations.detail.email')).not.toHaveAttribute('aria-invalid');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('keeps a refused add in the dialog, with what was typed, and closes on success with the page told', async () => {
    postSpy.mockRejectedValueOnce(apiError(409, 'EMAIL_ALREADY_IN_ORGANIZATION', 'This email already belongs to a member.'));
    renderDetail();
    const dialog = await openAdd();

    fireEvent.change(field(dialog, 'organizations.detail.email'), { target: { value: 'bea@acme.test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.sendInvite') }));
    expect(await within(dialog).findByText('This email already belongs to a member.')).toBeInTheDocument();
    expect(field(dialog, 'organizations.detail.email')).toHaveValue('bea@acme.test');

    fireEvent.change(field(dialog, 'organizations.detail.email'), { target: { value: 'dan@acme.test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.sendInvite') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText(core('organizations.detail.info.invited'))).toBeInTheDocument();
  });

  it('edits the profile and the role in one dialog, the role write gated by the profile write\'s version', async () => {
    patchSpy.mockImplementation((path: string) =>
      Promise.resolve({ data: path.endsWith('/role') ? {} : member(BEA, 'bee@acme.test', BUYER, NEWER) }),
    );
    renderDetail();
    const dialog = await openEdit('bea@acme.test');

    const save = within(dialog).getByRole('button', { name: core('organizations.detail.save') });
    // Nothing changed yet: nothing to save.
    expect(save).toBeDisabled();
    fireEvent.change(field(dialog, 'organizations.detail.email'), { target: { value: 'bee@acme.test' } });
    fireEvent.change(byLabel(dialog, core('organizations.detail.role')), { target: { value: ADMIN_ROLE } });
    fireEvent.click(save);

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(2));
    expect(patchSpy.mock.calls[0]).toEqual([
      `${ORG_URL}/members/${BEA}`,
      { firstName: 'bea', lastName: 'Doe', email: 'bee@acme.test', expectedUpdatedAt: UPDATED_AT },
    ]);
    expect(patchSpy.mock.calls[1]).toEqual([`${ORG_URL}/members/${BEA}/role`, { roleId: ADMIN_ROLE, expectedUpdatedAt: NEWER }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('sends only the profile when only the profile changed', async () => {
    renderDetail();
    const dialog = await openEdit('bea@acme.test');
    fireEvent.change(field(dialog, 'organizations.detail.firstName'), { target: { value: 'Beatrix' } });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.save') }));

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[0]).toBe(`${ORG_URL}/members/${BEA}`);
  });

  it('on a version conflict keeps the dialog open on the member\'s current values and says so', async () => {
    patchSpy.mockRejectedValueOnce(apiError(409, 'VERSION_CONFLICT', 'stale'));
    renderDetail();
    const dialog = await openEdit('bea@acme.test');
    // Someone else renamed her meanwhile; the re-read answers that.
    detail = org({ members: [member(ADA, 'ada@acme.test', ADMINISTRATOR), { ...member(BEA, 'bea@acme.test', BUYER, NEWER), firstName: 'Bianca' }] });
    fireEvent.change(field(dialog, 'organizations.detail.firstName'), { target: { value: 'Beatrix' } });
    fireEvent.click(within(dialog).getByRole('button', { name: core('organizations.detail.save') }));

    expect(await within(dialog).findByText(own('members.edit.conflict'))).toBeInTheDocument();
    await waitFor(() => expect(field(dialog, 'organizations.detail.firstName')).toHaveValue('Bianca'));
  });

  it('asks before removing a member, naming them, and removes nothing on Cancel', async () => {
    renderDetail();
    await screen.findByText('bea@acme.test');

    fireEvent.click(screen.getByRole('button', { name: own('members.row.remove', { email: 'bea@acme.test' }) }));
    const question = await answerConfirm(false);
    expect(question).toHaveTextContent('bea@acme.test');
    expect(deleteSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: own('members.row.remove', { email: 'bea@acme.test' }) }));
    await answerConfirm(true);
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${ORG_URL}/members/${BEA}`));
    expect(await screen.findByText(core('organizations.detail.info.memberRemoved'))).toBeInTheDocument();
  });

  it('keeps a refused remove in the confirmation, where the operator is looking', async () => {
    deleteSpy.mockRejectedValueOnce(apiError(409, 'LAST_ADMINISTRATOR', 'The last administrator cannot be removed.'));
    renderDetail();
    await screen.findByText('bea@acme.test');

    fireEvent.click(screen.getByRole('button', { name: own('members.row.remove', { email: 'bea@acme.test' }) }));
    const dialog = await answerConfirm(true);
    expect(await within(dialog).findByText('The last administrator cannot be removed.')).toBeInTheDocument();
  });

  it('offers no member writes without customers:manage', async () => {
    renderDetail(['customers:read']);
    await screen.findByText('bea@acme.test');

    expect(screen.queryByRole('button', { name: own('members.add') })).toBeNull();
    expect(screen.queryByRole('button', { name: own('members.row.edit', { email: 'bea@acme.test' }) })).toBeNull();
    expect(screen.queryByRole('button', { name: own('members.row.remove', { email: 'bea@acme.test' }) })).toBeNull();
  });

  it('offers no Add member on a personal Organization, and says why', async () => {
    renderDetail(undefined, org({ isPersonal: true, members: [member(ADA, 'ada@acme.test', ADMINISTRATOR)] }));
    await screen.findByText('ada@acme.test');

    expect(screen.queryByRole('button', { name: own('members.add') })).toBeNull();
    expect(within(membersSection()).getByText(own('members.personal'))).toBeInTheDocument();
  });

  it('shows an empty state with the add action when the Organization has no members', async () => {
    renderDetail(undefined, org({ members: [] }));

    expect(await screen.findByText(own('members.empty.title'))).toBeInTheDocument();
    expect(within(membersSection()).getAllByRole('button', { name: own('members.add') }).length).toBeGreaterThan(0);
  });

  it('keeps the add dialog clean under axe on both ways', async () => {
    renderDetail();
    const dialog = await openAdd();
    await expectNoAxeViolations(document.body);
    fireEvent.click(within(dialog).getByRole('radio', { name: own('members.add.create') }));
    await expectNoAxeViolations(document.body);
  });
});
