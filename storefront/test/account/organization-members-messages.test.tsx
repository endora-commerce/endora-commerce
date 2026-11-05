import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { StorefrontApiError } from '../../lib/api/client';
import { visibleText } from './i18n/text';

/**
 * Issue #740 — what `/organization/members` says after one of its server
 * actions, and where that sentence comes from.
 *
 * **A code travels, never a sentence** (the rule of
 * `lib/account/organization-roles.ts` and `lib/account/org-cart-approval.ts`):
 * an action's redirect is a URL anyone can craft, so the page names a code it
 * knows in its own language and reads anything else as the generic failure.
 * The success notice names no e-mail address either — the address was in the
 * URL, so a crafted link could have put any text there too.
 */

const R_ADMIN = '00000000-0000-4000-8000-0000000000a1';
const R_MEMBER = '00000000-0000-4000-8000-0000000000b1';

let locale = 'en-US';
let failure: Error | null = null;

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
      organizationRole: { id: R_ADMIN, kind: 'administrator', name: 'Administrator' },
      permissions: [],
    },
    organization: { id: 'org-1', name: 'Acme', isPersonal: false },
    impersonation: null,
  }),
}));

const mutation = async (): Promise<unknown> => {
  if (failure) throw failure;
  return undefined;
};

vi.mock('../../lib/api/organization', () => ({
  listMembers: async () => [],
  listPendingInvitations: async () => [],
  listRoles: async () => [
    { id: R_ADMIN, kind: 'administrator', name: 'Administrator' },
    { id: R_MEMBER, kind: 'member', name: 'Member' },
  ],
  inviteMember: mutation,
  changeMemberRole: mutation,
  removeMember: mutation,
  revokeInvitation: mutation,
}));

const { default: MembersPage } = await import('../../app/(account)/organization/members/page');
const { inviteAction, changeRoleAction, removeAction, revokeAction } = await import(
  '../../app/(account)/organization/members/actions'
);

async function text(searchParams: Record<string, string>): Promise<string> {
  const tree = await MembersPage({ searchParams: Promise.resolve(searchParams) });
  return visibleText(renderToString(<>{tree as ReactNode}</>));
}

async function redirectOf(action: (data: FormData) => Promise<void>, data: FormData): Promise<string> {
  try {
    await action(data);
  } catch (err) {
    return (err as Error).message.replace(/^redirect /, '');
  }
  throw new Error('expected the action to redirect');
}

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return data;
}

beforeEach(() => {
  locale = 'en-US';
  failure = null;
});

describe('a crafted ?error= never reaches the page (issue #740)', () => {
  it.each([
    ['a sentence', 'QA 170: dowolny tekst z linku'],
    ['markup', '<b>Your account is locked</b> call +48 000 000 000'],
    ['an unknown code', 'SOMETHING_ELSE'],
    ['an inherited property name', 'constructor'],
  ])('%s renders the generic failure instead', async (_name, crafted) => {
    const out = await text({ error: crafted });
    expect(out).not.toContain(crafted);
    expect(out).not.toContain('Your account is locked');
    expect(out).toContain('Something went wrong. Try again.');
  });

  it('an empty ?error= renders no error at all', async () => {
    const out = await text({ error: '' });
    expect(out).not.toContain('Something went wrong');
  });
});

describe('each known code renders its sentence, in English and Polish', () => {
  it.each([
    [
      'EMAIL_ALREADY_IN_ORGANIZATION',
      'This e-mail address already belongs to a member of your organization or has a pending invitation.',
      'Ten adres e-mail należy już do członka Twojej organizacji albo czeka na niego zaproszenie.',
    ],
    [
      'EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION',
      'This e-mail address belongs to a member of another organization.',
      'Ten adres e-mail należy do członka innej organizacji.',
    ],
    [
      'CANNOT_DEMOTE_LAST_ADMIN',
      'This member is your organization’s only administrator, so their role cannot be changed.',
      'Ten członek jest jedynym administratorem Twojej organizacji, więc nie można zmienić jego roli.',
    ],
    [
      'CANNOT_REMOVE_LAST_ADMIN',
      'This member is your organization’s only administrator, so they cannot be removed.',
      'Ten członek jest jedynym administratorem Twojej organizacji, więc nie można go usunąć.',
    ],
    [
      'CANNOT_REVOKE_LAST_ADMIN_INVITE',
      'Your organization has no active administrator, so its only pending administrator invitation cannot be revoked.',
      'Twoja organizacja nie ma aktywnego administratora, więc nie można cofnąć jej jedynego oczekującego zaproszenia dla administratora.',
    ],
    [
      'NOT_FOUND',
      'This member, invitation or role no longer exists. Reload the page and try again.',
      'Ten członek, zaproszenie lub rola już nie istnieje. Odśwież stronę i spróbuj ponownie.',
    ],
    [
      'FORBIDDEN',
      'Only the organization’s administrators can manage members.',
      'Członkami mogą zarządzać tylko administratorzy organizacji.',
    ],
    ['VALIDATION_FAILED', 'Check the e-mail address and try again.', 'Sprawdź adres e-mail i spróbuj ponownie.'],
    ['INVITE_FAILED', 'Could not send the invitation.', 'Nie udało się wysłać zaproszenia.'],
    ['ROLE_FAILED', 'Could not change the role.', 'Nie udało się zmienić roli.'],
    ['REMOVE_FAILED', 'Could not remove the member.', 'Nie udało się usunąć członka organizacji.'],
    ['REVOKE_FAILED', 'Could not revoke the invitation.', 'Nie udało się cofnąć zaproszenia.'],
    ['FAILED', 'Something went wrong. Try again.', 'Coś poszło nie tak. Spróbuj ponownie.'],
  ])('%s', async (code, en, pl) => {
    expect(await text({ error: code })).toContain(en);
    locale = 'pl-PL';
    expect(await text({ error: code })).toContain(pl);
  });
});

describe('the success notice echoes nothing from the URL', () => {
  it('names no e-mail address, whatever ?email= carries', async () => {
    const en = await text({ status: 'invited', email: 'phish@evil.example' });
    expect(en).toContain('Invitation sent.');
    expect(en).not.toContain('phish@evil.example');
    locale = 'pl-PL';
    const pl = await text({ status: 'invited', email: 'phish@evil.example' });
    expect(pl).toContain('Zaproszenie zostało wysłane.');
    expect(pl).not.toContain('phish@evil.example');
  });
});

describe('the actions redirect with a code, never a sentence or an address', () => {
  const invite = () => redirectOf(inviteAction, form([['email', 'ola@acme.example'], ['roleId', R_MEMBER]]));
  const changeRole = () => redirectOf(changeRoleAction, form([['memberId', 'acc-2'], ['roleId', R_MEMBER]]));
  const remove = () => redirectOf(removeAction, form([['memberId', 'acc-2']]));
  const revoke = () => redirectOf(revokeAction, form([['invitationId', 'inv-1']]));

  it('a sent invitation redirects without the invitee’s address', async () => {
    const to = await invite();
    expect(to).toBe('/organization/members?status=invited');
    expect(to).not.toContain('ola');
  });

  it.each([
    ['invite', invite, 'EMAIL_ALREADY_IN_ORGANIZATION'],
    ['changeRole', changeRole, 'CANNOT_DEMOTE_LAST_ADMIN'],
    ['remove', remove, 'CANNOT_REMOVE_LAST_ADMIN'],
    ['revoke', revoke, 'CANNOT_REVOKE_LAST_ADMIN_INVITE'],
  ])('%s carries the API’s code when the page can name it', async (_name, run, code) => {
    failure = new StorefrontApiError(409, code, 'Some backend sentence the page must not show.');
    expect(await run()).toBe(`/organization/members?error=${code}`);
  });

  it.each([
    ['invite', invite, 'INVITE_FAILED'],
    ['changeRole', changeRole, 'ROLE_FAILED'],
    ['remove', remove, 'REMOVE_FAILED'],
    ['revoke', revoke, 'REVOKE_FAILED'],
  ])('%s carries its own failure code for an unknown API code or a transport error', async (_name, run, code) => {
    failure = new StorefrontApiError(500, 'INTERNAL_ERROR', 'Database exploded.');
    expect(await run()).toBe(`/organization/members?error=${code}`);
    failure = new Error('fetch failed');
    expect(await run()).toBe(`/organization/members?error=${code}`);
  });
});
