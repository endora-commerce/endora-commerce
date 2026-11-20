import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #1548 (UX audit 2026-11-17, SALES-26) — rejecting a cart was a card of
 * its own that toggled an inline reason form between the lines and the history.
 * It is now an entry of the header's "More" menu (`DetailHeaderActions`) that
 * opens a `ModalDialog` holding the required reason; the result is said by the
 * header's `InlineStatus`, not by a banner, and the screen is three cards.
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

installOffsetParentShim();

const { contributions } = await import('@endora-commerce/mod-carts/admin');
const CartDetail = (await contributions.routes![1]!.component()).default as () => ReactNode;

const CART_ID = '00000000-0000-4000-8000-0000000000c1';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000d1';

const BUNDLE = {
  ...passthroughBundle('carts', [
    'carts.detail.title',
    'carts.detail.lines',
    'carts.detail.audit',
    'carts.detail.auditEmpty',
    'carts.detail.rejectFailed',
    'carts.column.rejectedReason',
    'carts.reject.open',
    'carts.reject.title',
    'carts.reject.message',
    'carts.reject.reasonLabel',
    'carts.reject.reasonPlaceholder',
    'carts.reject.reasonRequired',
    'carts.reject.confirm',
    'carts.reject.cancel',
    'carts.reject.done',
    'carts.audit.actor.platform_admin',
    'carts.loading',
  ]),
  ...passthroughBundle('core', ['common.action.more']),
};

function cartFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CART_ID,
    ownerDisplayName: 'buyer@example.com',
    organizationDisplayName: 'Acme',
    salesChannelCode: 'default',
    status: 'active',
    approvalStatus: 'not_required',
    items: [
      {
        id: '00000000-0000-4000-8000-0000000000e1',
        productId: '00000000-0000-4000-8000-000000000101',
        productName: 'Sample',
        variantId: null,
        quantity: 2,
        unitPrice: { amount: 19.99, currency: 'PLN' },
        lineTotal: { amount: 39.98, currency: 'PLN' },
      },
    ],
    total: { amount: 39.98, currency: 'PLN' },
    discount: null,
    appliedPromotionCode: null,
    lastActivityAt: '2026-05-22T12:00:00Z',
    createdAt: '2026-05-22T11:00:00Z',
    convertedToQuoteRequestId: null,
    submittedForApprovalAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectedByActor: null,
    rejectedReason: null,
    ...overrides,
  };
}

/** The server answers with `cart` until `reject` is posted, and with the rejected cart after. */
function serve(cart: Record<string, unknown>): void {
  postSpy.mockImplementation((_url: string, body: { reason: string }) => {
    cart = { ...cart, status: 'rejected', rejectedByActor: `admin:${ADMIN_ID}`, rejectedReason: body.reason };
    return Promise.resolve({ data: cart });
  });
  getSpy.mockImplementation((url: string) =>
    Promise.resolve({ data: url.endsWith('/audit') ? [] : cart }),
  );
}

function renderDetail(permissions: readonly string[] = ['carts:read', 'carts:reject']): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/carts/${CART_ID}`]}>
        <Routes>
          <Route path="/carts/:id" element={<CartDetail />} />
        </Routes>
      </MemoryRouter>,
      { session: adminSession({ permissions }) },
    ),
    BUNDLE,
  );
}

async function openReject(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderDetail();
  await screen.findByText('Sample');
  await user.click(screen.getByRole('button', { name: 'common.action.more' }));
  await user.click(await screen.findByRole('menuitem', { name: /carts\.reject\.open/ }));
  await screen.findByRole('dialog');
  return user;
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  serve(cartFixture());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CartDetail — rejecting a cart (#1548)', () => {
  it('offers Reject in the header menu, not as a card between the lines and the history', async () => {
    renderDetail();
    await screen.findByText('Sample');
    const header = document.querySelector('header') as HTMLElement;
    expect(within(header).getByRole('button', { name: 'common.action.more' })).toBeInTheDocument();
    // No reason field and no Reject button drawn on the page until the dialog opens.
    expect(screen.queryByLabelText('carts.reject.reasonLabel')).toBeNull();
    expect(screen.queryByRole('button', { name: /carts\.reject\.open/ })).toBeNull();
  });

  it('opens a modal dialog named by its title, with the reason labelled, required and focused', async () => {
    await openReject();
    const dialog = screen.getByRole('dialog', { name: 'carts.reject.title' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('carts.reject.message')).toBeInTheDocument();
    const reason = within(dialog).getByLabelText(/carts\.reject\.reasonLabel/);
    await waitFor(() => expect(reason).toHaveFocus());
    expect(reason).toHaveAttribute('aria-required', 'true');
    expect(reason).toHaveAttribute('maxlength', '2000');
  });

  it('refuses an empty reason with an error linked to the field, and posts nothing', async () => {
    const user = await openReject();
    await user.type(screen.getByLabelText(/carts\.reject\.reasonLabel/), '   ');
    await user.click(screen.getByRole('button', { name: /carts\.reject\.confirm/ }));
    const reason = screen.getByLabelText(/carts\.reject\.reasonLabel/);
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(reason).toHaveAccessibleDescription(/carts\.reject\.reasonRequired/);
    expect(reason).toHaveFocus();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('closes on Escape and returns focus to the "More" menu it was opened from', async () => {
    const user = await openReject();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'common.action.more' })).toHaveFocus();
  });

  it('does not drop a typed reason on a click on the scrim', async () => {
    const user = await openReject();
    await user.type(screen.getByLabelText(/carts\.reject\.reasonLabel/), 'Out of budget');
    const scrim = screen.getByRole('dialog').parentElement as HTMLElement;
    await user.pointer({ keys: '[MouseLeft]', target: scrim });
    expect(screen.getByLabelText(/carts\.reject\.reasonLabel/)).toHaveValue('Out of budget');
  });

  it('posts the trimmed reason, says so in the header status and moves focus to the recorded reason', async () => {
    const user = await openReject();
    await user.type(screen.getByLabelText(/carts\.reject\.reasonLabel/), '  Out of budget ');
    await user.click(screen.getByRole('button', { name: /carts\.reject\.confirm/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/carts/${CART_ID}/reject`, { reason: 'Out of budget' });

    const header = document.querySelector('header') as HTMLElement;
    expect(within(header).getByRole('status')).toHaveTextContent('carts.reject.done');
    // The screen refreshed in place — the lines never gave way to a loading line.
    expect(screen.getByText('Sample')).toBeInTheDocument();
    // The menu's only entry is gone with the cart's new state, so focus lands on what changed.
    expect(screen.queryByRole('button', { name: 'common.action.more' })).toBeNull();
    const recorded = screen.getByTestId('cart-rejection');
    expect(recorded).toHaveTextContent('Out of budget');
    expect(recorded).toHaveFocus();
    // Who rejected it, in words — never `admin:<uuid>`.
    expect(recorded).toHaveTextContent('carts.audit.actor.platform_admin');
    expect(recorded.textContent).not.toContain(ADMIN_ID);
  });

  it('announces a refused rejection inside the dialog and keeps it open with the reason', async () => {
    postSpy.mockRejectedValue(new Error('network'));
    const user = await openReject();
    await user.type(screen.getByLabelText(/carts\.reject\.reasonLabel/), 'Out of budget');
    await user.click(screen.getByRole('button', { name: /carts\.reject\.confirm/ }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('carts.detail.rejectFailed'));
    expect(within(dialog).getByLabelText(/carts\.reject\.reasonLabel/)).toHaveValue('Out of budget');
  });

  it('offers no Reject, and no "More" menu, to an operator without carts:reject', async () => {
    renderDetail(['carts:read']);
    await screen.findByText('Sample');
    expect(screen.queryByRole('button', { name: 'common.action.more' })).toBeNull();
    expect(screen.queryByText('carts.reject.open')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has no axe violations while open', async () => {
    await openReject();
    await expectNoAxeViolations(screen.getByRole('dialog').parentElement as HTMLElement);
  });
});
