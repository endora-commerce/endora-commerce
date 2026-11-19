import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { installGet, renderRfqDetail } from './rfq-reference-fixtures';

/**
 * Issue #1449 (UX audit 2026-11-17, DS-19; SALES-16) — the Modify tab's "Save revision" used
 * to sit under "+ Add line" at the end of a long list, and its refusals landed in the page-top
 * alert, out of view. It is now in the kit's sticky bar: the shorter label, a muted note that
 * says the customer is notified (and describes the button), "Unsaved changes" once the draft
 * differs, and the refusal said beside it.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();

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
      patch: (...args: unknown[]) => patchSpy(...args),
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

async function openModify(): Promise<HTMLInputElement> {
  installGet(getSpy, {}, 'reject', postSpy);
  renderRfqDetail(RfqDetail);
  await userEvent.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
  return (await screen.findByRole('spinbutton', { name: 'rfq.detail.modify.agreedUnitPrice' })) as HTMLInputElement;
}

function saveBar(): HTMLElement {
  const bar = document.querySelector<HTMLElement>('[data-slot="sticky-form-actions"]');
  if (bar === null) throw new Error('no save bar');
  return bar;
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: {} });
});

describe('RfqDetail Modify — Save revision in the sticky bar (DS-19)', () => {
  it('puts Save revision in a sticky bar, described by the customer-notified note', async () => {
    await openModify();
    const bar = saveBar();
    expect(bar).toHaveAttribute('data-desktop', 'sticky');
    const save = within(bar).getByRole('button', { name: 'rfq.detail.modify.saveRevision' });
    expect(save).toHaveAccessibleDescription('rfq.detail.modify.notifiesCustomer');
    // "+ Add line" edits the list; it is not one of the bar's actions.
    expect(within(bar).queryByRole('button', { name: 'rfq.detail.modify.addLine' })).toBeNull();
  });

  it('says "Unsaved changes" in the bar once the draft differs', async () => {
    const input = await openModify();
    const hint = within(saveBar()).getByTestId('unsaved-changes-hint');
    expect(hint).toHaveTextContent('');
    await userEvent.clear(input);
    await userEvent.type(input, '110');
    expect(hint).not.toHaveTextContent('');
  });

  it('says a refused save in the bar, beside the button', async () => {
    const input = await openModify();
    await userEvent.clear(input);
    await userEvent.type(input, '110');
    patchSpy.mockRejectedValue(new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'The quote changed meanwhile.' } }));
    await userEvent.click(within(saveBar()).getByRole('button', { name: 'rfq.detail.modify.saveRevision' }));
    await waitFor(() =>
      expect(within(saveBar()).getByRole('alert')).toHaveTextContent('The quote changed meanwhile.'),
    );
  });
});
