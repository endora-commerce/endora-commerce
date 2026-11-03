import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { OrgCartDetail } from '../../lib/api/cart';

/**
 * Issue #650 — the Organization administrator's cart detail
 * (`/organization/carts/[id]`): owner, lines, total and submission time, and
 * for a pending cart the two answers — approve, or reject with a reason.
 *
 * The page is an async server component, awaited and rendered with the
 * session, the account and the cart client mocked (the pattern of
 * `test/checkout/cart-page-locale.test.tsx`). SSR-only: the markup is the
 * assertion.
 */
let locale = 'en-US';
let role: 'organization_admin' | 'regular_user' = 'organization_admin';
let detail: OrgCartDetail | null = null;
let loadError: Error | null = null;

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
    customerAccount: { id: 'admin-1', role },
    organization: { id: 'org-1', name: 'Acme' },
  }),
}));
vi.mock('../../lib/api/cart', () => ({
  getOrganizationCart: async () => {
    if (loadError) throw loadError;
    return detail;
  },
  approveOrganizationCart: async () => undefined,
  rejectOrganizationCart: async () => undefined,
}));

const { default: OrgCartDetailPage } = await import('../../app/(account)/organization/carts/[id]/page');

const CART_ID = '00000000-0000-4000-8000-000000000650';

function pendingCart(overrides: Partial<OrgCartDetail> = {}): OrgCartDetail {
  return {
    id: CART_ID,
    ownerCustomerAccountId: 'member-1',
    ownerDisplayName: 'buyer@acme.example',
    status: 'active',
    approvalStatus: 'pending',
    itemCount: 1,
    total: { amount: 30, currency: 'PLN' },
    lastActivityAt: '2026-11-03T09:00:00.000Z',
    submittedForApprovalAt: '2026-11-03T09:00:00.000Z',
    approvedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    items: [
      {
        id: 'line-1',
        productId: 'product-1',
        variantId: null,
        displayName: 'Hex bolt M8',
        productSku: 'BOLT-M8',
        quantity: 3,
        unitPrice: { amount: 10, currency: 'PLN' },
        lineTotal: { amount: 30, currency: 'PLN' },
      },
    ],
    ...overrides,
  };
}

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  const tree = await OrgCartDetailPage({
    params: Promise.resolve({ id: CART_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToString(<>{tree}</>).replaceAll('<!-- -->', '');
}

beforeEach(() => {
  locale = 'en-US';
  role = 'organization_admin';
  detail = pendingCart();
  loadError = null;
});

describe('organization cart detail — issue #650', () => {
  it('shows the owner, the lines, the total and when it was submitted', async () => {
    const html = await render();
    expect(html).toContain('buyer@acme.example');
    expect(html).toContain('Hex bolt M8');
    expect(html).toContain('BOLT-M8');
    expect(html).toMatch(/<td[^>]*>3<\/td>/);
    expect(html).toContain('Submitted for approval');
    expect(html).toContain('Awaiting approval');
    expect(html).toContain('30');
    expect(html).toContain('href="/organization/carts"');
  });

  it('offers approve and a reject form whose reason is required, for a pending cart', async () => {
    const html = await render();
    expect(html).toContain('Approve cart');
    expect(html).toContain('Reject cart');
    expect(html).toMatch(/<textarea[^>]*name="reason"[^>]*required/);
    expect(html).toMatch(/<textarea[^>]*maxLength="2000"/);
    expect(html).toMatch(/<label[^>]*for="reject-reason"/);
    expect(html).toContain(`name="cartId" value="${CART_ID}"`);
  });

  it.each(['approved', 'rejected_by_org_admin', 'not_required'] as const)(
    'offers no decision for a cart that is %s, and says why',
    async (approvalStatus) => {
      detail = pendingCart({
        approvalStatus,
        ...(approvalStatus === 'rejected_by_org_admin'
          ? { status: 'rejected', rejectedAt: '2026-11-03T10:00:00.000Z', rejectedReason: 'Over budget' }
          : {}),
      });
      const html = await render();
      expect(html).not.toContain('Approve cart');
      expect(html).not.toContain('<textarea');
      expect(html).toContain('This cart is not awaiting approval');
    },
  );

  it('shows the reason a rejected cart was rejected for', async () => {
    detail = pendingCart({
      status: 'rejected',
      approvalStatus: 'rejected_by_org_admin',
      rejectedAt: '2026-11-03T10:00:00.000Z',
      rejectedReason: 'Over the quarterly budget',
    });
    expect(await render()).toContain('Over the quarterly budget');
  });

  it.each([
    ['en-US', 'approved', 'The cart was approved. Its owner can now place the order.'],
    ['pl-PL', 'approved', 'Koszyk został zaakceptowany. Jego właściciel może teraz złożyć zamówienie.'],
    ['en-US', 'rejected', 'The cart was rejected. Its owner will see the reason in their cart.'],
    ['pl-PL', 'rejected', 'Koszyk został odrzucony. Jego właściciel zobaczy powód w swoim koszyku.'],
  ])('confirms the answer in %s (%s)', async (l, done, sentence) => {
    locale = l;
    const html = await render({ done });
    expect(html).toContain(sentence);
    expect(html).toContain('role="status"');
  });

  it.each([
    ['en-US', 'CART_APPROVAL_NOT_PENDING', 'This cart is no longer awaiting approval'],
    ['pl-PL', 'CART_APPROVAL_NOT_PENDING', 'Ten koszyk nie oczekuje już na akceptację'],
    ['en-US', 'REASON_REQUIRED', 'Give a reason for the rejection'],
    ['pl-PL', 'REASON_REQUIRED', 'Podaj powód odrzucenia'],
    ['en-US', 'SOMETHING_ELSE', 'The answer could not be saved. Try again.'],
    ['pl-PL', 'SOMETHING_ELSE', 'Nie udało się zapisać decyzji. Spróbuj ponownie.'],
  ])('names the refusal in %s (%s)', async (l, error, sentence) => {
    locale = l;
    const html = await render({ error });
    expect(html).toContain(sentence);
    expect(html).toContain('role="alert"');
  });

  it('links a missing reason to the field it is about', async () => {
    const html = await render({ error: 'REASON_REQUIRED' });
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<textarea[^>]*aria-describedby="reject-reason-error"/);
    expect(html).toContain('id="reject-reason-error"');
  });

  it('never renders an error parameter that is not a known code as text', async () => {
    const html = await render({ error: 'Call +48 000 000 000 to unlock' });
    expect(html).not.toContain('+48 000');
    expect(html).toContain('The answer could not be saved. Try again.');
  });

  it('says the cart does not exist, in Polish too, for an unknown id', async () => {
    detail = null;
    expect(await render()).toContain('This cart does not exist or is not in your organization.');
    locale = 'pl-PL';
    expect(await render()).toContain('Ten koszyk nie istnieje albo nie należy do Twojej organizacji.');
  });

  it('says the cart could not be loaded when the read fails', async () => {
    loadError = new Error('boom');
    expect(await render()).toContain('Could not load the cart.');
  });

  it('refuses a member who is not an administrator', async () => {
    role = 'regular_user';
    const html = await render();
    expect(html).toContain('Only Organization Administrators can see this page.');
    expect(html).not.toContain('Approve cart');
  });

  it('renders in Polish with no English left in the decision', async () => {
    locale = 'pl-PL';
    const html = await render();
    for (const text of ['Zaakceptuj koszyk', 'Odrzuć koszyk', 'Powód odrzucenia', 'Oczekuje na akceptację']) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('Approve cart');
  });
});
