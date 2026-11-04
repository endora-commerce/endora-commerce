import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { StorefrontApiError } from '../../lib/api/client';
import type {
  MemberSummary,
  OrganizationRoleView,
  PendingInvitation,
  PermissionCatalogueGroup,
} from '../../lib/api/organization';
import { visibleText } from './i18n/text';

/**
 * Feature 170 (`specs/170-organization-roles/`, WP-09; FR-004, FR-010, FR-024,
 * FR-025, US 1, US 6) — the storefront's role screens and the members page's
 * role select.
 *
 * The permission list of the role editor is the catalogue the API serves, with
 * its labels: the fixture carries a code no storefront file names
 * (`returns.create`), so a hard-coded list would fail here. A new role starts
 * with nothing ticked and offers no "copy from Member" (owner ruling Q1). A
 * personal Organization's member holds *Administrator* yet is sent back to the
 * account page, judged by `organization.isPersonal` (PR-3, PR-10, FR-070a).
 *
 * Every page is an async server component, awaited and rendered with
 * `renderToString` against mocked transports; the server actions are called
 * with a `FormData` and judged by what they send and where they redirect.
 */

const R_ADMIN = '00000000-0000-4000-8000-0000000000a1';
const R_MEMBER = '00000000-0000-4000-8000-0000000000b1';
const R_JUNIOR = '00000000-0000-4000-8000-0000000000c1';
const R_EMPTY = '00000000-0000-4000-8000-0000000000d1';

let locale = 'en-US';
let isPersonal = false;
let roleKind: 'administrator' | 'member' | 'custom' = 'administrator';
let roles: OrganizationRoleView[] = [];
let catalogue: PermissionCatalogueGroup[] = [];
let members: MemberSummary[] = [];
let invitations: PendingInvitation[] = [];
let failure: Error | null = null;
const calls: Array<{ fn: string; args: unknown[] }> = [];

vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session',
  getAnonCartCookie: async () => null,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/account', () => ({
  getMe: async () => ({
    customerAccount: {
      id: 'acc-1',
      organizationRole: { id: R_ADMIN, kind: roleKind, name: 'Administrator' },
      permissions: roleKind === 'administrator' ? ['carts.create', 'carts.approve'] : ['carts.create'],
    },
    organization: { id: 'org-1', name: 'Acme', isPersonal },
    impersonation: null,
  }),
}));

function record<T>(fn: string, answer: () => T): (...args: unknown[]) => Promise<T> {
  return async (...args: unknown[]) => {
    calls.push({ fn, args });
    if (failure) throw failure;
    return answer();
  };
}

vi.mock('../../lib/api/organization', () => ({
  listRoles: record('listRoles', () => roles),
  getRole: record('getRole', () => roles.find((r) => r.id === currentId) ?? null),
  getPermissionCatalogue: record('getPermissionCatalogue', () => catalogue),
  createRole: record('createRole', () => roles[2]),
  updateRole: record('updateRole', () => roles[2]),
  deleteRole: record('deleteRole', () => ({ reassignedMembers: 3, reassignedInvitations: 1 })),
  listMembers: record('listMembers', () => members),
  listPendingInvitations: record('listPendingInvitations', () => invitations),
  inviteMember: record('inviteMember', () => ({ invitationId: 'inv-1', expiresAt: '2026-11-10T00:00:00.000Z' })),
  changeMemberRole: record('changeMemberRole', () => members[0]),
  removeMember: record('removeMember', () => undefined),
  revokeInvitation: record('revokeInvitation', () => undefined),
}));

let currentId = R_JUNIOR;

const { default: RolesPage } = await import('../../app/(account)/organization/roles/page');
const { default: NewRolePage } = await import('../../app/(account)/organization/roles/new/page');
const { default: EditRolePage } = await import('../../app/(account)/organization/roles/[id]/page');
const { default: MembersPage } = await import('../../app/(account)/organization/members/page');
const { createRoleAction, updateRoleAction, deleteRoleAction } = await import(
  '../../app/(account)/organization/roles/actions'
);
const { RoleEditorForm } = await import('../../components/account/RoleEditorForm');

/** No refusal yet — what `useActionState` starts from. */
const IDLE = { error: null };


function role(overrides: Partial<OrganizationRoleView> & Pick<OrganizationRoleView, 'id' | 'kind' | 'name'>): OrganizationRoleView {
  return {
    description: null,
    permissions: [],
    memberCount: 0,
    pendingInvitationCount: 0,
    version: 1,
    updatedAt: '2026-11-04T09:00:00.000Z',
    ...overrides,
  };
}

async function html(tree: unknown): Promise<string> {
  return renderToString(<>{(await tree) as ReactNode}</>).replaceAll('<!-- -->', '');
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected the call to redirect');
}

/** The one opening tag carrying `attribute` — React orders a form field's attributes its own way. */
function tagWith(out: string, attribute: string): string {
  const tags = out.match(/<(?:input|textarea|select)\b[^>]*>/g) ?? [];
  const found = tags.filter((tag) => tag.includes(attribute));
  expect(found).toHaveLength(1);
  return found[0]!;
}

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
}

const list = (searchParams: Record<string, string> = {}) => RolesPage({ searchParams: Promise.resolve(searchParams) });
// The new-role page takes no `searchParams` at all: whatever a link carries, it reads nothing (owner ruling, PR #715).
const create = (_crafted: Record<string, string> = {}) => NewRolePage();
const edit = (id: string, searchParams: Record<string, string> = {}) => {
  currentId = id;
  return EditRolePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) });
};
const membersPage = () => MembersPage({ searchParams: Promise.resolve({}) });

beforeEach(() => {
  locale = 'en-US';
  isPersonal = false;
  roleKind = 'administrator';
  failure = null;
  calls.length = 0;
  currentId = R_JUNIOR;
  roles = [
    role({
      id: R_ADMIN,
      kind: 'administrator',
      name: 'Administrator',
      permissions: ['carts.create', 'carts.approve', 'carts.order_without_approval', 'quick_order.one_click', 'returns.create'],
      memberCount: 1,
    }),
    role({ id: R_MEMBER, kind: 'member', name: 'Member', permissions: ['carts.create'], memberCount: 4, pendingInvitationCount: 2 }),
    role({
      id: R_JUNIOR,
      kind: 'custom',
      name: 'Junior buyer',
      description: 'Builds carts, sends them for approval',
      permissions: ['carts.create', 'returns.create'],
      memberCount: 3,
      pendingInvitationCount: 1,
      version: 2,
    }),
    role({ id: R_EMPTY, kind: 'custom', name: 'Auditor' }),
  ];
  catalogue = [
    {
      moduleId: 'carts',
      moduleLabel: 'Carts',
      permissions: [
        { code: 'carts.create', label: 'Create and edit carts', description: 'Add products to a cart.', memberDefault: true },
        { code: 'carts.approve', label: "Approve and reject colleagues' carts", description: 'See and answer carts.', memberDefault: false },
        {
          code: 'carts.order_without_approval',
          label: 'Place orders without approval',
          description: 'Order a cart directly.',
          memberDefault: true,
        },
      ],
    },
    {
      moduleId: 'quick_order',
      moduleLabel: 'Quick order',
      permissions: [{ code: 'quick_order.one_click', label: 'One-click purchase', description: 'Buy in one click.', memberDefault: true }],
    },
    {
      moduleId: 'returns',
      moduleLabel: 'Returns',
      permissions: [{ code: 'returns.create', label: 'Start returns', description: 'Ask to return an order.', memberDefault: true }],
    },
  ];
  members = [
    {
      id: 'acc-1',
      organizationId: 'org-1',
      email: 'anna@acme.example',
      firstName: 'Anna',
      lastName: 'Nowak',
      organizationRole: { id: R_ADMIN, kind: 'administrator', name: 'Administrator' },
      emailVerifiedAt: null,
      twoFactorEnabled: false,
    },
    {
      id: 'acc-2',
      organizationId: 'org-1',
      email: 'piotr@acme.example',
      firstName: 'Piotr',
      lastName: 'Kowalski',
      organizationRole: { id: R_JUNIOR, kind: 'custom', name: 'Junior buyer' },
      emailVerifiedAt: null,
      twoFactorEnabled: false,
    },
  ];
  invitations = [
    {
      id: 'inv-1',
      organizationId: 'org-1',
      email: 'ola@acme.example',
      organizationRole: { id: R_MEMBER, kind: 'member', name: 'Member' },
      invitedByCustomerAccountId: null,
      expiresAt: '2026-11-10T00:00:00.000Z',
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  ];
});

describe('a personal Organization is offered no role or member screen (PR-3, FR-070a)', () => {
  it.each([
    ['the roles list', () => list()],
    ['the new-role form', () => create()],
    ['a role', () => edit(R_JUNIOR)],
    ['the members page', () => membersPage()],
  ])('%s redirects its member — an Administrator — to the account page', async (_name, page) => {
    isPersonal = true;
    expect(await rejection(page() as Promise<unknown>)).toBe('redirect /account');
    expect(calls.filter((c) => c.fn !== 'getMe')).toEqual([]);
  });
});

describe('role screens are the administrator’s (FR-010)', () => {
  it.each([
    ['the roles list', () => list()],
    ['the new-role form', () => create()],
    ['a role', () => edit(R_JUNIOR)],
  ])('%s refuses a member who is not the administrator, and reads nothing', async (_name, page) => {
    roleKind = 'custom';
    const text = visibleText(await html(page()));
    expect(text).toContain('Only the organization’s administrators can manage roles.');
    expect(calls).toEqual([]);
  });
});

describe('roles list — /organization/roles', () => {
  it('lists every role with its kind, members, invitations and permissions, and offers one new role', async () => {
    const out = await html(list());
    const text = visibleText(out);
    expect(text).toContain('Roles');
    expect(text).toContain('Name Type Members Pending invitations Permissions');
    expect(text).toContain('Administrator Built-in 1 0 All permissions');
    expect(text).toContain('Member Built-in 4 2 1');
    expect(text).toContain('Junior buyer Custom 3 1 2');
    expect(out).toContain('href="/organization/roles/new"');
    expect(out.match(/btn--dark/g)).toHaveLength(1);
  });

  it('offers no action on the Administrator, permissions only on Member, and editing on a custom role', async () => {
    const out = await html(list());
    expect(out).not.toContain(`href="/organization/roles/${R_ADMIN}"`);
    expect(out).toContain(`href="/organization/roles/${R_MEMBER}"`);
    expect(out).toContain(`href="/organization/roles/${R_JUNIOR}"`);
    const text = visibleText(out);
    expect(text).toContain('Edit permissions');
    expect(text).toContain('Edit');
  });

  it.each([
    [{ status: 'created' }, 'Role created.'],
    [{ status: 'saved' }, 'Role saved.'],
    [{ status: 'deleted', members: '3', invitations: '1' }, 'Role deleted. Members moved: 3. Pending invitations moved: 1.'],
  ])('confirms %o', async (params, sentence) => {
    const out = await html(list(params));
    expect(visibleText(out)).toContain(sentence);
    expect(out).toContain('role="status"');
  });

  it('says the roles could not be loaded, and offers to retry', async () => {
    failure = new Error('boom');
    const out = await html(list());
    expect(visibleText(out)).toContain('Could not load the roles.');
    expect(out).toContain('role="alert"');
    expect(out).toContain('href="/organization/roles"');
  });

  it('renders in Polish', async () => {
    locale = 'pl-PL';
    const text = visibleText(await html(list({ status: 'deleted', members: '3', invitations: '1' })));
    expect(text).toContain('Role');
    expect(text).toContain('Nazwa Rodzaj Członkowie Oczekujące zaproszenia Uprawnienia');
    expect(text).toContain('Wbudowana');
    expect(text).toContain('Własna');
    expect(text).toContain('Wszystkie uprawnienia');
    expect(text).toContain('Nowa rola');
    expect(text).toContain('Rola została usunięta. Przeniesieni członkowie: 3. Przeniesione zaproszenia: 1.');
  });
});

describe('new role — /organization/roles/new (owner ruling Q1)', () => {
  it('lists the catalogue the API serves, grouped by module, with its labels and descriptions', async () => {
    const out = await html(create());
    const text = visibleText(out);
    for (const group of ['Carts', 'Quick order', 'Returns']) expect(out).toMatch(new RegExp(`<legend[^>]*>${group}</legend>`));
    for (const label of ['Create and edit carts', 'Place orders without approval', 'One-click purchase', 'Start returns']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Ask to return an order.');
    expect(out).toContain('value="returns.create"');
    expect(calls.map((c) => c.fn)).toEqual(['getPermissionCatalogue']);
  });

  it('starts with every permission unticked and offers no copy from Member', async () => {
    const out = await html(create());
    expect(out.match(/type="checkbox"/g)).toHaveLength(5);
    expect(out).not.toMatch(/checked/);
    expect(visibleText(out)).not.toMatch(/copy/i);
  });

  it('offers no copy control from any role — no role select, no role list read (OR-9, FR-004a)', async () => {
    const out = await html(create());
    expect(out).not.toContain('<select');
    expect(calls.map((c) => c.fn)).not.toContain('listRoles');
  });

  it('names its fields, bounds them as the API does, and links each permission to its description', async () => {
    const out = await html(create());
    expect(tagWith(out, 'name="name"')).toContain('required=""');
    expect(tagWith(out, 'name="name"')).toContain('maxLength="80"');
    expect(tagWith(out, 'name="description"')).toContain('maxLength="500"');
    expect(out).toMatch(/<label[^>]*for="role-name"/);
    expect(out).toMatch(/aria-describedby="permission-returns\.create-description"/);
    expect(out).toContain('id="permission-returns.create-description"');
  });

  it('notes beside one-click that it also needs ordering without approval (OR-6)', async () => {
    const text = visibleText(await html(create()));
    expect(text).toContain('Works only together with “Place orders without approval”.');
  });

  it('reads nothing from the URL: a crafted link neither pre-fills the form nor shows a refusal', async () => {
    const out = await html(create({ error: 'ORGANIZATION_ROLE_NAME_TAKEN', name: 'Everything', permissions: 'carts.approve' }));
    expect(tagWith(out, 'name="name"')).not.toContain('value=');
    expect(out).not.toMatch(/checked/);
    expect(visibleText(out)).not.toContain('already exists');
  });

  it('mounts its announcement region empty, before any refusal (WCAG 4.1.3)', async () => {
    const out = await html(create());
    expect(out).toMatch(/<div[^>]*id="role-form-error"[^>]*><\/div>/);
    expect(out).toMatch(/<div[^>]*role="alert"[^>]*id="role-form-error"|<div[^>]*id="role-form-error"[^>]*role="alert"/);
  });

  it('renders in Polish', async () => {
    locale = 'pl-PL';
    const text = visibleText(await html(create()));
    expect(text).toContain('Nowa rola');
    expect(text).toContain('Nazwa roli');
    expect(text).toContain('Opis (opcjonalnie)');
    expect(text).toContain('Utwórz rolę');
    expect(text).toContain('Działa tylko razem z uprawnieniem „Place orders without approval”.');
  });
});

/**
 * Owner ruling 2026-11-04 (PR #715, Q3): a refused create or edit keeps what
 * the administrator typed and ticked. The form is a client component on
 * `useActionState`; the action answers the refusal's **code** as state, and
 * nothing of the form travels in a URL. SSR-only harness: the refusal is
 * rendered from `initialState`, which is `useActionState`'s own starting state.
 */
describe('role form — a refusal is shown by its code, in place', () => {
  const noop = async () => IDLE;
  const formFor = (error: string | null, role: Parameters<typeof RoleEditorForm>[0]['role'] = null) =>
    renderToString(
      <RoleEditorForm
        action={noop}
        locale={locale}
        groups={catalogue}
        granted={[]}
        role={role}
        cancelHref="/organization/roles"
        initialState={{ error: error as never }}
      />,
    ).replaceAll('<!-- -->', '');

  it.each([
    ['ORGANIZATION_ROLE_NAME_TAKEN', 'A role with this name already exists in your organization. Choose another name.'],
    ['ORGANIZATION_ROLE_LIMIT_REACHED', 'Your organization already has 50 custom roles, the most it can hold.'],
    ['ORGANIZATION_PERMISSION_UNKNOWN', 'One of the permissions is no longer available. Review the list and save again.'],
    ['FAILED', 'The role could not be saved. Try again.'],
  ])('names the refusal %s in the announcement region', (error, sentence) => {
    const out = formFor(error);
    expect(visibleText(out)).toContain(sentence);
    expect(out).toMatch(/id="role-form-error"/);
    expect(out).toContain('role="alert"');
  });

  it('links a taken name to the name field', () => {
    const out = formFor('ORGANIZATION_ROLE_NAME_TAKEN');
    expect(tagWith(out, 'name="name"')).toContain('aria-invalid="true"');
    expect(tagWith(out, 'name="name"')).toContain('aria-describedby="role-name-error"');
  });

  it('says a stale edit keeps the changes but cannot save them over another’s, and offers the reload', () => {
    const out = formFor('ORGANIZATION_ROLE_STALE', {
      id: R_JUNIOR,
      kind: 'custom',
      name: 'Junior buyer',
      description: null,
      version: 2,
    });
    expect(visibleText(out)).toContain(
      'Someone changed this role while you were editing it. Your changes are still here, but they cannot be saved over theirs: reload the role to see its current state.',
    );
    expect(out).toContain(`href="/organization/roles/${R_JUNIOR}"`);
  });

  it('renders the refusal in Polish', () => {
    locale = 'pl-PL';
    expect(visibleText(formFor('ORGANIZATION_ROLE_NAME_TAKEN'))).toContain(
      'Rola o tej nazwie już istnieje w Twojej organizacji. Wybierz inną nazwę.',
    );
  });
});

describe('a role — /organization/roles/[id]', () => {
  it('edits a custom role: its name, description and the permissions it holds, at the version read', async () => {
    const out = await html(edit(R_JUNIOR));
    expect(tagWith(out, 'name="name"')).toContain('value="Junior buyer"');
    expect(out).toContain('Builds carts, sends them for approval</textarea>');
    // The save and the delete each carry the version read.
    const versions = (out.match(/<input\b[^>]*>/g) ?? []).filter((tag) => tag.includes('name="expectedVersion"'));
    expect(versions).toHaveLength(2);
    for (const tag of versions) expect(tag).toContain('value="2"');
    expect(out).toMatch(/<input[^>]*checked=""[^>]*value="carts\.create"|<input[^>]*value="carts\.create"[^>]*checked=""/);
    expect(out).toMatch(/<input[^>]*checked=""[^>]*value="returns\.create"|<input[^>]*value="returns\.create"[^>]*checked=""/);
    expect(out.match(/checked=""/g)).toHaveLength(2);
  });

  it('asks where the members and invitations of a held role move, Member preselected (FR-024, US 6)', async () => {
    const out = await html(edit(R_JUNIOR));
    const text = visibleText(out);
    expect(out).toMatch(/<details/);
    expect(text).toContain('Delete this role…');
    expect(text).toContain('Members holding it: 3. Pending invitations: 1. They move to the role you choose.');
    expect(out).toMatch(/<select[^>]*name="replacementRoleId"/);
    expect(out).toMatch(new RegExp(`<option[^>]*value="${R_MEMBER}"[^>]*selected=""|<option[^>]*selected=""[^>]*value="${R_MEMBER}"`));
    expect(out).not.toContain(`<option value="${R_JUNIOR}"`);
    expect(text).toContain('Delete role');
  });

  it('deletes a role nobody holds without asking for a replacement', async () => {
    const out = await html(edit(R_EMPTY));
    expect(out).not.toContain('name="replacementRoleId"');
    expect(visibleText(out)).toContain('Nobody holds this role, so nobody moves.');
  });

  it('edits only the permissions of Member, which keeps its name and cannot be deleted', async () => {
    const out = await html(edit(R_MEMBER));
    expect(out).not.toContain('name="name"');
    expect(out).not.toContain('name="description"');
    expect(out).not.toContain('Delete this role');
    expect(visibleText(out)).toContain('Member is built in: its name stays and it cannot be deleted. Choose what it allows.');
    expect(out.match(/checked=""/g)).toHaveLength(1);
  });

  it('shows the Administrator read-only, with every permission', async () => {
    currentId = R_ADMIN;
    const out = await html(edit(R_ADMIN));
    expect(out).not.toContain('<form');
    expect(out).not.toContain('type="checkbox"');
    const text = visibleText(out);
    expect(text).toContain('Administrator holds every permission and manages members and roles. It cannot be changed.');
    expect(text).toContain('Start returns');
  });

  it('says a role of another organization, or a deleted one, does not exist', async () => {
    const out = await html(edit('00000000-0000-4000-8000-0000000000ff'));
    expect(visibleText(out)).toContain('This role does not exist or is not in your organization.');
    expect(out).toContain('href="/organization/roles"');
  });

  it.each([
    ['ORGANIZATION_ROLE_STALE', 'Someone changed this role while you were editing it. Its current state is shown: review it and save again.'],
    ['ORGANIZATION_ROLE_PROTECTED', 'The Administrator and Member roles cannot be renamed or deleted.'],
    ['ORGANIZATION_ROLE_REPLACEMENT_REQUIRED', 'Members or invitations hold this role: choose the role they move to.'],
  ])('names the refused deletion %s', async (error, sentence) => {
    const out = await html(edit(R_JUNIOR, { error }));
    expect(visibleText(out)).toContain(sentence);
    expect(out).toContain('role="alert"');
  });

  it('renders in Polish', async () => {
    locale = 'pl-PL';
    const text = visibleText(await html(edit(R_JUNIOR)));
    expect(text).toContain('Zapisz rolę');
    expect(text).toContain('Usuń tę rolę…');
    expect(text).toContain('Członkowie z tą rolą: 3. Oczekujące zaproszenia: 1. Przejdą do roli, którą wybierzesz.');
    expect(text).toContain('Wszystkie role');
  });
});

describe('role actions', () => {
  it('creates a role with the ticked permissions, the name trimmed and an empty description left out', async () => {
    const to = await rejection(
      createRoleAction(
        IDLE,
        form([
          ['name', '  Junior buyer '],
          ['description', '  '],
          ['permissions', 'carts.create'],
          ['permissions', 'returns.create'],
        ]),
      ),
    );
    expect(to).toBe('redirect /organization/roles?status=created');
    const call = calls.find((c) => c.fn === 'createRole');
    expect(call?.args[1]).toEqual({ name: 'Junior buyer', permissions: ['carts.create', 'returns.create'] });
  });

  it('creates a role with nothing ticked as permissions: [] (OR-9, FR-004a)', async () => {
    await rejection(createRoleAction(IDLE, form([['name', 'Viewer']])));
    const call = calls.find((c) => c.fn === 'createRole');
    expect(call?.args[1]).toEqual({ name: 'Viewer', permissions: [] });
  });

  it('answers a refused creation with its code as state, and does not navigate', async () => {
    failure = new StorefrontApiError(409, 'ORGANIZATION_ROLE_NAME_TAKEN', 'Taken: call +48 000');
    await expect(createRoleAction(IDLE, form([['name', 'Member']]))).resolves.toEqual({
      error: 'ORGANIZATION_ROLE_NAME_TAKEN',
    });
  });

  it('answers an unknown failure as FAILED, never as the API’s sentence', async () => {
    failure = new Error('Call +48 000');
    await expect(createRoleAction(IDLE, form([['name', 'X']]))).resolves.toEqual({ error: 'FAILED' });
  });

  it('saves a custom role at the version read, a cleared description as null', async () => {
    const to = await rejection(
      updateRoleAction(
        IDLE,
        form([
          ['id', R_JUNIOR],
          ['expectedVersion', '2'],
          ['name', 'Senior buyer'],
          ['description', ''],
          ['permissions', 'carts.approve'],
        ]),
      ),
    );
    expect(to).toBe('redirect /organization/roles?status=saved');
    const call = calls.find((c) => c.fn === 'updateRole');
    expect(call?.args.slice(1, 3)).toEqual([
      R_JUNIOR,
      { expectedVersion: 2, name: 'Senior buyer', description: null, permissions: ['carts.approve'] },
    ]);
  });

  it('saves Member’s permissions only — an empty list when nothing is ticked', async () => {
    await rejection(updateRoleAction(IDLE, form([['id', R_MEMBER], ['expectedVersion', '1']])));
    const call = calls.find((c) => c.fn === 'updateRole');
    expect(call?.args.slice(1, 3)).toEqual([R_MEMBER, { expectedVersion: 1, permissions: [] }]);
  });

  it('answers a stale save with its code as state, keeping the form where it is', async () => {
    failure = new StorefrontApiError(409, 'ORGANIZATION_ROLE_STALE', 'stale');
    await expect(
      updateRoleAction(IDLE, form([['id', R_JUNIOR], ['expectedVersion', '1'], ['name', 'X']])),
    ).resolves.toEqual({ error: 'ORGANIZATION_ROLE_STALE' });
  });

  it('deletes a role, moving its holders to the chosen replacement, and reports how many moved', async () => {
    const to = await rejection(
      deleteRoleAction(form([['id', R_JUNIOR], ['expectedVersion', '2'], ['replacementRoleId', R_MEMBER]])),
    );
    expect(to).toBe('redirect /organization/roles?status=deleted&members=3&invitations=1');
    const call = calls.find((c) => c.fn === 'deleteRole');
    expect(call?.args.slice(1, 3)).toEqual([R_JUNIOR, { expectedVersion: 2, replacementRoleId: R_MEMBER }]);
  });

  it('deletes a role nobody holds without a replacement', async () => {
    await rejection(deleteRoleAction(form([['id', R_EMPTY], ['expectedVersion', '1']])));
    const call = calls.find((c) => c.fn === 'deleteRole');
    expect(call?.args.slice(1, 3)).toEqual([R_EMPTY, { expectedVersion: 1 }]);
  });

  it('sends a refused deletion back to the role with the code', async () => {
    failure = new StorefrontApiError(422, 'ORGANIZATION_ROLE_REPLACEMENT_REQUIRED', 'needs one');
    const to = await rejection(deleteRoleAction(form([['id', R_JUNIOR], ['expectedVersion', '2']])));
    expect(to).toBe(`redirect /organization/roles/${R_JUNIOR}?error=ORGANIZATION_ROLE_REPLACEMENT_REQUIRED`);
  });
});

describe('members page — the role select (FR-008, US 1.2)', () => {
  it('shows each member’s role as a select of the organization’s roles, the held one selected', async () => {
    const out = await html(membersPage());
    expect(out).toMatch(/<select[^>]*name="roleId"/);
    for (const name of ['Administrator', 'Member', 'Junior buyer', 'Auditor']) expect(out).toContain(`>${name}</option>`);
    expect(out).toMatch(new RegExp(`<option[^>]*selected=""[^>]*value="${R_JUNIOR}"|<option[^>]*value="${R_JUNIOR}"[^>]*selected=""`));
    expect(out).toMatch(/<select[^>]*aria-label="Role of Piotr Kowalski"/);
  });

  it('names the role of each pending invitation from the role', async () => {
    const text = visibleText(await html(membersPage()));
    expect(text).toContain('ola@acme.example Member');
  });

  it('invites with Member preselected', async () => {
    const out = await html(membersPage());
    const invite = out.slice(out.indexOf('id="invite-role"'));
    expect(invite).toMatch(new RegExp(`^id="invite-role"[^>]*name="roleId"|^id="invite-role"[^>]*>`));
    expect(invite).toMatch(new RegExp(`<option[^>]*selected=""[^>]*value="${R_MEMBER}"|<option[^>]*value="${R_MEMBER}"[^>]*selected=""`));
  });

  it('links to the roles screen from the members page', async () => {
    expect(await html(membersPage())).toContain('href="/organization/roles"');
  });

  it('refuses a member who is not the administrator', async () => {
    roleKind = 'member';
    const text = visibleText(await html(membersPage()));
    expect(text).toContain('Only the organization’s administrators can manage members.');
    expect(calls).toEqual([]);
  });
});
