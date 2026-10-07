import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUserRecord } from '@endora-commerce/contracts';

/**
 * Who may be mentioned and who is told (User Story 18), against stub ports —
 * the same rules `backend/test/integration/crm/mentions.test.ts` holds over
 * HTTP, here without a database so each condition is taken out one at a time.
 */

const scope = vi.hoisted(() => ({
  actorId: null as string | null,
  reachable: new Set<string>(),
}));

vi.mock('@endora-commerce/platform/tenancy', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/platform/tenancy')>(
    '@endora-commerce/platform/tenancy',
  );
  return {
    ...actual,
    getTenantContext: () =>
      scope.actorId === null
        ? { mode: 'system', actor: { kind: 'system' } }
        : { mode: 'all', actor: { kind: 'admin', id: scope.actorId } },
    isOrgInScope: (organizationId: string) => scope.reachable.has(organizationId),
  };
});

const { MentionService, newlyMentioned } = await import('./mention-service.js');

const AUTHOR = '00000000-0000-4000-8000-0000000000a0';
const TOMASZ = '00000000-0000-4000-8000-0000000000a1';
const ANNA = '00000000-0000-4000-8000-0000000000a2';
const NO_CRM = '00000000-0000-4000-8000-0000000000a3';
const INACTIVE = '00000000-0000-4000-8000-0000000000a4';
const DELETED = '00000000-0000-4000-8000-0000000000a5';
const CONFINED = '00000000-0000-4000-8000-0000000000a6';
const ORGANIZATION = '00000000-0000-4000-8000-0000000000b0';
const OTHER_ORGANIZATION = '00000000-0000-4000-8000-0000000000b1';
const CRM_ROLE = 'role-crm';
const OTHER_ROLE = 'role-other';

const token = (id: string): string => `[[admin_user:${id}]]`;

function admin(id: string, firstName: string, lastName: string, overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  return {
    id,
    email: `${firstName.toLowerCase()}@example.com`,
    firstName,
    lastName,
    adminRoleId: CRM_ROLE,
    status: 'active',
    twoFactorEnabled: false,
    lastLoginAt: null,
    preferredLanguage: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...overrides,
  };
}

const PEOPLE: AdminUserRecord[] = [
  admin(AUTHOR, 'Ada', 'Author'),
  admin(TOMASZ, 'Tomasz', 'Nowak'),
  admin(ANNA, 'Anna', 'Żak'),
  admin(NO_CRM, 'Norbert', 'Nowak', { adminRoleId: OTHER_ROLE }),
  admin(INACTIVE, 'Irena', 'Nowak', { status: 'inactive' }),
  admin(DELETED, 'Daniel', 'Nowak', { deletedAt: new Date(1) }),
  admin(CONFINED, 'Celina', 'Nowak'),
];

function build() {
  const notify = vi.fn(async () => 'recorded' as const);
  const listPermissions = vi.fn(async (id: string) =>
    PEOPLE.find((person) => person.id === id)?.adminRoleId === CRM_ROLE ? ['crm:read'] : ['orders:read'],
  );
  const canReach = vi.fn(async (id: string, organizationId: string) =>
    id === CONFINED ? organizationId === ORGANIZATION : true,
  );
  const service = new MentionService({
    adminUsers: {
      findById: async (id: string) => PEOPLE.find((person) => person.id === id) ?? null,
      findByIds: async (ids: readonly string[]) => PEOPLE.filter((person) => ids.includes(person.id)),
      findByEmail: async () => null,
      listAll: async () => PEOPLE,
      listByRoleId: async () => [],
    },
    permissions: { listPermissions, resolveRole: async () => ({ refusal: new Error('unused') }) },
    notifier: { notify },
    canReach,
  });
  const told = (): string[] => notify.mock.calls.map(([notification]) => notification.targetAdminUserId);
  return { service, notify, listPermissions, canReach, told };
}

const saved = (adminUserIds: string[], organizationId = ORGANIZATION) => ({
  opportunityId: 'opportunity-1',
  organizationId,
  number: 'OPP-000042',
  adminUserIds,
});

beforeEach(() => {
  scope.actorId = AUTHOR;
  scope.reachable = new Set([ORGANIZATION, OTHER_ORGANIZATION]);
});

describe('newlyMentioned', () => {
  it('answers who the new text mentions and the old one did not, each once', () => {
    expect(newlyMentioned(null, `${token(TOMASZ)} ${token(ANNA)} ${token(TOMASZ)}`)).toEqual([TOMASZ, ANNA]);
    expect(newlyMentioned(`Hi ${token(TOMASZ)}`, `Hi ${token(TOMASZ)}, and ${token(ANNA)}`)).toEqual([ANNA]);
  });

  it('answers nobody for the same text, a reworded one, a cleared one and one with no mention', () => {
    const text = `Hi ${token(TOMASZ)}`;
    expect(newlyMentioned(text, text)).toEqual([]);
    expect(newlyMentioned(text, `${token(TOMASZ)} hello again`)).toEqual([]);
    expect(newlyMentioned(text, null)).toEqual([]);
    expect(newlyMentioned(null, '@Tomasz jan@example.com [[product:' + TOMASZ + ']]')).toEqual([]);
  });
});

describe('MentionService.tell', () => {
  it('tells each mentioned person once, by number and the author’s name, with no body', async () => {
    const { service, notify } = build();
    expect(await service.tell(saved([TOMASZ, ANNA, TOMASZ]))).toEqual([TOMASZ, ANNA]);
    expect(notify.mock.calls.map(([notification]) => notification)).toEqual([
      {
        kind: 'crm.opportunity.mention',
        targetAdminUserId: TOMASZ,
        opportunityId: 'opportunity-1',
        title: 'Ada Author mentioned you in opportunity OPP-000042',
      },
      {
        kind: 'crm.opportunity.mention',
        targetAdminUserId: ANNA,
        opportunityId: 'opportunity-1',
        title: 'Ada Author mentioned you in opportunity OPP-000042',
      },
    ]);
  });

  it('never tells the author about mentioning themself', async () => {
    const { service, told } = build();
    expect(await service.tell(saved([AUTHOR]))).toEqual([]);
    await service.tell(saved([AUTHOR, TOMASZ]));
    expect(told()).toEqual([TOMASZ]);
  });

  it('never tells somebody without crm:read, a deactivated person, a deleted one or an unknown id', async () => {
    const { service, told } = build();
    await service.tell(saved([NO_CRM, INACTIVE, DELETED, '00000000-0000-4000-8000-0000000000ff', TOMASZ]));
    expect(told()).toEqual([TOMASZ]);
  });

  it('never tells somebody who cannot reach the Opportunity’s Organization', async () => {
    const { service, told } = build();
    await service.tell(saved([CONFINED, TOMASZ], OTHER_ORGANIZATION));
    expect(told()).toEqual([TOMASZ]);
    await service.tell(saved([CONFINED], ORGANIZATION));
    expect(told()).toEqual([TOMASZ, CONFINED]);
  });

  it('asks nobody anything when nobody is newly mentioned', async () => {
    const { service, notify, listPermissions, canReach } = build();
    expect(await service.tell(saved([]))).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expect(listPermissions).not.toHaveBeenCalled();
    expect(canReach).not.toHaveBeenCalled();
  });

  it('says "you were mentioned" when no administrator is behind the save', async () => {
    scope.actorId = null;
    const { service, notify } = build();
    await service.tell(saved([TOMASZ]));
    expect(notify.mock.calls[0]?.[0].title).toBe('You were mentioned in opportunity OPP-000042');
  });
});

describe('MentionService.mentionable', () => {
  const names = async (query: Record<string, unknown>) =>
    (await build().service.mentionable({ limit: 20, ...query })).map((option) => option.name);

  it('offers active administrators holding crm:read, by name, with an id and a name only', async () => {
    const { service } = build();
    const options = await service.mentionable({ limit: 20 });
    expect(options.map((option) => option.name)).toEqual(['Ada Author', 'Anna Żak', 'Celina Nowak', 'Tomasz Nowak']);
    expect(Object.keys(options[0]!).sort()).toEqual(['id', 'name']);
  });

  it('searches the name without regard to case or diacritics, and the e-mail address', async () => {
    expect(await names({ q: 'zak' })).toEqual(['Anna Żak']);
    expect(await names({ q: 'TOMASZ n' })).toEqual(['Tomasz Nowak']);
    expect(await names({ q: 'celina@' })).toEqual(['Celina Nowak']);
    // The name matches four people called Nowak; only two may be mentioned.
    expect(await names({ q: 'nowak' })).toEqual(['Celina Nowak', 'Tomasz Nowak']);
  });

  it('with an Organization, offers only people who may reach it', async () => {
    expect(await names({ q: 'nowak', organizationId: ORGANIZATION })).toEqual(['Celina Nowak', 'Tomasz Nowak']);
    expect(await names({ q: 'nowak', organizationId: OTHER_ORGANIZATION })).toEqual(['Tomasz Nowak']);
  });

  it('offers, and tells, a platform administrator — whose role holds `*` and never the code itself', async () => {
    // The role every installation creates holds the wildcard alone, so this is
    // the commonest person there is; `requireAdmin('crm:read')` lets them in.
    const { service, listPermissions, told } = build();
    listPermissions.mockImplementation(async () => ['*']);
    expect((await service.mentionable({ limit: 20, q: 'norbert' })).map((option) => option.name)).toEqual([
      'Norbert Nowak',
    ]);
    await service.tell(saved([NO_CRM]));
    expect(told()).toEqual([NO_CRM]);
  });

  it('offers nobody for an Organization out of the caller’s own reach, and asks nothing', async () => {
    scope.reachable = new Set([ORGANIZATION]);
    const { service, listPermissions, canReach } = build();
    expect(await service.mentionable({ limit: 20, organizationId: OTHER_ORGANIZATION })).toEqual([]);
    expect(listPermissions).not.toHaveBeenCalled();
    expect(canReach).not.toHaveBeenCalled();
  });

  it('honours the limit, and asks a role’s permissions once however many hold it', async () => {
    const { service, listPermissions } = build();
    expect(await service.mentionable({ limit: 2 })).toHaveLength(2);
    await service.mentionable({ limit: 20 });
    // Two roles among the candidates: two questions per call at most.
    expect(listPermissions.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
