import { StrictMode, useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../../helpers/axe';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #1474 (SALES-09) — the bulk order-status dialog is the kit's
 * `ModalDialog`, not a hand-drawn overlay: it is named by its title, holds
 * focus, closes on Escape and gives focus back to *Change status*; a failure is
 * announced inside the dialog; and Escape is inert while the request runs.
 */

installOffsetParentShim();

const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: (...args: unknown[]) => postSpy(...args), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { OrdersBulkStatusDialog } = await import(
  '../../../../packages/modules/orders/src/admin/components/OrdersBulkStatusDialog'
);

const BUNDLE = {
  core: {
    ...passthroughBundle('core', ['common.action.cancel', 'orders.bulk.apply', 'orders.bulk.targetStatus', 'orders.bulk.error'])['core'],
    'orders.bulk.dialogTitle': 'Change status for {count} orders',
  },
};

const STATUSES = [
  { code: 'pending', name: { en: 'Pending' } },
  { code: 'shipped', name: { en: 'Shipped' } },
];

function Harness(props: { onDone?: () => void }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={(): void => setOpen(true)}>
        Change status
      </button>
      <OrdersBulkStatusDialog
        open={open}
        orderIds={['o1', 'o2']}
        statuses={STATUSES}
        onClose={(): void => setOpen(false)}
        onDone={(): void => {
          props.onDone?.();
          setOpen(false);
        }}
      />
    </>
  );
}

async function openDialog(props: { onDone?: () => void } = {}): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithI18n(
    <StrictMode>
      <Harness {...props} />
    </StrictMode>,
    BUNDLE,
  );
  await user.click(screen.getByRole('button', { name: 'Change status' }));
  return user;
}

beforeEach(() => {
  postSpy.mockReset();
});

describe('OrdersBulkStatusDialog (#1474)', () => {
  it('is a modal dialog named by its title, opening on the status select', async () => {
    await openDialog();
    const dialog = screen.getByRole('dialog', { name: 'Change status for 2 orders' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByLabelText('orders.bulk.targetStatus')).toHaveFocus();
  });

  it('keeps Tab inside the dialog', async () => {
    const user = await openDialog();
    const select = screen.getByLabelText('orders.bulk.targetStatus');
    await user.selectOptions(select, 'shipped');
    await user.tab();
    expect(screen.getByRole('button', { name: 'common.action.cancel' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'orders.bulk.apply' })).toHaveFocus();
    await user.tab();
    expect(select).toHaveFocus();
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const user = await openDialog();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change status' })).toHaveFocus();
  });

  it('opens with no status chosen each time, so a previous choice is not applied by accident', async () => {
    const user = await openDialog();
    await user.selectOptions(screen.getByLabelText('orders.bulk.targetStatus'), 'shipped');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Change status' }));
    expect(screen.getByLabelText('orders.bulk.targetStatus')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'orders.bulk.apply' })).toBeDisabled();
  });

  it('ignores Escape while the change is in flight and says so with aria-busy', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    postSpy.mockReturnValue(new Promise((r) => (resolve = r)));
    const onDone = vi.fn();
    const user = await openDialog({ onDone });
    await user.selectOptions(screen.getByLabelText('orders.bulk.targetStatus'), 'shipped');
    await user.click(screen.getByRole('button', { name: 'orders.bulk.apply' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    resolve({ data: { changed: ['o1'], skipped: [{ orderId: 'o2', reason: 'x' }] } });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/orders/bulk/status', { orderIds: ['o1', 'o2'], toStatusCode: 'shipped' });
  });

  it('announces a failure inside the dialog and keeps it open', async () => {
    postSpy.mockRejectedValue(new Error('network'));
    const user = await openDialog();
    await user.selectOptions(screen.getByLabelText('orders.bulk.targetStatus'), 'shipped');
    await user.click(screen.getByRole('button', { name: 'orders.bulk.apply' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('orders.bulk.error'));
  });

  it('has no axe violations while open', async () => {
    await openDialog();
    await expectNoAxeViolations(document.body);
  });
});
