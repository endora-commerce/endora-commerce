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
 * Issue #1497 (UX audit SALES-12) — the quote-request header has one primary.
 *
 * It used to be up to five outline buttons — Approve or Prepare basket, Export
 * PDF, Send PDF, Cancel — so the step that moves the request forward looked
 * like housekeeping, and Approve, which locks the agreed prices and tells the
 * customer, ran on one click. Now the next step of each status is the one
 * filled button, the rest is in the kit's "More" menu with Cancel last and set
 * apart, and Approve asks first (Von Restorff, Hick, Fitts).
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
const quote = (key: string): string => {
  const value = QUOTE_EN[key];
  if (value === undefined) throw new Error(`no quote_requests key ${key}`);
  return value;
};

const RFQ_ID = '00000000-0000-4000-8000-0000000000r1';
const VALID_UNTIL = new Date(Date.now() + 30 * 86_400_000).toISOString();

function rfqPayload(status: string): Record<string, unknown> {
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
    items: [],
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
  };
}

function renderDetail(status: string, present: string[] = ['quote_requests', 'document_templates', 'transactional_emails']): void {
  getSpy.mockImplementation((url: string) => {
    if (url === `/api/v1/admin/quote-requests/${RFQ_ID}`) return Promise.resolve({ data: rfqPayload(status) });
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
        presence: modulePresence({ present }),
        contributions: [],
      },
    ),
    { core: CORE_EN, quote_requests: QUOTE_EN },
  );
}

async function header(): Promise<HTMLElement> {
  await screen.findByRole('tablist');
  const group = document.querySelector<HTMLElement>('[data-slot="detail-header-actions"]');
  if (group === null) throw new Error('the quote-request header has no DetailHeaderActions');
  return group;
}

function filled(group: HTMLElement): HTMLElement[] {
  return within(group)
    .queryAllByRole('button')
    .filter((button) => button.className.split(/\s+/).includes('bg-primary'));
}

async function menuEntries(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: core('common.action.more') }));
  return screen.findByRole('menu');
}

const names = (menu: HTMLElement): Array<string | undefined> =>
  within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim());

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
});

describe('RfqDetail — the primary of each status (SALES-12)', () => {
  it.each([
    ['Pending', core('rfq.detail.approve')],
    ['Approved', core('rfq.detail.convert.placeOrder')],
  ])('%s: the next step is the one filled button, last in the header', async (status, primary) => {
    renderDetail(status);
    const group = await header();
    const primaries = filled(group);
    expect(primaries.map((b) => b.textContent?.trim())).toEqual([primary]);
    const buttons = within(group).getAllByRole('button');
    expect(buttons[buttons.length - 1]).toBe(primaries[0]);
  });

  it.each(['Created from admin', 'Completed', 'Canceled', 'Expired'])(
    '%s: no next step, so no primary',
    async (status) => {
      renderDetail(status);
      const group = await header();
      expect(filled(group)).toEqual([]);
    },
  );

  it.each(['Pending', 'Created from admin'])(
    '%s: the PDFs, then Cancel last and set apart, in "More"',
    async (status) => {
      const user = userEvent.setup();
      renderDetail(status);
      await header();
      const menu = await menuEntries(user);
      expect(names(menu)).toEqual([quote('pdf.export'), quote('pdf.send'), core('rfq.detail.cancelRfq')]);
      const separators = within(menu).getAllByRole('separator');
      expect(separators).toHaveLength(1);
      const cancel = within(menu).getByRole('menuitem', { name: core('rfq.detail.cancelRfq') });
      // The separator sits right before Cancel.
      expect(cancel.previousElementSibling).toBe(separators[0]);
      expect(cancel.className).toContain('text-destructive');
    },
  );

  // Approved is closed to Cancel on this screen, as it was before #1497.
  it.each(['Approved', 'Completed', 'Canceled', 'Expired'])('%s: only the PDFs, no Cancel', async (status) => {
    const user = userEvent.setup();
    renderDetail(status);
    await header();
    const menu = await menuEntries(user);
    expect(names(menu)).toEqual([quote('pdf.export'), quote('pdf.send')]);
    expect(within(menu).queryByRole('separator')).toBeNull();
  });

  it('a closed request with the PDFs off has no header actions at all', async () => {
    renderDetail('Completed', ['quote_requests']);
    const group = await header();
    expect(within(group).queryAllByRole('button')).toEqual([]);
    // Only the region an action's result is said in (#1499), empty.
    expect(within(group).getByRole('status').textContent).toBe('');
  });

  it('Cancel opens its dialog from the menu and returns focus to "More"', async () => {
    const user = userEvent.setup();
    renderDetail('Pending');
    await header();
    const menu = await menuEntries(user);
    await user.click(within(menu).getByRole('menuitem', { name: core('rfq.detail.cancelRfq') }));
    const dialog = await screen.findByRole('dialog', { name: core('rfq.detail.cancelDialog.title') });
    await waitFor(() => expect(within(dialog).getByLabelText(core('rfq.detail.cancelReason'))).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: core('common.action.more') })).toHaveFocus();
  });
});

describe('RfqDetail — Approve asks first (SALES-12)', () => {
  it('says what approving does and sends nothing when declined', async () => {
    const user = userEvent.setup();
    renderDetail('Pending');
    await user.click(await screen.findByRole('button', { name: core('rfq.detail.approve') }));
    const dialog = await answerConfirm(false);
    expect(dialog).toHaveTextContent(core('rfq.detail.approveConfirm.message'));
    expect(postSpy).not.toHaveBeenCalledWith(
      `/api/v1/admin/quote-requests/${RFQ_ID}/approve`,
      expect.anything(),
      expect.anything(),
    );
  });

  it('approves once confirmed, holding the header while it runs', async () => {
    let release!: (value: unknown) => void;
    postSpy.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const user = userEvent.setup();
    renderDetail('Pending');
    const approve = await screen.findByRole('button', { name: core('rfq.detail.approve') });
    await user.click(approve);
    await answerConfirm(true);

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        `/api/v1/admin/quote-requests/${RFQ_ID}/approve`,
        {},
        { headers: { 'If-Match': '"7"' } },
      ),
    );
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('aria-busy', 'true');
    const more = screen.getByRole('button', { name: core('common.action.more') });
    // Held, but the spinner is on the control that is working, not on the menu.
    expect(more).toBeDisabled();
    expect(more).not.toHaveAttribute('aria-busy');

    release({});
    await waitFor(() => expect(screen.getByText(core('rfq.detail.info.approved'))).toBeInTheDocument());
  });
});
