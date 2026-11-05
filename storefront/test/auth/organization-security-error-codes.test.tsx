import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * Issue #740 — `/account/organization-security` is an administrator's page,
 * and its action used to redirect with the API's sentence in `?error=`, which
 * the page rendered as it found it. A code travels now: the page names a code
 * it knows and reads anything else as its own failure sentence.
 */

let locale = 'en-US';
let failure: Error | null = null;

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale, ctx: { locale } }),
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session' }));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock('../../lib/api/mfa', () => ({
  setOrganizationMfaPolicy: async () => {
    if (failure) throw failure;
    return { enforceTotp: true };
  },
}));

const { default: OrganizationSecurityPage } = await import('../../app/account/organization-security/page');
const { enforceAction } = await import('../../app/account/organization-security/actions');

async function text(searchParams: Record<string, string>): Promise<string> {
  const tree = await OrganizationSecurityPage({ searchParams: Promise.resolve(searchParams) });
  return renderToString(tree as ReactElement).replace(/<!-- -->/g, '');
}

async function redirectOf(data: FormData): Promise<string> {
  try {
    await enforceAction(data);
  } catch (err) {
    return (err as Error).message.replace(/^redirect /, '');
  }
  throw new Error('expected the action to redirect');
}

function value(v: string): FormData {
  const data = new FormData();
  data.append('value', v);
  return data;
}

beforeEach(() => {
  locale = 'en-US';
  failure = null;
});

describe('a crafted ?error= never reaches the page', () => {
  it.each(['QA 170: dowolny tekst z linku', 'SOMETHING_ELSE', 'constructor'])('%s', async (crafted) => {
    const out = await text({ error: crafted });
    expect(out).not.toContain(crafted);
    expect(out).toContain('Could not update enforcement.');
  });
});

describe('each known code renders its sentence, in English and Polish', () => {
  it.each([
    [
      'FORBIDDEN',
      'Only the organization’s administrators can change this setting.',
      'To ustawienie mogą zmieniać tylko administratorzy organizacji.',
    ],
    ['FAILED', 'Could not update enforcement.', 'Nie udało się zaktualizować wymogu.'],
  ])('%s', async (code, en, pl) => {
    expect(await text({ error: code })).toContain(en);
    locale = 'pl-PL';
    expect(await text({ error: code })).toContain(pl);
  });
});

describe('the action redirects with a code, never a sentence', () => {
  it('carries FORBIDDEN when the API refuses a non-administrator', async () => {
    failure = new StorefrontApiError(403, 'FORBIDDEN', 'Organization administrator required.');
    expect(await redirectOf(value('true'))).toBe('/account/organization-security?error=FORBIDDEN');
  });

  it('carries FAILED for any other refusal or a transport error', async () => {
    failure = new StorefrontApiError(500, 'INTERNAL_ERROR', 'Database exploded.');
    expect(await redirectOf(value('true'))).toBe('/account/organization-security?error=FAILED');
    failure = new Error('fetch failed');
    expect(await redirectOf(value('false'))).toBe('/account/organization-security?error=FAILED');
  });

  it('a success redirects with ?done=1', async () => {
    expect(await redirectOf(value('true'))).toBe('/account/organization-security?done=1');
  });
});
