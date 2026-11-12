import { StrictMode, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, useConfirmDialog, type ConfirmOptions } from '@endora-commerce/admin-kit/components';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../helpers/axe';
import { installOffsetParentShim } from '../helpers/layout-shim';

/**
 * Issue #313 — the kit's confirmation dialog, which replaces the browser's
 * native `confirm()` across the admin: a titled `ModalDialog` with the question,
 * Cancel and a confirm button (destructive when asked), Escape and the scrim as
 * Cancel, focus on the safe answer for a destructive question, focus returned
 * to the opener, and a promise-returning hook so a call site changes by a line.
 */

installOffsetParentShim();

const CORE = passthroughBundle('core', [
  'common.action.cancel',
  'common.action.confirm',
  'common.confirm.title',
]);

function HookHarness(props: { options: ConfirmOptions; onResult: (ok: boolean) => void }): ReactElement {
  const { confirm, confirmDialog } = useConfirmDialog();
  return (
    <div>
      <button type="button" onClick={(): void => void confirm(props.options).then(props.onResult)}>
        Delete thing
      </button>
      {confirmDialog}
    </div>
  );
}

function renderHook(options: ConfirmOptions, onResult = vi.fn()): { onResult: ReturnType<typeof vi.fn> } {
  renderWithI18n(
    <StrictMode>
      <HookHarness options={options} onResult={onResult} />
    </StrictMode>,
    CORE,
  );
  return { onResult };
}

async function open(): Promise<{ opener: HTMLElement; dialog: HTMLElement }> {
  const opener = screen.getByRole('button', { name: 'Delete thing' });
  await userEvent.click(opener);
  return { opener, dialog: await screen.findByRole('dialog') };
}

describe('useConfirmDialog (#313)', () => {
  it('resolves true on the confirm button and closes, returning focus to the opener', async () => {
    const { onResult } = renderHook({ title: 'Delete the tag?', message: 'Posts keep their text.', confirmLabel: 'Delete', destructive: true });
    const { opener, dialog } = await open();
    expect(dialog).toHaveAccessibleName('Delete the tag?');
    expect(dialog).toHaveAccessibleDescription('Posts keep their text.');
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirmButton.className).toMatch(/destructive/);
    await userEvent.click(confirmButton);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('focuses Cancel first for a destructive question, so Enter keeps the data', async () => {
    const { onResult } = renderHook({ message: 'Delete it?', destructive: true });
    const { dialog } = await open();
    expect(within(dialog).getByRole('button', { name: 'common.action.cancel' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('focuses the confirm button for a non-destructive question', async () => {
    renderHook({ message: 'Resend the e-mail?' });
    const { dialog } = await open();
    const confirmButton = within(dialog).getByRole('button', { name: 'common.action.confirm' });
    expect(confirmButton).toHaveFocus();
    expect(confirmButton.className).not.toMatch(/destructive/);
  });

  it('falls back to the default title and labels from the core bundle', async () => {
    renderHook({ message: 'Resend the e-mail?' });
    const { dialog } = await open();
    expect(dialog).toHaveAccessibleName('common.confirm.title');
    expect(within(dialog).getByText('Resend the e-mail?')).toBeInTheDocument();
  });

  it('resolves false on Cancel, on Escape and on the scrim', async () => {
    const { onResult } = renderHook({ message: 'Delete it?', destructive: true });
    let { opener, dialog } = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.cancel' }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
    await waitFor(() => expect(opener).toHaveFocus());

    ({ opener, dialog } = await open());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenLastCalledWith(false);

    ({ dialog } = await open());
    const scrim = dialog.parentElement as HTMLElement;
    await userEvent.pointer({ keys: '[MouseLeft]', target: scrim });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onResult).toHaveBeenCalledTimes(3);
    expect(onResult).toHaveBeenLastCalledWith(false);
  });

  it('never calls the browser dialog', async () => {
    const native = vi.spyOn(window, 'confirm');
    renderHook({ message: 'Delete it?' });
    const { dialog } = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.confirm' }));
    expect(native).not.toHaveBeenCalled();
    native.mockRestore();
  });

  it('resolves a pending question false when its screen unmounts', async () => {
    const onResult = vi.fn();
    const { unmount } = renderWithI18n(<HookHarness options={{ message: 'Delete it?' }} onResult={onResult} />, CORE);
    await open();
    act(() => unmount());
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('has no axe violations while open', async () => {
    renderHook({ title: 'Delete the tag?', message: 'Posts keep their text.', destructive: true });
    const { dialog } = await open();
    await expectNoAxeViolations(dialog);
  });
});

describe('ConfirmDialog (#313) — controlled, with a request in flight', () => {
  function Controlled(props: { onConfirm: () => void; busy?: boolean; error?: string | null }): ReactElement {
    const [shown, setShown] = useState(true);
    if (!shown) return <p>closed</p>;
    return (
      <ConfirmDialog
        title="Disable the module?"
        message="Its screens disappear."
        confirmLabel="Disable"
        destructive
        busy={props.busy ?? false}
        error={props.error ?? null}
        onConfirm={props.onConfirm}
        onCancel={(): void => setShown(false)}
      />
    );
  }

  it('makes both buttons and Escape inert while busy, and marks the confirm button busy', async () => {
    const onConfirm = vi.fn();
    renderWithI18n(<Controlled onConfirm={onConfirm} busy />, CORE);
    const dialog = screen.getByRole('dialog', { name: 'Disable the module?' });
    const confirmButton = within(dialog).getByRole('button', { name: 'Disable' });
    expect(confirmButton).toBeDisabled();
    expect(confirmButton).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'common.action.cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the error inside the dialog as an alert', () => {
    renderWithI18n(<Controlled onConfirm={vi.fn()} error="The module could not be disabled." />, CORE);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The module could not be disabled.');
  });
});
