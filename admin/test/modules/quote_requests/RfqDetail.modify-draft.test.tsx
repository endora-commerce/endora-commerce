import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import { BUNDLE, installGet, renderRfqDetail } from './rfq-reference-fixtures';

/**
 * Issue #1469 (UX audit SALES-03) — the Modify (negotiation) draft survives a tab
 * switch, is marked on its tab, holds back the header actions that would act on
 * the stored revision instead, and is asked about (Save / Discard / Stay) before
 * a link takes the operator away.
 */
const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
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

const DRAFT_BUNDLE = {
  core: {
    ...BUNDLE.core,
    ...passthroughBundle('core', [
      'rfq.detail.approve',
      'rfq.detail.modify.unsaved.body',
      'rfq.detail.modify.unsaved.blocked',
      'rfq.detail.modify.unsaved.open',
      'rfq.detail.tabs.modifyUnsaved',
      ...['title', 'body', 'save', 'saving', 'discard', 'stay', 'hint'].map((key) => `form.unsavedChanges.${key}`),
    ]).core,
  },
};

const tab = (name: RegExp): HTMLElement => screen.getByRole('tab', { name });

async function openModifyAndEdit(): Promise<HTMLInputElement> {
  installGet(getSpy, {}, 'reject', postSpy);
  renderRfqDetail(RfqDetail, 'en', DRAFT_BUNDLE);
  await userEvent.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
  const input = (await screen.findByRole('spinbutton', { name: 'rfq.detail.modify.agreedUnitPrice' })) as HTMLInputElement;
  expect(input.value).toBe('100.00');
  await userEvent.clear(input);
  await userEvent.type(input, '95');
  return input;
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  patchSpy.mockResolvedValue({ data: {} });
});

describe('RfqDetail — the Modify draft (issue #1469)', () => {
  it('is clean as opened: no dot, no note, Approve enabled', async () => {
    installGet(getSpy, {}, 'reject', postSpy);
    renderRfqDetail(RfqDetail, 'en', DRAFT_BUNDLE);
    await userEvent.click(await screen.findByRole('tab', { name: /rfq\.detail\.tabs\.modify/ }));
    await screen.findByRole('spinbutton', { name: 'rfq.detail.modify.agreedUnitPrice' });
    expect(screen.queryByTestId('tab-unsaved-dot')).toBeNull();
    expect(screen.queryByText('rfq.detail.modify.unsaved.blocked')).toBeNull();
    expect((screen.getByRole('button', { name: /rfq\.detail\.approve/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('survives a switch to another tab and back', async () => {
    await openModifyAndEdit();
    await userEvent.click(tab(/rfq\.detail\.tabs\.overview/));
    await userEvent.click(tab(/rfq\.detail\.tabs\.modify/));
    const input = screen.getByRole('spinbutton', { name: 'rfq.detail.modify.agreedUnitPrice' }) as HTMLInputElement;
    expect(input.value).toBe('95');
  });

  it('marks the Modify tab, in words as well as with a dot', async () => {
    await openModifyAndEdit();
    expect(screen.getByTestId('tab-unsaved-dot')).toBeTruthy();
    expect(tab(/rfq\.detail\.tabs\.modify/).textContent).toContain('rfq.detail.tabs.modifyUnsaved');
  });

  it('holds Approve back while the draft is unsaved, and says why', async () => {
    await openModifyAndEdit();
    const approve = screen.getByRole('button', { name: /rfq\.detail\.approve/ }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    const noteId = approve.getAttribute('aria-describedby');
    expect(noteId).toBeTruthy();
    expect(document.getElementById(noteId!)?.textContent).toBe('rfq.detail.modify.unsaved.blocked');
  });

  it('offers the way back to the draft from another tab', async () => {
    await openModifyAndEdit();
    await userEvent.click(tab(/rfq\.detail\.tabs\.overview/));
    await userEvent.click(screen.getByRole('button', { name: 'rfq.detail.modify.unsaved.open' }));
    expect(tab(/rfq\.detail\.tabs\.modify/).getAttribute('aria-selected')).toBe('true');
  });

  it('asks before the back link leaves the draft; Stay keeps it, Discard leaves', async () => {
    await openModifyAndEdit();
    await userEvent.click(screen.getByRole('link', { name: 'rfq.list.title' }));
    const dialog = screen.getByRole('dialog', { name: 'form.unsavedChanges.title' });
    expect(dialog.textContent).toContain('rfq.detail.modify.unsaved.body');
    await userEvent.click(within(dialog).getByRole('button', { name: 'form.unsavedChanges.stay' }));
    expect((screen.getByRole('spinbutton', { name: 'rfq.detail.modify.agreedUnitPrice' }) as HTMLInputElement).value).toBe('95');

    await userEvent.click(screen.getByRole('link', { name: 'rfq.list.title' }));
    await userEvent.click(screen.getByRole('button', { name: 'form.unsavedChanges.discard' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: /rfq\.detail\.tabs\.modify/ })).toBeNull());
  });

  it('Save and continue sends the draft before leaving', async () => {
    await openModifyAndEdit();
    await userEvent.click(screen.getByRole('link', { name: 'rfq.list.title' }));
    await userEvent.click(screen.getByRole('button', { name: 'form.unsavedChanges.save' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const body = patchSpy.mock.calls[0]?.[1] as { items: Array<{ agreedUnitPrice?: number }> };
    expect(body.items[0]?.agreedUnitPrice).toBe(95);
  });
});
