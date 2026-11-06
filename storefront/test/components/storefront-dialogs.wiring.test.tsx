import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ClearListButton } from '../../components/shopping-lists/ClearListButton';
import { DeleteShoppingListButton } from '../../components/shopping-lists/DeleteShoppingListButton';
import { NotifyWhenAvailableDialog } from '../../components/inventory/NotifyWhenAvailableDialog';
import { ModalDialog, ModalDialogClose } from '../../components/ModalDialog';
import { findElement, findElements } from './element-tree';

/**
 * Issue #804 — moving the three dialogs onto `ModalDialog` keeps what their
 * actions do: confirming a clear or a delete still dispatches the server
 * action with the list's id, cancelling dispatches nothing, and the
 * notify-when-available form still posts to the backend on the page's channel.
 *
 * No DOM in this harness (SSR-test convention), so each component is called as
 * a function with its hooks stubbed, and the handler on the element it returns
 * is invoked directly.
 */

const setters: Array<ReturnType<typeof vi.fn>> = [];

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: <S,>(initial: S | (() => S)) => {
      const setter = vi.fn();
      setters.push(setter);
      return [typeof initial === 'function' ? (initial as () => S)() : initial, setter];
    },
    useTransition: () => [false, (fn: () => unknown): void => void fn()],
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: () => undefined,
    useId: () => ':n:',
  };
});

type El = ReactElement<Record<string, unknown>>;

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The `ModalDialogClose` buttons in the dialog's footer. */
function footerCloses(tree: unknown): El[] {
  const dialog = findElement(tree, (el) => el.type === ModalDialog);
  return findElements(dialog.props.footer, (el) => el.type === ModalDialogClose);
}

function byClass(buttons: El[], cls: string): El {
  const found = buttons.find((b) => String(b.props.className).split(' ').includes(cls));
  if (!found) throw new Error(`no button with class ${cls}`);
  return found;
}

afterEach(() => {
  setters.length = 0;
  vi.unstubAllGlobals();
});

describe('ClearListButton — the action still runs (issue #804)', () => {
  it('confirming dispatches clearAction with the list id', async () => {
    const clearAction = vi.fn(async (_fd: FormData): Promise<void> => undefined);
    const tree = ClearListButton({ listId: 'l1', locale: 'en-US', clearAction });
    (byClass(footerCloses(tree), 'btn--danger').props.onClick as () => void)();
    await flush();
    expect(clearAction).toHaveBeenCalledOnce();
    expect(clearAction.mock.calls[0]![0].get('listId')).toBe('l1');
  });

  it('cancelling only closes', () => {
    const clearAction = vi.fn();
    const tree = ClearListButton({ listId: 'l1', locale: 'en-US', clearAction });
    expect(byClass(footerCloses(tree), 'btn--outline').props.onClick).toBeUndefined();
    expect(clearAction).not.toHaveBeenCalled();
  });
});

describe('DeleteShoppingListButton — the action still runs (issue #804)', () => {
  it('confirming dispatches deleteAction with the list id', async () => {
    const deleteAction = vi.fn(async (_fd: FormData): Promise<void> => undefined);
    const tree = DeleteShoppingListButton({ listId: 'l9', listName: 'Site A', locale: 'en-US', deleteAction });
    (byClass(footerCloses(tree), 'btn--danger').props.onClick as () => void)();
    await flush();
    expect(deleteAction).toHaveBeenCalledOnce();
    expect(deleteAction.mock.calls[0]![0].get('id')).toBe('l9');
  });

  it('cancelling only closes', () => {
    const tree = DeleteShoppingListButton({ listId: 'l9', listName: 'Site A', locale: 'en-US', deleteAction: vi.fn() });
    expect(byClass(footerCloses(tree), 'btn--outline').props.onClick).toBeUndefined();
  });
});

describe('NotifyWhenAvailableDialog — the form still submits (issue #804)', () => {
  const labels = {
    cta: 'Notify',
    dialogTitle: 'Get notified',
    emailLabel: 'Email',
    submit: 'Notify me',
    submitting: 'Subscribing…',
    success: 'Done',
    errorGeneric: 'Could not subscribe.',
    cancel: 'Cancel',
    close: 'Close',
  };

  it('posts the subscription on the page’s channel', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    const tree = NotifyWhenAvailableDialog({
      productId: 'p1',
      variantId: 'v1',
      defaultEmail: 'buyer@example.com',
      salesChannelCode: 'b2b-pl',
      labels,
    });
    const form = findElement(tree, (el) => el.type === 'form');
    const event = { preventDefault: vi.fn() };
    (form.props.onSubmit as (e: unknown) => void)(event);
    await flush();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/storefront\/inventory\/notify-when-available$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['X-Sales-Channel']).toBe('b2b-pl');
    expect(JSON.parse(String(init.body))).toEqual({ productId: 'p1', email: 'buyer@example.com', variantId: 'v1' });
    // The success flag was raised: some state setter received `true` after the post.
    expect(setters.some((s) => s.mock.calls.some((c) => c[0] === true))).toBe(true);
  });

  it('reports the backend’s message when the post is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Too many requests' } }), { status: 429 })),
    );
    const tree = NotifyWhenAvailableDialog({ productId: 'p1', salesChannelCode: 'b2b-pl', labels });
    (findElement(tree, (el) => el.type === 'form').props.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() });
    await flush();
    expect(setters.some((s) => s.mock.calls.some((c) => c[0] === 'Too many requests'))).toBe(true);
  });
});
