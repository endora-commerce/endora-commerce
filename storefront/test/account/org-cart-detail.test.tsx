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
let permissions: string[] = ['carts.approve'];
let roleKind = 'custom';
let isPersonal = false;
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
    customerAccount: {
      id: 'approver-1',
      organizationRole: { id: 'role-1', kind: roleKind, name: 'Purchasing' },
      permissions,
    },
    organization: { id: 'org-1', name: 'Acme', isPersonal },
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
    ownerEmail: 'buyer@acme.example',
    orderId: null,
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
  permissions = ['carts.approve'];
  roleKind = 'custom';
  isPersonal = false;
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
    ['en-US', 'CART_APPROVAL_NOT_PENDING', 'This cart is no longer awaiting approval: it has already been answered.'],
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

  it('refuses a member without carts.approve (feature 170, FR-033)', async () => {
    permissions = ['carts.create'];
    const html = await render();
    expect(html).toContain('Only members allowed to approve carts can see this page.');
    expect(html).not.toContain('Approve cart');
  });

  it('sends the member of a personal Organization to the account page (FR-070a)', async () => {
    isPersonal = true;
    await expect(render()).rejects.toThrow('redirect /account');
  });

  it('offers no decision on the approver’s own pending cart, and says who answers it (FR-032)', async () => {
    detail = pendingCart({ ownerCustomerAccountId: 'approver-1' });
    const html = await render();
    expect(html).not.toContain('Approve cart');
    expect(html).not.toContain('<textarea');
    expect(html).toContain('This is your own cart: another member allowed to approve carts answers it.');
  });

  it.each([
    ['en-US', 'CART_APPROVAL_SELF_APPROVE', 'You cannot approve or reject your own cart.'],
    ['pl-PL', 'CART_APPROVAL_SELF_APPROVE', 'Nie możesz zaakceptować ani odrzucić własnego koszyka.'],
    ['en-US', 'ORGANIZATION_PERMISSION_REQUIRED', 'Your role does not allow approving or rejecting carts.'],
    ['pl-PL', 'ORGANIZATION_PERMISSION_REQUIRED', 'Twoja rola nie pozwala akceptować ani odrzucać koszyków.'],
  ])('names the feature-170 refusal in %s (%s)', async (l, error, sentence) => {
    locale = l;
    const html = await render({ error });
    expect(html).toContain(sentence);
    expect(html).toContain('role="alert"');
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

/** Issue #751 — the owner as on the members page, and amounts that say they are net. */
describe('organization cart detail — issue #751', () => {
  it.each(['en-US', 'pl-PL'])('names the owner by full name, the e-mail beside it (%s)', async (l) => {
    locale = l;
    detail = pendingCart({ ownerDisplayName: 'Jan Kowalski', ownerEmail: 'jan@acme.example' });
    const html = await render();
    expect(html).toMatch(/<h2>[^<]*Jan Kowalski[^<]*<\/h2>/);
    expect(html).toMatch(/<dd[^>]*>Jan Kowalski<small[^>]*>jan@acme\.example<\/small><\/dd>/);
  });

  it.each([
    ['en-US', 'net'],
    ['pl-PL', 'netto'],
  ])('labels the total and the line prices as net (%s)', async (l, net) => {
    locale = l;
    const html = await render();
    const labelled = html.match(new RegExp(`zł<span[^>]*>${net}</span>`, 'g')) ?? [];
    // The total, the line's unit price and its line total.
    expect(labelled).toHaveLength(3);
  });

  it.each(['en-US', 'pl-PL'])('leaves the total of a completed cart empty, not zero (%s)', async (l) => {
    locale = l;
    detail = pendingCart({
      status: 'completed',
      approvalStatus: 'approved',
      itemCount: 0,
      total: { amount: 0, currency: 'PLN' },
      items: [],
    });
    const html = await render();
    expect(html).not.toContain('0,00');
    expect(html).toMatch(/<dd class="m-0 font-semibold">—<\/dd>/);
  });
});

/**
 * Owner ruling on PR #760 (issue #751): a completed cart links to the order it
 * produced, for a viewer the order page would answer — the Administrator, a
 * role holding `orders.view_organization`, or the order's own buyer.
 */
describe('organization cart detail — a completed cart links to its order (issue #751)', () => {
  const completed = (owner = 'member-1'): OrgCartDetail =>
    pendingCart({
      ownerCustomerAccountId: owner,
      status: 'completed',
      approvalStatus: 'approved',
      itemCount: 0,
      total: { amount: 0, currency: 'PLN' },
      items: [],
      orderId: '00000000-0000-4000-8000-000000000751',
    });
  const link = (label: string, text: string): RegExp =>
    new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*><a[^>]*href="/orders/00000000-0000-4000-8000-000000000751"[^>]*>${text}</a></dd>`);

  it.each([
    ['en-US', 'Order', 'View order'],
    ['pl-PL', 'Zamówienie', 'Zobacz zamówienie'],
  ])('links it for a role holding orders.view_organization (%s)', async (l, label, text) => {
    locale = l;
    permissions = ['carts.approve', 'orders.view_organization'];
    detail = completed();
    expect(await render()).toMatch(link(label, text));
  });

  it('links it for the Administrator, and for the buyer who placed it', async () => {
    roleKind = 'administrator';
    detail = completed();
    expect(await render()).toMatch(link('Order', 'View order'));
    roleKind = 'custom';
    detail = completed('approver-1');
    expect(await render()).toMatch(link('Order', 'View order'));
  });

  it('offers no link to a viewer the order page would not answer', async () => {
    detail = completed();
    expect(await render()).not.toContain('/orders/');
  });
});
