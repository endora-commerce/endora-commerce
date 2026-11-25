import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `specs/192-quote-request-draft-share/` T034 (US2; FR-007, FR-009, FR-020,
 * FR-026, FR-027, FR-028) — the quote an operator has not shared yet: it says
 * so beside its status, its next step is *Share with customer*, the share is
 * asked first and names who is told and the validity it writes, and every
 * refusal the route answers is said in words the operator can act on.
 *
 * The bundles are the shipped English ones, so a missing key fails.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null, ProductPicker: () => null };
});

const { RfqDetail } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqDetail');

function bundle(module: string): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/${module}/i18n/en.json`), 'utf8'),
  ) as Record<string, string>;
}
const CORE_EN = bundle('_i18n');
const QUOTE_EN = bundle('quote_requests');
const core = (key: string): string => {
  const value = CORE_EN[key];
  if (value === undefined) throw new Error(`no core key ${key}`);
  return value;
};
const quote = (key: string, params: Record<string, string | number> = {}): string => {
  const value = QUOTE_EN[key];
  if (value === undefined) throw new Error(`no quote_requests key ${key}`);
  return value.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? `{${name}}`));
};

const RFQ_ID = '00000000-0000-4000-8000-0000000000r1';
const SHARE_URL = `/api/v1/admin/quote-requests/${RFQ_ID}/share`;

interface Overrides {
  sharedWithCustomer?: boolean;
  shareValidityDays?: number | null;
  sharedAt?: string | null;
  expiresAt?: string | null;
  version?: number;
}

function rfqPayload(overrides: Overrides = {}): Record<string, unknown> {
  const shared = overrides.sharedWithCustomer ?? false;
  return {
    id: RFQ_ID,
    businessId: 'RFQ-0001',
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    organization: null,
    customer: { id: '00000000-0000-4000-8000-0000000000c1', firstName: 'Anna', lastName: 'Nowak', email: 'anna@example.test' },
    createdByAdminUserId: '00000000-0000-4000-8000-0000000000u1',
    assignedAdminUserId: null,
    status: 'Created from admin',
    awaitingCustomerRevisionAcceptance: true,
    currentRevisionNumber: 1,
    headerNote: null,
    cancellationReason: null,
    customFieldValues: {},
    items: [],
    events: [],
    submittedAt: null,
    approvedAt: null,
    canceledAt: null,
    completedAt: null,
    expiredAt: null,
    expiresAt: overrides.expiresAt ?? null,
    convertedOrderId: null,
    sharedWithCustomer: shared,
    sharedAt: overrides.sharedAt ?? null,
    shareValidityDays: shared ? null : overrides.shareValidityDays ?? null,
    taxRate: 0,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
    version: overrides.version ?? 7,
  };
}

/** Each read of the quote answers the next payload; the last one repeats. */
function serve(...payloads: Array<Record<string, unknown>>): void {
  const queue = [...payloads];
  getSpy.mockImplementation((url: string) => {
    if (url === `/api/v1/admin/quote-requests/${RFQ_ID}`) {
      const next = queue.length > 1 ? queue.shift()! : queue[0]!;
      return Promise.resolve({ data: next });
    }
    return Promise.resolve({ data: [] });
  });
}

function renderDetail(
  present: string[] = ['quote_requests', 'document_templates', 'transactional_emails'],
  state?: unknown,
): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[{ pathname: `/quote-requests/${RFQ_ID}`, state }]}>
        <Routes>
          <Route path="/quote-requests/:id" element={<RfqDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['rfqs:handle'] }),
        presence: modulePresence({ present }),
        contributions: [],
      },
    ),
    { core: CORE_EN, quote_requests: QUOTE_EN },
  );
}

function refusal(status: number, code: string, message: string, details?: unknown): ApiError {
  return new ApiError(status, { error: { code, message, ...(details !== undefined ? { details } : {}) } } as never);
}

async function shareButton(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: quote('share.action') });
}

function pageAlert(): HTMLElement {
  const alert = document.querySelector<HTMLElement>('[data-slot="alert"]');
  if (alert === null) throw new Error('no banner above the tabs');
  return alert;
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('RfqDetail — a quote not shared yet (specs/192-quote-request-draft-share/)', () => {
  it('says it is a draft beside its status, and offers sharing as its one next step', async () => {
    serve(rfqPayload({ shareValidityDays: 30 }));
    renderDetail();

    const button = await shareButton();
    expect(screen.getByText(quote('share.badge.unshared'))).toBeInTheDocument();
    // The one filled action of the header (Von Restorff).
    expect(button.className.split(/\s+/)).toContain('bg-primary');
    const meta = document.querySelector('header p')?.textContent ?? '';
    expect(meta).toContain(quote('share.meta.unshared'));
    expect(meta).toContain(quote('share.meta.validityDays.other', { days: 30 }));
    // Not awaiting a customer who cannot see it yet.
    expect(screen.queryByText(core('rfq.detail.badge.awaitingRevision'))).not.toBeInTheDocument();
  });

  it('keeps the PDF export but offers no send to the customer while unshared (FR-007)', async () => {
    const user = userEvent.setup();
    serve(rfqPayload());
    renderDetail();

    await shareButton();
    await user.click(screen.getByRole('button', { name: core('common.action.more') }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: quote('pdf.export') })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: quote('pdf.send') })).not.toBeInTheDocument();
  });

  it('asks first, naming the customer and the validity the share writes; No sends nothing', async () => {
    const user = userEvent.setup();
    serve(rfqPayload({ shareValidityDays: 30 }));
    renderDetail();

    await user.click(await shareButton());
    const dialog = await answerConfirm(false);
    expect(dialog).toHaveTextContent('Anna Nowak');
    expect(dialog).toHaveTextContent('valid for 30 days');
    expect(dialog).toHaveTextContent('cannot return to draft');
    expect(postSpy).not.toHaveBeenCalledWith(SHARE_URL, expect.anything(), expect.anything());
  });

  it('says one day in the singular, in the meta line and the question', async () => {
    const user = userEvent.setup();
    serve(rfqPayload({ shareValidityDays: 1 }));
    renderDetail();

    await user.click(await shareButton());
    expect(document.querySelector('header p')?.textContent ?? '').toContain('valid 1 day from sharing');
    const dialog = await answerConfirm(false);
    expect(dialog).toHaveTextContent('valid for 1 day, until');
  });

  it('says no deadline in the question when the quote carries no days', async () => {
    const user = userEvent.setup();
    serve(rfqPayload({ shareValidityDays: null }));
    renderDetail();

    await user.click(await shareButton());
    const dialog = await answerConfirm(false);
    expect(dialog).toHaveTextContent(quote('share.confirm.validityNone'));
  });

  it('shares with If-Match and then shows the shared quote, without the action (US2 #3)', async () => {
    const user = userEvent.setup();
    const sharedAt = '2026-11-25T09:00:00.000Z';
    serve(rfqPayload({ shareValidityDays: 30 }), rfqPayload({ sharedWithCustomer: true, sharedAt, version: 8 }));
    postSpy.mockResolvedValue({ data: rfqPayload({ sharedWithCustomer: true, sharedAt, version: 8 }) });
    renderDetail();

    await user.click(await shareButton());
    await answerConfirm(true);

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(SHARE_URL, {}, { headers: { 'If-Match': '"7"' } }));
    expect(await screen.findByText(quote('share.success'))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: quote('share.action') })).not.toBeInTheDocument());
    expect(screen.queryByText(quote('share.badge.unshared'))).not.toBeInTheDocument();
    expect(document.querySelector('header p')?.textContent ?? '').toMatch(/shared /);
  });

  it('says in Modify that a save tells the customer nothing while unshared', async () => {
    const user = userEvent.setup();
    serve(rfqPayload({ shareValidityDays: 30 }));
    renderDetail();

    await user.click(await screen.findByRole('tab', { name: core('rfq.detail.tabs.modify') }));
    expect(await screen.findByText(quote('share.modify.note'))).toBeInTheDocument();
    expect(screen.queryByText(core('rfq.detail.modify.notifiesCustomer'))).not.toBeInTheDocument();
  });

  it('starts Modify again from the shared quote once shared: its days are not left behind as a change', async () => {
    const user = userEvent.setup();
    serve(
      rfqPayload({ shareValidityDays: 30 }),
      rfqPayload({ sharedWithCustomer: true, sharedAt: '2026-11-25T09:00:00.000Z', expiresAt: '2026-12-25T09:00:00.000Z', version: 8 }),
    );
    postSpy.mockImplementation((url: string) =>
      Promise.resolve(url === SHARE_URL ? { data: {} } : { data: [] }),
    );
    renderDetail();

    // Modify opened on the unshared quote, holding its 30 days, then left.
    await user.click(await screen.findByRole('tab', { name: core('rfq.detail.tabs.modify') }));
    expect(screen.getByLabelText(quote('validity.unshared.field'))).toHaveValue(30);
    await user.click(screen.getByRole('tab', { name: core('rfq.detail.tabs.overview') }));

    await user.click(await shareButton());
    await answerConfirm(true);
    await screen.findByText(quote('share.success'));
    await waitFor(() => expect(screen.queryByRole('button', { name: quote('share.action') })).not.toBeInTheDocument());

    await user.click(screen.getByRole('tab', { name: core('rfq.detail.tabs.modify') }));
    const field = screen.getByLabelText(core('rfq.detail.validity.field'));
    expect(field).toHaveValue(null);
    expect(screen.getByText(core('rfq.detail.modify.notifiesCustomer'))).toBeInTheDocument();
    expect(screen.queryByText(core('rfq.detail.tabs.modifyUnsaved'))).not.toBeInTheDocument();
    expect(screen.queryByText(core('form.unsavedChanges.hint'))).not.toBeInTheDocument();
  });

  it('names the unpriced lines when the share is refused for them (FR-026)', async () => {
    const user = userEvent.setup();
    serve(rfqPayload());
    postSpy.mockRejectedValue(
      refusal(409, 'QUOTE_INCOMPLETE', 'This quote cannot be shared yet: some lines have no agreed price.', {
        code: 'share',
        lines: [
          { id: 'l1', position: 0, productName: 'Steel beam', variantLabel: null, groupName: 'Hall A' },
          { id: 'l2', position: 1, productName: 'Bolt', variantLabel: 'M8', groupName: null },
        ],
      }),
    );
    renderDetail();

    await user.click(await shareButton());
    await answerConfirm(true);

    await waitFor(() => expect(pageAlert()).toHaveTextContent('some lines have no agreed price'));
    const items = within(pageAlert()).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      quote('share.refusal.lineInGroup', { line: 'Steel beam', group: 'Hall A' }),
      quote('share.refusal.lineVariant', { product: 'Bolt', variant: 'M8' }),
    ]);
    // Still a draft, still shareable once priced.
    expect(screen.getByRole('button', { name: quote('share.action') })).toBeEnabled();
  });

  it.each([
    ['not_member', "its customer's account no longer belongs to the quote's organization"],
    ['inactive', "its customer's account is inactive"],
    ['blocked', "its customer's account is blocked"],
  ])('says why the customer cannot receive it (%s, FR-027)', async (token, sentence) => {
    const user = userEvent.setup();
    serve(rfqPayload());
    postSpy.mockRejectedValue(
      refusal(409, 'RFQ_SHARE_CUSTOMER_UNAVAILABLE', `This quote cannot be shared: ${sentence}.`, { code: token }),
    );
    renderDetail();

    await user.click(await shareButton());
    await answerConfirm(true);

    await waitFor(() => expect(pageAlert()).toHaveTextContent(sentence));
    expect(pageAlert()).not.toHaveTextContent('RFQ_SHARE_CUSTOMER_UNAVAILABLE');
  });

  it("shows another module's refusal in that module's words (FR-028)", async () => {
    const user = userEvent.setup();
    serve(rfqPayload());
    postSpy.mockRejectedValue(refusal(409, 'APPROVAL_PENDING', 'A manager has to approve this discount first.'));
    renderDetail();

    await user.click(await shareButton());
    await answerConfirm(true);

    await waitFor(() => expect(pageAlert()).toHaveTextContent('A manager has to approve this discount first.'));
  });

  it('catches up with an info notice when somebody else shared it meanwhile', async () => {
    const user = userEvent.setup();
    serve(rfqPayload(), rfqPayload({ sharedWithCustomer: true, sharedAt: '2026-11-25T09:00:00.000Z', version: 8 }));
    postSpy.mockRejectedValue(refusal(409, 'RFQ_ALREADY_SHARED', 'This quote is already shared with the customer.'));
    renderDetail();

    await user.click(await shareButton());
    await answerConfirm(true);

    expect(await screen.findByText('This quote is already shared with the customer.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: quote('share.action') })).not.toBeInTheDocument());
    // News, not an error: no destructive banner above the tabs.
    expect(document.querySelector('[data-slot="alert"]')).toBeNull();
  });

  it('re-reads the quote on a version conflict and says so', async () => {
    const user = userEvent.setup();
    serve(rfqPayload({ version: 7 }), rfqPayload({ version: 9 }));
    postSpy.mockRejectedValueOnce(refusal(409, 'VERSION_CONFLICT', 'Someone else changed this quote. Review it and try again.'));
    renderDetail();

    await user.click(await shareButton());
    await answerConfirm(true);

    await waitFor(() => expect(pageAlert()).toHaveTextContent('Someone else changed this quote.'));
    expect(getSpy.mock.calls.filter(([url]) => url === `/api/v1/admin/quote-requests/${RFQ_ID}`).length).toBeGreaterThanOrEqual(2);

    // The next try carries the version just read.
    postSpy.mockResolvedValueOnce({ data: rfqPayload({ sharedWithCustomer: true, version: 10 }) });
    await user.click(screen.getByRole('button', { name: quote('share.action') }));
    await answerConfirm(true);
    await waitFor(() => expect(postSpy).toHaveBeenLastCalledWith(SHARE_URL, {}, { headers: { 'If-Match': '"9"' } }));
  });

  it('says a failure that is not a refusal in its own words', async () => {
    const user = userEvent.setup();
    serve(rfqPayload());
    postSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    renderDetail();

    await user.click(await shareButton());
    await answerConfirm(true);

    await waitFor(() => expect(pageAlert()).toHaveTextContent(quote('share.error')));
  });

  it('shows the refusal *Create and share* carried here, once (FR-020)', async () => {
    serve(rfqPayload());
    renderDetail(undefined, {
      shareRefusal: { code: 'RFQ_SHARE_CUSTOMER_UNAVAILABLE', message: "This quote cannot be shared: its customer's account is blocked.", lines: [] },
    });

    await shareButton();
    expect(pageAlert()).toHaveTextContent("its customer's account is blocked");
    // Not flagged as following a create: no lead line.
    expect(pageAlert()).not.toHaveTextContent(quote('share.refusal.afterCreate'));
  });

  it('says first that the quote was created as a draft when *Create and share* was refused', async () => {
    serve(rfqPayload());
    renderDetail(undefined, {
      shareRefusal: { code: 'RFQ_SHARE_CUSTOMER_UNAVAILABLE', message: "This quote cannot be shared: its customer's account is blocked.", lines: [] },
      afterCreate: true,
    });

    await shareButton();
    const paragraphs = Array.from(pageAlert().querySelectorAll('p')).map((p) => p.textContent);
    expect(paragraphs.slice(0, 2)).toEqual([
      quote('share.refusal.afterCreate'),
      "This quote cannot be shared: its customer's account is blocked.",
    ]);
  });

  it('a share refused on the detail itself has no "created as a draft" lead line', async () => {
    const user = userEvent.setup();
    serve(rfqPayload());
    renderDetail(undefined, {
      shareRefusal: { code: 'RFQ_SHARE_CUSTOMER_UNAVAILABLE', message: 'Blocked earlier.', lines: [] },
      afterCreate: true,
    });
    await shareButton();
    postSpy.mockRejectedValue(refusal(409, 'APPROVAL_PENDING', 'A manager has to approve this discount first.'));

    await user.click(await shareButton());
    await answerConfirm(true);

    await waitFor(() => expect(pageAlert()).toHaveTextContent('A manager has to approve this discount first.'));
    expect(pageAlert()).not.toHaveTextContent(quote('share.refusal.afterCreate'));
  });
});

describe('RfqDetail — a shared quote (specs/192-quote-request-draft-share/)', () => {
  it.each([
    ['shared', rfqPayload({ sharedWithCustomer: true, sharedAt: '2026-11-25T09:00:00.000Z' })],
    // A reply without the key predates the feature: the customer already sees that quote (FR-002).
    ['without the key', (() => {
      const payload = rfqPayload({ sharedWithCustomer: true });
      delete payload['sharedWithCustomer'];
      return payload;
    })()],
  ])('%s: no badge, no share action, and the PDF can be sent', async (_label, payload) => {
    const user = userEvent.setup();
    serve(payload);
    renderDetail();

    await screen.findByRole('tablist');
    expect(screen.queryByText(quote('share.badge.unshared'))).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: quote('share.action') })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: core('common.action.more') }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: quote('pdf.send') })).toBeInTheDocument();
  });
});
