import { StrictMode, useRef, useState, type ReactElement, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { expectNoAxeViolations } from '../helpers/axe';
import { installOffsetParentShim } from '../helpers/layout-shim';

/**
 * Feature 147 (T007) — the kit's dialog primitive, promoted from `crm`
 * (`specs/147-saved-views/contracts/admin-kit-saved-views.md` §1). Every render
 * is inside `<StrictMode>`, which is how the admin mounts, so focus capture and
 * restoration are exercised across React's mount → cleanup → mount cycle.
 */

installOffsetParentShim();

interface HarnessProps {
  onClose?: () => void;
  busy?: boolean;
  useInitialFocus?: boolean;
  useFinalFocus?: boolean;
  /** Feature 162 — describe the dialog by its body paragraph. */
  describe?: boolean;
}

function Harness(props: HarnessProps): ReactElement {
  const [open, setOpen] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);
  const finalRef = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    props.onClose?.();
    setOpen(false);
  };
  const extra: { initialFocusRef?: RefObject<HTMLElement | null>; finalFocusRef?: RefObject<HTMLElement | null> } = {};
  if (props.useInitialFocus) extra.initialFocusRef = okRef;
  if (props.useFinalFocus) extra.finalFocusRef = finalRef;
  return (
    <div>
      <button type="button" onClick={(): void => setOpen(true)}>
        Open
      </button>
      <button type="button" ref={finalRef}>
        Elsewhere
      </button>
      {open ? (
        <ModalDialog
          title="Rename tag"
          onClose={close}
          busy={props.busy ?? false}
          {...extra}
          {...(props.describe ? { 'aria-describedby': 'rename-help' } : {})}
          footer={
            <>
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button type="button" ref={okRef}>
                OK
              </button>
            </>
          }
        >
          <p id="rename-help">Every opportunity carrying the tag shows the new name.</p>
          <label htmlFor="tag-name">Tag name</label>
          <input id="tag-name" />
        </ModalDialog>
      ) : null}
    </div>
  );
}

async function openHarness(props: HarnessProps = {}): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(
    <StrictMode>
      <Harness {...props} />
    </StrictMode>,
  );
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return user;
}

describe('ModalDialog (admin-kit)', () => {
  it('is a modal dialog named by its title', async () => {
    await openHarness();
    const dialog = screen.getByRole('dialog', { name: 'Rename tag' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('is described by the element aria-describedby names (162)', async () => {
    await openHarness({ describe: true });
    expect(screen.getByRole('dialog', { name: 'Rename tag' })).toHaveAccessibleDescription(
      'Every opportunity carrying the tag shows the new name.',
    );
  });

  it('carries no aria-describedby when none is given', async () => {
    await openHarness();
    const dialog = screen.getByRole('dialog', { name: 'Rename tag' });
    expect(dialog).not.toHaveAttribute('aria-describedby');
    expect(dialog).toHaveAccessibleDescription('');
  });

  it('focuses the first focusable element on open by default', async () => {
    await openHarness();
    expect(screen.getByLabelText('Tag name')).toHaveFocus();
  });

  it('focuses initialFocusRef on open when given', async () => {
    await openHarness({ useInitialFocus: true });
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
  });

  it('cycles Tab and Shift+Tab inside the dialog', async () => {
    const user = await openHarness();
    const input = screen.getByLabelText('Tag name');
    const ok = screen.getByRole('button', { name: 'OK' });
    expect(input).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(ok).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(ok).toHaveFocus();
  });

  it('closes on Escape and on a mousedown on the scrim, not on the panel', async () => {
    const onClose = vi.fn();
    const user = await openHarness({ onClose });
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const scrim = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.mouseDown(scrim);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores Escape and the scrim while busy, and says so with aria-busy', async () => {
    const onClose = vi.fn();
    const user = await openHarness({ onClose, busy: true });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    await user.keyboard('{Escape}');
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('returns focus to the opener when it closes', async () => {
    const user = await openHarness();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('returns focus to finalFocusRef instead of the opener when given', async () => {
    const user = await openHarness({ useFinalFocus: true });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('has no axe violations while open', async () => {
    await openHarness();
    await expectNoAxeViolations(document.body);
  });
});

/**
 * Issue #1444 (DS-11) — the one dialog of the admin. It renders into
 * `document.body`, so a dialog opened from inside a transformed or clipped
 * subtree (a drawer, the fullscreen Page Builder) is still placed against the
 * viewport; `layer="overlay"` lifts it above the builder's own floating chrome;
 * and with two open only the topmost answers Escape.
 */
function Stacked(props: { layer?: 'page' | 'overlay' }): ReactElement {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <div data-testid="subtree">
      <button type="button" onClick={(): void => setOuter(true)}>
        Open outer
      </button>
      {outer ? (
        <ModalDialog title="Outer" onClose={(): void => setOuter(false)} {...(props.layer ? { layer: props.layer } : {})}>
          <button type="button" onClick={(): void => setInner(true)}>
            Open inner
          </button>
          {inner ? (
            <ModalDialog title="Inner" onClose={(): void => setInner(false)}>
              <button type="button">Inner action</button>
            </ModalDialog>
          ) : null}
        </ModalDialog>
      ) : null}
    </div>
  );
}

describe('ModalDialog — the admin-wide dialog rule (#1444, DS-11)', () => {
  it('renders into document.body, outside the subtree that opened it', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Stacked />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Open outer' }));
    const dialog = screen.getByRole('dialog', { name: 'Outer' });
    expect(screen.getByTestId('subtree').contains(dialog)).toBe(false);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
  });

  it('stacks on the page layer by default and above the fullscreen builder chrome with layer="overlay"', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Stacked />);
    await user.click(screen.getByRole('button', { name: 'Open outer' }));
    const pageScrim = screen.getByRole('dialog', { name: 'Outer' }).parentElement as HTMLElement;
    expect(pageScrim).toHaveAttribute('data-layer', 'page');
    unmount();

    render(<Stacked layer="overlay" />);
    await user.click(screen.getByRole('button', { name: 'Open outer' }));
    const overlayScrim = screen.getByRole('dialog', { name: 'Outer' }).parentElement as HTMLElement;
    expect(overlayScrim).toHaveAttribute('data-layer', 'overlay');
    // The builder's floating action bar sits at 9999 (`PageBuilderActionBar`).
    expect(Number(overlayScrim.style.zIndex)).toBeGreaterThan(9999);
  });

  it('answers Escape in the topmost dialog only, and returns focus into the one below', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Stacked />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: 'Open outer' }));
    await user.click(screen.getByRole('button', { name: 'Open inner' }));
    expect(screen.getByRole('button', { name: 'Inner action' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open inner' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open outer' })).toHaveFocus();
  });

  it('leaves an Escape that a layer inside it already handled', async () => {
    const onClose = vi.fn();
    render(
      <ModalDialog title="With a listbox" onClose={onClose}>
        <input aria-label="Search" onKeyDown={(event): void => event.preventDefault()} />
      </ModalDialog>,
    );
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses the panel itself when it holds nothing focusable', () => {
    render(
      <ModalDialog title="Read only" onClose={(): void => undefined}>
        <p>Nothing to press here.</p>
      </ModalDialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Read only' })).toHaveFocus();
  });
});
