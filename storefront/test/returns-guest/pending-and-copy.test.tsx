// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `specs/181-guest-complaints/` design review F-9 and S-6: the two client leaves of the
 * guest flow.
 *
 * - `CartSubmitButton` with `trackNativeSubmit` shows its pending state for a form posting
 *   to a route handler — a string action, for which `useFormStatus` reports nothing — so a
 *   double click on *Continue* sends one redemption (F-3).
 * - `CopyField` copies the tracking link and says so in a status region that keeps the
 *   result; when the clipboard refuses, it says so and selects the link for a manual copy.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { CartSubmitButton } = await import('../../components/CartSubmitButton');
const { CopyField } = await import('../../components/returns/CopyField');

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

describe('CartSubmitButton trackNativeSubmit (F-9)', () => {
  // A dispatched `submit` event does not navigate in jsdom, so no handler has to stop it.
  it('disables itself with aria-busy and the pending label once its form submits', () => {
    const el = mount(
      <form action="/returns/guest/verify/continue" method="post">
        <CartSubmitButton trackNativeSubmit label="Continue" pendingLabel="Opening…" className="btn" />
      </form>,
    );
    const button = el.querySelector('button')!;
    expect(button.disabled).toBe(false);
    act(() => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toContain('Opening…');
    expect(button.querySelector('.b2b-spin')).not.toBeNull();
  });

  it('comes back when the page is shown again from the back-forward cache', () => {
    const el = mount(
      <form>
        <CartSubmitButton trackNativeSubmit label="Send" />
      </form>,
    );
    act(() => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    act(() => {
      window.dispatchEvent(new Event('pageshow'));
    });
    expect(el.querySelector('button')!.disabled).toBe(false);
  });

  it('ignores a submission another handler cancelled (an upload still running)', () => {
    const el = mount(
      <form
        ref={(form) => form?.addEventListener('submit', (e) => e.preventDefault(), { capture: true })}
      >
        <CartSubmitButton trackNativeSubmit label="Submit" />
      </form>,
    );
    act(() => {
      el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(el.querySelector('button')!.disabled).toBe(false);
  });
});

describe('CopyField (S-6)', () => {
  const labels = { label: 'Link', copy: 'Copy link', copied: 'Link copied.', failed: 'Couldn’t copy. Select the link and copy it yourself.' };

  it('copies the link and keeps the result in its status region', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const el = mount(<CopyField id="track-url" value="https://shop.test/returns/track/tok" {...labels} />);
    const input = el.querySelector('input')!;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('https://shop.test/returns/track/tok');
    await act(async () => {
      el.querySelector('button')!.click();
    });
    expect(writeText).toHaveBeenCalledWith('https://shop.test/returns/track/tok');
    expect(el.querySelector('[role="status"]')!.textContent).toBe('Link copied.');
  });

  it('says the copy failed and selects the link for a manual copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => Promise.reject(new Error('denied')) }, configurable: true });
    const el = mount(<CopyField id="track-url" value="https://shop.test/returns/track/tok" {...labels} />);
    await act(async () => {
      el.querySelector('button')!.click();
    });
    expect(el.querySelector('[role="status"]')!.textContent).toBe(labels.failed);
    expect(document.activeElement).toBe(el.querySelector('input'));
  });
});
