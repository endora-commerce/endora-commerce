import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Issue #1323 — the backend records an account's e-mail language (#652, D-292)
 * from the `Accept-Language` of the request that creates or signs in the
 * account. These calls are made server-side, so that header exists only when the
 * storefront forwards the page language, which `apiMutate` takes from the
 * request context. Each action that creates or signs in an account must hand
 * that context on; without it every account records the channel's default
 * language, whatever page the buyer was on.
 */

const PAGE_CTX = { salesChannelCode: 'trade', locale: 'pl-PL' };

vi.mock('../../lib/server-context', () => ({
  getServerContext: vi.fn(async () => ({
    locale: 'pl-PL',
    anonymousAccess: true,
    ctx: PAGE_CTX,
    modules: { isPresent: () => false },
    urlState: { languages: [], aliases: [], current: 'pl-PL' },
  })),
}));
vi.mock('../../components/Hook', () => ({ Hook: () => null }));

const refused = (): Promise<never> => Promise.reject(new Error('refused in test'));
const auth = vi.hoisted(() => ({
  loginCustomer: vi.fn(),
  registerOrganization: vi.fn(),
  registerStandaloneCustomer: vi.fn(),
}));
vi.mock('../../lib/api/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...auth,
}));
const organization = vi.hoisted(() => ({ acceptInvitation: vi.fn() }));
vi.mock('../../lib/api/organization', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...organization,
}));

const { default: LoginPage } = await import('../../app/(auth)/login/page');
const { default: RegisterCustomerPage } = await import('../../app/(auth)/register-customer/page');
const { default: AcceptInvitationPage } =
  await import('../../app/(auth)/invitations/[token]/accept/page');
const { registerFormAction } = await import('../../app/(auth)/register/actions');

type Action = (data: FormData) => Promise<void>;

/** The first `<form action={fn}>` in the element tree a page returns. */
function formAction(node: unknown): Action | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = formAction(child);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return null;
  const element = node as ReactElement<{ action?: unknown; children?: unknown }>;
  if (element.type === 'form' && typeof element.props.action === 'function') {
    return element.props.action as Action;
  }
  return formAction(element.props.children);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Runs an action whose redirect (a thrown control-flow signal) is not under test. */
async function settle(run: Promise<unknown>): Promise<void> {
  await run.catch(() => undefined);
}

beforeEach(() => {
  for (const mock of [...Object.values(auth), ...Object.values(organization)]) {
    mock.mockReset();
    mock.mockImplementation(refused);
  }
});

describe('account creation and sign-in forward the page language (#1323)', () => {
  it('the sign-in form', async () => {
    const action = formAction(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(action).not.toBeNull();
    await settle(action!(form({ email: 'buyer@example.test', password: 'secret' })));
    expect(auth.loginCustomer).toHaveBeenCalledWith(
      { email: 'buyer@example.test', password: 'secret' },
      expect.objectContaining({ locale: 'pl-PL' }),
    );
  });

  it('the B2C registration form', async () => {
    const action = formAction(await RegisterCustomerPage({ searchParams: Promise.resolve({}) }));
    expect(action).not.toBeNull();
    await settle(
      action!(
        form({ email: 'new@example.test', password: 'secret', firstName: 'A', lastName: 'B' }),
      ),
    );
    expect(auth.registerStandaloneCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@example.test' }),
      expect.objectContaining({ locale: 'pl-PL' }),
    );
  });

  it('the organization registration form', async () => {
    await settle(
      registerFormAction(
        { status: 'idle' } as never,
        form({
          organizationName: 'Acme',
          taxId: '5260001246',
          street: 'Ulica 1',
          city: 'Warszawa',
          postalCode: '00-001',
          country: 'PL',
          email: 'owner@example.test',
          password: 'secret-secret',
          firstName: 'A',
          lastName: 'B',
        }),
      ),
    );
    expect(auth.registerOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        firstUser: expect.objectContaining({ email: 'owner@example.test' }),
      }),
      expect.objectContaining({ locale: 'pl-PL' }),
    );
  });

  it('the invitation acceptance form, and the sign-in that follows it', async () => {
    organization.acceptInvitation.mockResolvedValue({
      customerAccount: { email: 'invitee@example.test' },
    });
    const page = await AcceptInvitationPage({
      params: Promise.resolve({ token: 'tok' }),
      searchParams: Promise.resolve({}),
    } as never);
    const action = formAction(page);
    expect(action).not.toBeNull();
    await settle(
      action!(form({ token: 'tok', firstName: 'A', lastName: 'B', password: 'secret' })),
    );
    expect(organization.acceptInvitation).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({ password: 'secret' }),
      expect.objectContaining({ locale: 'pl-PL' }),
    );
    expect(auth.loginCustomer).toHaveBeenCalledWith(
      { email: 'invitee@example.test', password: 'secret' },
      expect.objectContaining({ locale: 'pl-PL' }),
    );
  });
});
