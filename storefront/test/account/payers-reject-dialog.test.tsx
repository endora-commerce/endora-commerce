// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RelatedPayerIncomingRequest } from '@endora-commerce/contracts';

/**
 * `specs/182-related-payers/` Phase 7 (owner, 2026-11-20) — rejecting a request or an invitation
 * on **Payers** no longer puts a reason input in the table row: the row's *Reject* opens a modal
 * dialog that names the sender, takes an optional reason (labelled, bounded as the contract bounds
 * it) and submits the same server action with `requestId` and `reason`. Cancel closes it and sends
 * nothing.
 *
 * jsdom does not implement `showModal()`; the stub below does the part the component relies on
 * (`open`, and a `close` event on close). Inertness and Escape are the browser's.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { IncomingRequestsTable } = await import('../../components/account/Payers');

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal: () => void;
    close: () => void;
  };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

const REQUEST: RelatedPayerIncomingRequest = {
  id: '00000000-0000-4000-8000-0000000000d3',
  direction: 'buyer_request',
  senderOrganizationId: '00000000-0000-4000-8000-0000000000b1',
  senderName: 'Buyer X',
  senderTaxId: 'PL9990001111',
  comment: null,
  createdAt: '2026-11-19T09:00:00.000Z',
  expiresAt: '2026-12-19T09:00:00.000Z',
};

let host: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = root = null;
});

function mount(node: React.ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

function table(rejectAction: (fd: FormData) => Promise<void>, locale = 'en-US', kind?: 'invitations') {
  return mount(
    <IncomingRequestsTable
      requests={[REQUEST]}
      locale={locale}
      acceptAction={async () => undefined}
      rejectAction={rejectAction}
      {...(kind ? { kind } : {})}
    />,
  );
}

function trigger(el: HTMLElement): HTMLButtonElement {
  const found = el.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  if (!found) throw new Error('no dialog trigger in the row');
  return found;
}

function button(scope: ParentNode, text: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

describe('Payers — reject in a dialog (feature 182, owner 2026-11-20)', () => {
  it('has no reason input in the row; Reject opens a labelled dialog naming the sender', () => {
    const el = table(vi.fn());
    const dialog = el.querySelector('dialog')!;
    // The only reason field is inside the dialog, not inline in the row.
    expect(el.querySelectorAll('[name="reason"]')).toHaveLength(1);
    expect(dialog.querySelector('[name="reason"]')).not.toBeNull();
    expect(dialog.open).toBe(false);
    expect(trigger(el).textContent).toBe('Reject');

    act(() => trigger(el).click());

    expect(dialog.open).toBe(true);
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    expect(title?.textContent).toBe('Reject this request?');
    expect(dialog.textContent).toContain('Buyer X');
    const reason = dialog.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
    expect(document.activeElement).toBe(reason);
    expect(dialog.querySelector(`label[for="${reason.id}"]`)?.textContent).toBe('Reason (optional)');
    expect(reason.maxLength).toBe(2000);
    expect(reason.required).toBe(false);
    expect(document.getElementById(reason.getAttribute('aria-describedby')!)?.textContent).toBe(
      'The sender will see this reason.',
    );
  });

  it('confirming posts the request id and the reason to the reject action', async () => {
    const rejectAction = vi.fn(async (_fd: FormData): Promise<void> => undefined);
    const el = table(rejectAction);
    act(() => trigger(el).click());
    const dialog = el.querySelector('dialog')!;
    dialog.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!.value = 'We do not know you';

    await act(async () => button(dialog, 'Reject').click());

    expect(rejectAction).toHaveBeenCalledOnce();
    const sent = rejectAction.mock.calls[0]![0];
    expect(sent.get('requestId')).toBe(REQUEST.id);
    expect(sent.get('reason')).toBe('We do not know you');
    expect(dialog.open).toBe(false);
  });

  it('confirming with no reason posts an empty one (the action sends null)', async () => {
    const rejectAction = vi.fn(async (_fd: FormData): Promise<void> => undefined);
    const el = table(rejectAction);
    act(() => trigger(el).click());
    await act(async () => button(el.querySelector('dialog')!, 'Reject').click());
    expect(rejectAction.mock.calls[0]![0].get('reason')).toBe('');
  });

  it('Cancel closes without submitting and gives focus back to the row', () => {
    const rejectAction = vi.fn();
    const el = table(rejectAction);
    act(() => trigger(el).click());
    const dialog = el.querySelector('dialog')!;

    act(() => button(dialog, 'Cancel').click());

    expect(dialog.open).toBe(false);
    expect(rejectAction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger(el));
  });

  it('says so in the dialog when the request itself fails, and keeps it open for a retry', async () => {
    const rejectAction = vi.fn(async (): Promise<void> => {
      throw new Error('network down');
    });
    const el = table(rejectAction);
    act(() => trigger(el).click());
    const dialog = el.querySelector('dialog')!;
    await act(async () => button(dialog, 'Reject').click());
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Could not reject. Try again.');
  });

  it('an invitation from a payer gets its own title', () => {
    const el = table(vi.fn(), 'en-US', 'invitations');
    act(() => trigger(el).click());
    const dialog = el.querySelector('dialog')!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Reject this invitation?',
    );
  });

  it('speaks Polish with the agreed verb: Odmów', () => {
    const el = table(vi.fn(), 'pl-PL');
    expect(trigger(el).textContent).toBe('Odmów');
    act(() => trigger(el).click());
    const dialog = el.querySelector('dialog')!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(
      'Odmówić opłacania zamówień?',
    );
    expect(button(dialog, 'Odmów')).toBeDefined();
    expect(button(dialog, 'Anuluj')).toBeDefined();
    const reason = dialog.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!;
    expect(dialog.querySelector(`label[for="${reason.id}"]`)?.textContent).toBe('Powód (opcjonalnie)');
  });
});
