import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ComparisonOwnerView } from '@endora-commerce/contracts';
import { tForLocale } from '../../lib/i18n/messages';
import { commerceAbilities, VISITOR_ABILITIES, type CommerceAbilities } from '../../lib/commerce-permissions';
import { CompareActionCell } from '../../components/ComparisonTable';
import { RfqDetailActions } from '../../components/rfq/RfqDetailActions';
import { DraftSubmitButton, strings as draftStrings } from '../../components/rfq/RfqDraftView';
import { rfqValidity, rfqValidityGate } from '../../lib/quote-requests/validity';

/**
 * `specs/170-organization-roles/` T100 follow-up (FR-030, FR-040, FR-057) — the three commerce
 * surfaces the first pass left: the comparison's add-to-cart and the quote-request detail's
 * "place order" (both fill the basket, `carts.create`), and the quote-request draft's submit
 * (`quote_requests.create`). Each is asserted on the unit that renders the control, and each
 * page is asserted to hand that unit the member's ability. The rule itself, and the visitor's
 * flags (PR-4), are `permission-aware-actions.test.tsx`'s.
 */

const en = tForLocale('en-US');

let abilities: CommerceAbilities = VISITOR_ABILITIES;

vi.mock('../../lib/actions/cart', () => ({
  getCommerceAbilitiesAction: async () => abilities,
}));
vi.mock('../../lib/session', () => ({ getSessionCookie: async () => 'session' }));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale: 'en-US', ctx: { salesChannelCode: 'web' }, modules: [] }),
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  useRouter: () => ({ push: () => undefined }),
}));

// The pages' units are replaced by probes that print the prop under test.
vi.mock('../../components/ComparisonTable', async () => {
  const actual = await vi.importActual<typeof import('../../components/ComparisonTable')>(
    '../../components/ComparisonTable',
  );
  return {
    ...actual,
    ComparisonTable: (props: { canAddToCart?: boolean }) => <i data-can-add-to-cart={String(props.canAddToCart)} />,
  };
});
vi.mock('../../components/rfq/RfqDraftView', async () => {
  const actual = await vi.importActual<typeof import('../../components/rfq/RfqDraftView')>(
    '../../components/rfq/RfqDraftView',
  );
  return {
    ...actual,
    RfqDraftView: (props: { canSubmit?: boolean }) => <i data-can-submit={String(props.canSubmit)} />,
  };
});
vi.mock('../../lib/api/rfq', () => ({
  getQuoteRequestNegotiation: async () => true,
  getRfqById: async () => ({
    id: 'rfq-1',
    businessId: 'RFQ-1',
    organizationId: 'org-1',
    customerAccountId: 'member-1',
    status: 'Approved',
    awaitingCustomerRevisionAcceptance: false,
    currentRevisionNumber: 1,
    lastCustomerSeenRevisionNumber: 1,
    headerNote: null,
    cancellationReason: null,
    items: [],
    events: [],
    comparisonAgainstLastSeen: null,
    submittedAt: null,
    approvedAt: null,
    canceledAt: null,
    completedAt: null,
    expiredAt: null,
    expiresAt: null,
    convertedOrderId: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    version: 1,
  }),
  acceptRevision: async () => undefined,
  rejectRevision: async () => undefined,
  convertRfqToOrder: async () => ({ checkoutUrl: '/checkout' }),
  resubmitRfq: async () => ({}),
}));

const { default: ComparePage } = await import('../../app/compare/page');
const { default: QuoteRequestDraftPage } = await import('../../app/(commerce)/quote-request/page');
const { default: QuoteRequestDetailPage } = await import('../../app/(account)/quote-requests/[id]/page');

function html(node: unknown): string {
  return renderToString(<>{node as React.ReactNode}</>).replaceAll('<!-- -->', '');
}

const noCart = commerceAbilities({ permissions: ['quote_requests.create'] });
const noQuote = commerceAbilities({ permissions: ['carts.create'] });

beforeEach(() => {
  abilities = VISITOR_ABILITIES;
});

// ── compare ───────────────────────────────────────────────────────────────

describe('comparison — add-to-cart needs `carts.create`', () => {
  const product = { id: 'p1', slug: 'bolt', available: true, minOrderQuantity: null } as unknown as
    ComparisonOwnerView['products'][number];
  const addLabel = `>${en('product.addToCart')}<`;

  it('the action cell offers add-to-cart by default and drops it when not allowed', () => {
    expect(html(<CompareActionCell product={product} canAddToCart locale="en-US" />)).toContain(addLabel);
    const out = html(<CompareActionCell product={product} canAddToCart={false} locale="en-US" />);
    expect(out).not.toContain(addLabel);
    // The way to the product page stays.
    expect(out).toContain('href="/p/bolt"');
  });

  it('the page hands the table the member’s ability, and a visitor keeps it (PR-4)', async () => {
    expect(html(await ComparePage())).toContain('data-can-add-to-cart="true"');
    abilities = noCart;
    expect(html(await ComparePage())).toContain('data-can-add-to-cart="false"');
  });
});

// ── quote-request detail ──────────────────────────────────────────────────

describe('quote-request detail — "place order" needs `carts.create`', () => {
  const placeOrder = en('quoteRequests.actions.placeOrder');
  const render = (canConvert?: boolean): string =>
    html(
      <RfqDetailActions
        rfqId="rfq-1"
        status="Approved"
        currentRevisionNumber={1}
        awaitingCustomerRevisionAcceptance={false}
        gate={rfqValidityGate({
          status: 'Approved',
          awaitingCustomerRevisionAcceptance: false,
          validity: rfqValidity(null, new Date()),
        })}
        locale="en-US"
        acceptAction={async () => undefined}
        rejectAction={async () => undefined}
        convertAction={async () => undefined}
        resubmitAction={async () => undefined}
        {...(canConvert === undefined ? {} : { canConvert })}
      />,
    );

  it('offers it by default and drops it when not allowed', () => {
    expect(render()).toContain(placeOrder);
    expect(render(false)).not.toContain(placeOrder);
  });

  it('the page passes the member’s `carts.create`', async () => {
    const page = async (): Promise<string> =>
      html(await QuoteRequestDetailPage({ params: Promise.resolve({ id: '00000000-0000-4000-8000-0000000000a1' }), searchParams: Promise.resolve({}) }));
    expect(await page()).toContain(placeOrder);
    abilities = noCart;
    expect(await page()).not.toContain(placeOrder);
  });
});

describe('quote-request detail — "resubmit" needs `quote_requests.create` (FR-040)', () => {
  const resubmit = `>${en('quoteRequests.resubmit')}</button>`;
  const render = (canResubmit?: boolean): string =>
    html(
      <RfqDetailActions
        rfqId="rfq-1"
        status="Approved"
        currentRevisionNumber={1}
        awaitingCustomerRevisionAcceptance={false}
        gate={rfqValidityGate({
          status: 'Approved',
          awaitingCustomerRevisionAcceptance: false,
          validity: rfqValidity(null, new Date()),
        })}
        locale="en-US"
        acceptAction={async () => undefined}
        rejectAction={async () => undefined}
        convertAction={async () => undefined}
        resubmitAction={async () => undefined}
        {...(canResubmit === undefined ? {} : { canResubmit })}
      />,
    );

  it('offers it by default and drops it when not allowed', () => {
    expect(render()).toContain(resubmit);
    expect(render(false)).not.toContain(resubmit);
  });

  it('the page passes the member’s `quote_requests.create`', async () => {
    const page = async (): Promise<string> =>
      html(await QuoteRequestDetailPage({ params: Promise.resolve({ id: '00000000-0000-4000-8000-0000000000a1' }), searchParams: Promise.resolve({}) }));
    expect(await page()).toContain(resubmit);
    abilities = noQuote;
    expect(await page()).not.toContain(resubmit);
  });
});

// ── quote-request draft ───────────────────────────────────────────────────

describe('quote-request draft — submitting needs `quote_requests.create`', () => {
  const t = draftStrings('en-US');

  it('the submit is a working button by default', () => {
    const out = html(<DraftSubmitButton t={t} canSubmit submitting={false} onSubmit={() => undefined} />);
    expect(out).toContain(t.submit);
    expect(out).not.toContain('disabled');
  });

  it('is disabled with the reason beside it when not allowed', () => {
    const out = html(<DraftSubmitButton t={t} canSubmit={false} submitting={false} onSubmit={() => undefined} />);
    expect(out).toContain(t.submit);
    expect(out).toMatch(/<button[^>]*disabled/);
    const ref = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(ref).toBeDefined();
    expect(out).toContain(`id="${ref}"`);
    expect(out).toContain(en('commerce.rfqDraft.submitNotAllowed'));
  });

  it('ships the reason in EN and PL', () => {
    expect(tForLocale('pl-PL')('commerce.rfqDraft.submitNotAllowed')).not.toBe(en('commerce.rfqDraft.submitNotAllowed'));
  });

  it('the page passes the member’s `quote_requests.create`, and a visitor keeps the submit', async () => {
    expect(html(await QuoteRequestDraftPage())).toContain('data-can-submit="true"');
    abilities = noQuote;
    expect(html(await QuoteRequestDraftPage())).toContain('data-can-submit="false"');
  });
});
