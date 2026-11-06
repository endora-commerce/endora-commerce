import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ModalDialog, ModalDialogClose } from '../../components/ModalDialog';
import { findElement } from './element-tree';

/**
 * Issue #804 — what `ModalDialog` does when it is used, not only what it
 * renders.
 *
 * The harness has no DOM (SSR-test convention), so the component is called as
 * a function with its hooks stubbed, and the handlers it wires onto the
 * `<button>` and `<dialog>` are invoked against stand-in elements. The
 * browser's own share — `showModal()` making the page inert and turning Escape
 * into a `cancel` event followed by `close` — is the platform's; what is
 * asserted is the component's half of each: it opens modally and moves focus
 * where the caller asked, it lets Escape through unless a submit is in flight,
 * and it hands focus back to the trigger on every close.
 */

let context: { close: () => void } | null = null;

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useId: () => ':d:',
    useContext: () => context,
  };
});

type El = ReactElement<Record<string, unknown>>;

function fakeDialog(autofocus: { focus: () => void } | null = null) {
  return {
    open: false,
    showModal: vi.fn(function (this: { open: boolean }) {
      this.open = true;
    }),
    close: vi.fn(),
    querySelector: vi.fn((selector: string) => (selector === '[data-autofocus]' ? autofocus : null)),
  };
}

function mount(props: { dismissible?: boolean } = {}) {
  const tree = ModalDialog({
    triggerLabel: 'Open',
    title: 'Title',
    closeLabel: 'Close',
    ...props,
    children: 'body',
  });
  const trigger = findElement(tree, (el) => el.type === 'button' && el.props['aria-haspopup'] === 'dialog');
  const dialog = findElement(tree, (el) => el.type === 'dialog');
  const closeButton = findElement(tree, (el) => el.type === 'button' && el.props['aria-label'] === 'Close');
  const triggerNode = { focus: vi.fn() };
  const autofocusNode = { focus: vi.fn() };
  const dialogNode = fakeDialog(autofocusNode);
  (trigger.props.ref as { current: unknown }).current = triggerNode;
  (dialog.props.ref as { current: unknown }).current = dialogNode;
  return { trigger, dialog, closeButton, triggerNode, dialogNode, autofocusNode };
}

function call(el: El, handler: string, event?: unknown): void {
  (el.props[handler] as (e?: unknown) => void)(event);
}

describe('ModalDialog — opening', () => {
  it('opens as a modal (the focus trap) and focuses the control the caller flagged', () => {
    const m = mount();
    call(m.trigger, 'onClick');
    expect(m.dialogNode.showModal).toHaveBeenCalledOnce();
    expect(m.dialogNode.querySelector).toHaveBeenCalledWith('[data-autofocus]');
    expect(m.autofocusNode.focus).toHaveBeenCalledOnce();
  });

  it('does not reopen a dialog that is already open', () => {
    const m = mount();
    m.dialogNode.open = true;
    call(m.trigger, 'onClick');
    expect(m.dialogNode.showModal).not.toHaveBeenCalled();
  });
});

describe('ModalDialog — Escape', () => {
  it('lets Escape close the dialog', () => {
    const m = mount();
    const event = { preventDefault: vi.fn() };
    call(m.dialog, 'onCancel', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('holds Escape back while the dialog is not dismissible (a submit in flight)', () => {
    const m = mount({ dismissible: false });
    const event = { preventDefault: vi.fn() };
    call(m.dialog, 'onCancel', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

describe('ModalDialog — closing and focus return', () => {
  it('returns focus to the trigger whenever the dialog closes', () => {
    const m = mount();
    call(m.dialog, 'onClose');
    expect(m.triggerNode.focus).toHaveBeenCalledOnce();
  });

  it('closes from its close button', () => {
    const m = mount();
    call(m.closeButton, 'onClick');
    expect(m.dialogNode.close).toHaveBeenCalledOnce();
  });

  it('closes on a backdrop click, not on a click inside the content', () => {
    const m = mount();
    const self = {};
    call(m.dialog, 'onClick', { target: {}, currentTarget: self });
    expect(m.dialogNode.close).not.toHaveBeenCalled();
    call(m.dialog, 'onClick', { target: self, currentTarget: self });
    expect(m.dialogNode.close).toHaveBeenCalledOnce();
  });

  it('ignores the backdrop while it is not dismissible', () => {
    const m = mount({ dismissible: false });
    const self = {};
    call(m.dialog, 'onClick', { target: self, currentTarget: self });
    expect(m.dialogNode.close).not.toHaveBeenCalled();
  });
});

describe('ModalDialogClose', () => {
  it('runs the caller’s action first, then closes the dialog it sits in', () => {
    const order: string[] = [];
    context = { close: () => order.push('close') };
    const button = ModalDialogClose({ children: 'Confirm', onClick: () => order.push('action') }) as El;
    expect(button.type).toBe('button');
    expect(button.props.type).toBe('button');
    call(button, 'onClick');
    expect(order).toEqual(['action', 'close']);
    context = null;
  });

  it('closes without an action of its own (a cancel)', () => {
    const close = vi.fn();
    context = { close };
    call(ModalDialogClose({ children: 'Cancel' }) as El, 'onClick');
    expect(close).toHaveBeenCalledOnce();
    context = null;
  });
});
