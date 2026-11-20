import { StrictMode, useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ConfirmDialog,
  MODAL_OVERLAY_Z_INDEX,
  useConfirmDialog,
  type UseConfirmDialog,
  type UseConfirmDialogOptions,
} from '@endora-commerce/admin-kit/components';

/** Either form `confirm` takes: a bare question, or one that runs its action in the dialog. */
type ConfirmArgs = Parameters<UseConfirmDialog['confirm']>[0];
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

function HookHarness(props: { options: ConfirmArgs; onResult: (ok: boolean) => void }): ReactElement {
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

function renderHook(options: ConfirmArgs, onResult = vi.fn()): { onResult: ReturnType<typeof vi.fn> } {
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

describe('useConfirmDialog — an action run inside the dialog (#1464)', () => {
  function deferred(): { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void } {
    let resolve: () => void = () => undefined;
    let reject: (err: unknown) => void = () => undefined;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('keeps the dialog open and busy while the action runs, then resolves true and closes', async () => {
    const pending = deferred();
    const action = vi.fn(() => pending.promise);
    const { onResult } = renderHook({ message: 'Delete it?', confirmLabel: 'Delete', destructive: true, action, describeError: () => 'x' });
    const { opener, dialog } = await open();
    const confirmButton = within(dialog).getByRole('button', { name: 'Delete' });
    await userEvent.click(confirmButton);

    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(confirmButton).toBeDisabled());
    expect(confirmButton).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'common.action.cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onResult).not.toHaveBeenCalled();

    await act(async () => pending.resolve());
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('keeps a failed action in the dialog with its described error, and lets it be retried or cancelled', async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const describeError = vi.fn((err: unknown) => `Could not delete: ${(err as Error).message}`);
    const { onResult } = renderHook({ message: 'Delete it?', confirmLabel: 'Delete', destructive: true, action, describeError });
    const { dialog } = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not delete: boom');
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining('Could not delete: boom'));
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(onResult).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('resolves false on Cancel after a failure, without running the action again', async () => {
    const action = vi.fn().mockRejectedValue(new Error('boom'));
    const { onResult } = renderHook({ message: 'Delete it?', confirmLabel: 'Delete', destructive: true, action, describeError: () => 'failed' });
    const { dialog } = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await within(dialog).findByText('failed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.cancel' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(action).toHaveBeenCalledTimes(1);
  });
});

/**
 * A confirmed action that removes its own opener — a row's *Remove* — used to leave focus on
 * `body` once the row was gone. `returnFocusTo` names where focus goes instead (WCAG 2.4.3).
 */
describe('useConfirmDialog — focus after a confirmed answer (returnFocusTo)', () => {
  function NeighbourHarness(props: {
    target: (neighbour: HTMLButtonElement | null) => ConfirmArgs['returnFocusTo'];
    withAction?: boolean;
    onResult?: (ok: boolean) => void;
  }): ReactElement {
    const { confirm, confirmDialog } = useConfirmDialog();
    const [removed, setRemoved] = useState(false);
    const [neighbour, setNeighbour] = useState<HTMLButtonElement | null>(null);
    const neighbourRef = { current: neighbour };
    const ask = async (): Promise<void> => {
      const ok = await confirm({
        message: 'Remove the row?',
        confirmLabel: 'Remove',
        destructive: true,
        returnFocusTo: props.target(neighbourRef.current),
        ...(props.withAction ? { action: () => Promise.resolve(), describeError: () => 'failed' } : {}),
      });
      props.onResult?.(ok);
      if (ok) setRemoved(true);
    };
    return (
      <div>
        {removed ? null : (
          <button type="button" onClick={(): void => void ask()}>
            Remove row
          </button>
        )}
        <button type="button" ref={setNeighbour}>
          Next row
        </button>
        {confirmDialog}
      </div>
    );
  }

  function renderNeighbour(props: Parameters<typeof NeighbourHarness>[0]): void {
    renderWithI18n(
      <StrictMode>
        <NeighbourHarness {...props} />
      </StrictMode>,
      CORE,
    );
  }

  async function removeRow(): Promise<void> {
    await userEvent.click(screen.getByRole('button', { name: 'Remove row' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }

  it('sends focus to the element it names, not to body, once the opener is gone', async () => {
    renderNeighbour({ target: (neighbour) => neighbour ?? undefined });
    await removeRow();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove row' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Next row' })).toHaveFocus();
  });

  it('accepts a ref', async () => {
    const ref = { current: null as HTMLElement | null };
    renderNeighbour({
      target: (neighbour) => {
        ref.current = neighbour;
        return ref;
      },
    });
    await removeRow();
    expect(screen.getByRole('button', { name: 'Next row' })).toHaveFocus();
  });

  it('calls a resolver once, when the dialog closes on yes after its action succeeded', async () => {
    const resolver = vi.fn(() => screen.getByRole('button', { name: 'Next row' }));
    renderNeighbour({ target: () => resolver, withAction: true });
    await userEvent.click(screen.getByRole('button', { name: 'Remove row' }));
    const dialog = await screen.findByRole('dialog');
    expect(resolver).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Next row' })).toHaveFocus();
  });

  it('returns focus to the opener on Cancel, without resolving the target', async () => {
    const resolver = vi.fn(() => screen.getByRole('button', { name: 'Next row' }));
    const onResult = vi.fn();
    renderNeighbour({ target: () => resolver, onResult });
    const opener = screen.getByRole('button', { name: 'Remove row' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.cancel' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(resolver).not.toHaveBeenCalled();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('falls back to the opener when the resolver names nothing', async () => {
    const onResult = vi.fn();
    renderNeighbour({ target: () => () => null, onResult });
    const opener = screen.getByRole('button', { name: 'Remove row' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.getByRole('button', { name: 'Next row' })).not.toHaveFocus();
  });
});

/**
 * A confirmation asked from inside the fullscreen Page Builder has to open above
 * Puck's 9999 action bar, as every other builder dialog does — `ModalDialog`'s
 * `overlay` layer. Opt-in: the default stays the admin's `page` layer (`z-50`).
 */
describe('ConfirmDialog / useConfirmDialog — the stacking layer', () => {
  function LayerHarness(props: { hookOptions?: UseConfirmDialogOptions }): ReactElement {
    const { confirm, confirmDialog } = useConfirmDialog(props.hookOptions);
    return (
      <div>
        <button type="button" onClick={(): void => void confirm({ message: 'Clear it?', destructive: true })}>
          Delete thing
        </button>
        {confirmDialog}
      </div>
    );
  }

  const layerOf = (dialog: HTMLElement): HTMLElement => dialog.closest('[data-layer]') as HTMLElement;

  it('opens on the page layer by default', async () => {
    renderWithI18n(<LayerHarness />, CORE);
    const { dialog } = await open();
    expect(layerOf(dialog)).toHaveAttribute('data-layer', 'page');
    expect(layerOf(dialog)).toHaveClass('z-50');
  });

  it('useConfirmDialog({ layer: "overlay" }) opens above the builder chrome, keeping focus on Cancel and back to the opener', async () => {
    renderWithI18n(<LayerHarness hookOptions={{ layer: 'overlay' }} />, CORE);
    const { opener, dialog } = await open();
    expect(layerOf(dialog)).toHaveAttribute('data-layer', 'overlay');
    expect(layerOf(dialog).style.zIndex).toBe(String(MODAL_OVERLAY_Z_INDEX));
    expect(layerOf(dialog)).not.toHaveClass('z-50');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'common.action.cancel' })).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('the controlled ConfirmDialog takes layer="overlay"', () => {
    renderWithI18n(<ConfirmDialog layer="overlay" message="Clear it?" onConfirm={vi.fn()} onCancel={vi.fn()} />, CORE);
    const dialog = screen.getByRole('dialog');
    expect(layerOf(dialog)).toHaveAttribute('data-layer', 'overlay');
    expect(layerOf(dialog).style.zIndex).toBe(String(MODAL_OVERLAY_Z_INDEX));
  });
});
