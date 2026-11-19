import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — the quote-request
 * screen stacked up to six banners above its tabs: an error, the last action's
 * success, the PDF outcome, the cancellation reason, the lapsed deadline and
 * the unsaved draft. Each competed with the others (Von Restorff), and the
 * results sat far from the buttons that caused them (Proximity).
 *
 * Now an action's result is said beside its button, in an always-mounted
 * polite region; the cancellation reason is part of the header's meta line;
 * and at most one banner is left above the tabs, chosen by priority.
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
const { rfqPageNotice } = await import('../../../../packages/modules/quote_requests/src/admin/pages/rfq-page-notice');

function bundle(module: string): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/${module}/i18n/en.json`), 'utf8'),
  ) as Record<string, string>;
}
const CORE_EN = bundle('_i18n');
const QUOTE_EN = bundle('quote_requests');
const core = (key: string, values: Record<string, string> = {}): string => {
  const value = CORE_EN[key];
  if (value === undefined) throw new Error(`no core key ${key}`);
  return Object.entries(values).reduce((text, [name, v]) => text.replace(`{${name}}`, v), value);
};

const RFQ_ID = '00000000-0000-4000-8000-0000000000r1';
const VALID_UNTIL = new Date(Date.now() + 30 * 86_400_000).toISOString();
const LAPSED_AT = '2026-01-01T00:00:00.000Z';

function rfqPayload(status: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RFQ_ID,
    businessId: 'RFQ-0001',
    organizationId: '00000000-0000-4000-8000-0000000000a1',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    organization: null,
    customer: null,
    createdByAdminUserId: null,
    assignedAdminUserId: null,
    status,
    awaitingCustomerRevisionAcceptance: false,
    currentRevisionNumber: 1,
    headerNote: null,
    cancellationReason: null,
    customFieldValues: {},
    items: [
      {
        id: '00000000-0000-4000-8000-0000000000i1',
        productId: '00000000-0000-4000-8000-0000000000p1',
        productName: 'Widget',
        productSlug: 'widget',
        variantLabel: null,
        quantity: 5,
        desiredUnitPrice: 9.5,
        agreedUnitPrice: 9,
        lineNote: null,
        lineCurrency: 'PLN',
        discountPercent: null,
      },
    ],
    events: [],
    submittedAt: '2026-08-01T10:00:00.000Z',
    approvedAt: null,
    canceledAt: null,
    completedAt: null,
    expiredAt: null,
    expiresAt: VALID_UNTIL,
    convertedOrderId: null,
    taxRate: 0,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    version: 7,
    ...overrides,
  };
}

function renderDetail(status: string, overrides: Record<string, unknown> = {}): void {
  getSpy.mockImplementation((url: string) => {
    if (url === `/api/v1/admin/quote-requests/${RFQ_ID}`) return Promise.resolve({ data: rfqPayload(status, overrides) });
    return Promise.resolve({ data: [] });
  });
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/quote-requests/${RFQ_ID}`]}>
        <Routes>
          <Route path="/quote-requests/:id" element={<RfqDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['rfqs:handle'] }),
        presence: modulePresence({ present: ['quote_requests', 'document_templates', 'transactional_emails'] }),
        contributions: [],
      },
    ),
    { core: CORE_EN, quote_requests: QUOTE_EN },
  );
}

const banners = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-slot="alert"]'));

async function headerStatus(): Promise<HTMLElement> {
  await screen.findByRole('tablist');
  const group = document.querySelector<HTMLElement>('[data-slot="detail-header-actions"]');
  if (group === null) throw new Error('the quote-request header has no DetailHeaderActions');
  return within(group).getByRole('status');
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('RfqDetail — a header action says its result beside its buttons (DEC-12 a)', () => {
  it('mounts the result region empty, before there is anything to say', async () => {
    renderDetail('Pending');
    expect((await headerStatus()).textContent).toBe('');
  });

  it('says "approved" in the header region, not in a success banner above the tabs', async () => {
    postSpy.mockResolvedValue({ data: {} });
    const user = userEvent.setup();
    renderDetail('Pending');
    const region = await headerStatus();
    await user.click(await screen.findByRole('button', { name: core('rfq.detail.approve') }));
    await answerConfirm(true);
    await waitFor(() => expect(region).toHaveTextContent(core('rfq.detail.info.approved')));
    expect(banners()).toEqual([]);
  });

  it('says a copied number in the same header region', async () => {
    const user = userEvent.setup();
    renderDetail('Pending');
    const region = await headerStatus();
    await user.click(screen.getByRole('button', { name: core('rfq.detail.title', { id: 'RFQ-0001' }) }));
    await waitFor(() => expect(region).toHaveTextContent(core('rfq.detail.copied', { id: 'RFQ-0001' })));
    expect(banners()).toEqual([]);
  });
});

describe('RfqDetail — the cancellation reason is part of the header, not a banner', () => {
  it('reads the reason in the meta line under the title', async () => {
    renderDetail('Canceled', { cancellationReason: 'Out of stock' });
    await screen.findByRole('tablist');
    const meta = document.querySelector('header p')?.textContent ?? '';
    expect(meta).toContain(core('rfq.detail.badge.cancelReason', { reason: 'Out of stock' }));
    expect(banners()).toEqual([]);
  });
});

describe('RfqDetail — at most one banner above the tabs', () => {
  it('a lapsed deadline and an unsaved draft: the deadline is the one banner; the draft is still explained', async () => {
    const user = userEvent.setup();
    renderDetail('Pending', { expiresAt: LAPSED_AT });
    await user.click(await screen.findByRole('tab', { name: new RegExp(core('rfq.detail.tabs.modify')) }));
    const input = (await screen.findByRole('spinbutton', {
      name: core('rfq.detail.modify.agreedUnitPrice'),
    })) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '8');
    await user.click(screen.getByRole('tab', { name: core('rfq.detail.tabs.overview') }));

    await waitFor(() => expect(banners()).toHaveLength(1));
    expect(banners()[0]).toHaveTextContent(core('rfq.detail.validity.lapsed.setNewDeadline'));
    // The disabled Approve still says why, though the draft has no banner of its own now.
    const approve = screen.getByRole('button', { name: core('rfq.detail.approve') });
    expect(approve).toHaveAccessibleDescription(core('rfq.detail.modify.unsaved.blocked'));
  });

  it('on the Modify tab the draft has no banner: the save bar already says "Unsaved changes"', async () => {
    const user = userEvent.setup();
    renderDetail('Pending');
    await user.click(await screen.findByRole('tab', { name: new RegExp(core('rfq.detail.tabs.modify')) }));
    const input = (await screen.findByRole('spinbutton', {
      name: core('rfq.detail.modify.agreedUnitPrice'),
    })) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '8');
    await waitFor(() => expect(screen.getByRole('button', { name: core('rfq.detail.approve') })).toBeDisabled());
    expect(banners()).toEqual([]);
  });

  it('the lapsed banner is a headline, one sentence and its button', async () => {
    renderDetail('Pending', { expiresAt: LAPSED_AT });
    await screen.findByRole('tablist');
    const [banner] = banners();
    expect(banner).toHaveTextContent(core('rfq.detail.validity.lapsed.remedyEditable'));
    expect(core('rfq.detail.validity.lapsed.remedyEditable').length).toBeLessThanOrEqual(80);
    expect(core('rfq.detail.validity.lapsed.remedyLocked').length).toBeLessThanOrEqual(80);
  });
});

describe('rfqPageNotice — which one banner the screen shows', () => {
  const none = { error: false, validityLapsed: false, draftOpen: false, onModifyTab: false };
  it('is nothing when there is nothing to say', () => {
    expect(rfqPageNotice(none)).toBeNull();
  });
  it('an error wins over every standing state', () => {
    expect(rfqPageNotice({ error: true, validityLapsed: true, draftOpen: true, onModifyTab: false })).toBe('error');
  });
  it('a lapsed deadline wins over an unsaved draft', () => {
    expect(rfqPageNotice({ ...none, validityLapsed: true, draftOpen: true })).toBe('validity');
  });
  it('an unsaved draft is a banner only away from the Modify tab', () => {
    expect(rfqPageNotice({ ...none, draftOpen: true })).toBe('draft');
    expect(rfqPageNotice({ ...none, draftOpen: true, onModifyTab: true })).toBeNull();
  });
});
