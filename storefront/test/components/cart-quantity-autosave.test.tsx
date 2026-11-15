// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CartLine, type CartLineViewModel } from '../../components/CartLine';
import { CartCouponInput } from '../../components/CartCouponInput';
import { CartPrimaryCta } from '../../components/CartPrimaryCta';
import { CartQuantityAutosave, type CartQuantitySaveResult } from '../../components/CartQuantityAutosave';

/**
 * Issue #1252 — a quantity typed into a cart line is saved on its own: after a short pause in
 * typing, on blur and on Enter, with a saving / saved / refused state beside the line. Clicking
 * "+" or "−" on another line, applying a coupon or going to checkout first waits for that save,
 * so none of them proceeds on the quantity the buyer typed over.
 *
 * Clicks are dispatched without moving focus — what Safari does with a button — so blur is
 * never what rescues the typed value here.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The checkout link's navigation, observed where `next/link` would perform it. */
const navigate = vi.fn();
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a
      href={href}
      {...rest}
      onClick={(e): void => {
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  ),
}));

const STRINGS = {
  qtyLabel: 'Quantity',
  unitPriceLabel: 'Unit price',
  lineTotalLabel: 'Line total',
  removeLabel: 'Remove',
  saveToListLabel: 'Save to list',
  netSuffix: 'net',
  grossSuffix: 'gross',
  unavailable: {
    out_of_stock: 'Out of stock.',
    not_purchasable: 'No longer available.',
    no_price_in_customer_list: 'Pricing unavailable.',
  },
};

const AUTOSAVE_STRINGS = { saving: 'Saving…', saved: 'Saved', failed: 'Could not update the quantity.' };

const COUPON_STRINGS = {
  label: 'Coupon code',
  placeholder: 'Enter code',
  applyButton: 'Apply',
  clearButton: 'Remove',
  activeCode: (code: string) => `Applied: ${code}`,
  autoDropped: (code: string) => `Dropped ${code}`,
  rejectedReason: (reason: string) => `Rejected: ${reason}`,
};

function line(id: string, quantity: number, overrides: Partial<CartLineViewModel> = {}): CartLineViewModel {
  return {
    id,
    productId: `p-${id}`,
    variantId: null,
    productName: `Product ${id}`,
    quantity,
    unitPrice: { amount: 2, currency: 'PLN' },
    lineTotal: { amount: 2 * quantity, currency: 'PLN' },
    ...overrides,
  };
}

/** A save the test settles by hand, so what waits for it can be observed while it is in flight. */
interface Deferred {
  typed: string;
  resolve: (result: CartQuantitySaveResult) => void;
}

/** Every `saveQuantity` call, in order, per line. */
let saves: Array<Deferred & { itemId: string }> = [];
/** Every call that reached a server action through a `<form>`: `[action, fields]`. */
let posted: Array<[string, Record<string, string>]> = [];

function saveQuantityFor(itemId: string) {
  return (typed: string): Promise<CartQuantitySaveResult> =>
    new Promise((resolve) => {
      saves.push({ itemId, typed, resolve });
    });
}

function formAction(name: string) {
  return async (formData: FormData): Promise<void> => {
    const fields: Record<string, string> = {};
    formData.forEach((value, key) => {
      fields[key] = String(value);
    });
    posted.push([name, fields]);
  };
}

let host: HTMLElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  saves = [];
  posted = [];
  navigate.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.useRealTimers();
});

function mount(lines: CartLineViewModel[] = [line('a', 3), line('b', 5)]): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <CartQuantityAutosave strings={AUTOSAVE_STRINGS}>
        {lines.map((l) => (
          <CartLine
            key={l.id}
            line={l}
            updateAction={formAction('update')}
            removeAction={formAction('remove')}
            saveToListAction={formAction('saveToList')}
            saveQuantityAction={saveQuantityFor(l.id)}
            locale="en-US"
            strings={STRINGS}
          />
        ))}
        <CartCouponInput
          appliedCode={null}
          droppedOnRead={null}
          applyError={null}
          applyAction={formAction('applyCoupon')}
          clearAction={formAction('clearCoupon')}
          strings={COUPON_STRINGS}
        />
        <CartPrimaryCta
          cta="checkout"
          authenticated
          canTransact
          moderationMessage={null}
          submitAction={formAction('submitForApproval')}
          linesBlockCheckout={false}
          linesBlockedNote=""
          approvalBlockedNote=""
          strings={{
            checkout: 'Checkout',
            submitForApproval: 'Submit for approval',
            awaitingApproval: 'Awaiting approval',
            blockedByOrganization: 'Blocked',
          }}
        />
      </CartQuantityAutosave>,
    ),
  );
  return host;
}

function qtyInput(el: HTMLElement, itemId: string): HTMLInputElement {
  const form = el.querySelector<HTMLFormElement>(`form[data-cart-quantity-form="${itemId}"]`)!;
  return form.querySelector<HTMLInputElement>('input[name="quantity"]')!;
}

function stepper(el: HTMLElement, itemId: string, label: '+' | '−'): HTMLButtonElement {
  const form = el.querySelector<HTMLFormElement>(`form[data-cart-quantity-form="${itemId}"]`)!;
  return form.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

function status(el: HTMLElement, itemId: string): string {
  return el.querySelector(`#cart-line-${itemId}-qty-error`)?.textContent ?? '';
}

/** Type into a React-controlled input the way a browser does: set the native value, fire `input`. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Let the promise chains the components run settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function resolveSave(index: number, result: CartQuantitySaveResult = { ok: true }): Promise<void> {
  await act(async () => {
    saves[index]!.resolve(result);
  });
  await settle();
}

describe('a typed cart quantity saves itself (issue #1252)', () => {
  it('saves after a short pause in typing, and says saving, then saved', async () => {
    vi.useFakeTimers();
    const el = mount();
    type(qtyInput(el, 'a'), '7');
    expect(saves).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(saves.map((s) => [s.itemId, s.typed])).toEqual([['a', '7']]);
    expect(status(el, 'a')).toBe('Saving…');
    vi.useRealTimers();
    await resolveSave(0);
    expect(status(el, 'a')).toBe('Saved');
    expect(qtyInput(el, 'a').value).toBe('7');
  });

  it('does not save on the pause while the typed value is below the line floor', async () => {
    vi.useFakeTimers();
    const el = mount([line('a', 10, { minOrderQuantity: 10 })]);
    type(qtyInput(el, 'a'), '1');
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(saves).toHaveLength(0);
  });

  it('saves on blur', async () => {
    const el = mount();
    const input = qtyInput(el, 'a');
    type(input, '9');
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(saves.map((s) => s.typed)).toEqual(['9']);
  });

  it('saves on Enter at once, without posting the no-JS form', async () => {
    const el = mount();
    const input = qtyInput(el, 'a');
    type(input, '4');
    act(() => {
      input.form!.requestSubmit();
    });
    await settle();
    expect(saves.map((s) => s.typed)).toEqual(['4']);
    expect(posted).toEqual([]);
  });

  it('shows the refusal beside the line, keeps the typed value and marks the field invalid', async () => {
    const el = mount();
    const input = qtyInput(el, 'a');
    type(input, '2');
    act(() => input.form!.requestSubmit());
    await settle();
    await resolveSave(0, { ok: false, message: 'Below the minimum (10 pcs)' });
    expect(status(el, 'a')).toBe('Below the minimum (10 pcs)');
    expect(input.value).toBe('2');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('cart-line-a-qty-error');
  });

  it('typed quantity, then "+" on another line: the typed one is saved first, then the step', async () => {
    const el = mount();
    type(qtyInput(el, 'a'), '7');
    act(() => stepper(el, 'b', '+').click());
    await settle();
    expect(saves.map((s) => [s.itemId, s.typed])).toEqual([['a', '7']]);
    await resolveSave(0);
    expect(saves.map((s) => [s.itemId, s.typed])).toEqual([
      ['a', '7'],
      ['b', '6'],
    ]);
    expect(posted).toEqual([]);
  });

  it('typed quantity, then "+" on the same line: steps from what was typed', async () => {
    const el = mount();
    type(qtyInput(el, 'a'), '7');
    act(() => stepper(el, 'a', '+').click());
    await settle();
    expect(saves.map((s) => [s.itemId, s.typed])).toEqual([['a', '8']]);
    expect(qtyInput(el, 'a').value).toBe('8');
  });

  it('typed quantity, then a coupon: the coupon is applied only after the quantity is saved', async () => {
    const el = mount();
    type(qtyInput(el, 'a'), '7');
    const code = el.querySelector<HTMLInputElement>('input[name="code"]')!;
    type(code, 'SAVE10');
    const apply = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Apply')!;
    act(() => apply.click());
    await settle();
    expect(saves.map((s) => s.typed)).toEqual(['7']);
    expect(posted).toEqual([]);
    await resolveSave(0);
    expect(posted).toEqual([['applyCoupon', { code: 'SAVE10' }]]);
  });

  it('typed quantity, then checkout: checkout waits for the save', async () => {
    const el = mount();
    type(qtyInput(el, 'a'), '7');
    const checkout = el.querySelector<HTMLAnchorElement>('a[href="/checkout"]')!;
    act(() => checkout.click());
    await settle();
    expect(saves.map((s) => s.typed)).toEqual(['7']);
    expect(navigate).not.toHaveBeenCalled();
    await resolveSave(0);
    expect(navigate).toHaveBeenCalledWith('/checkout');
  });

  it('typed quantity refused on the way to checkout: stays on the cart and says why', async () => {
    const el = mount();
    type(qtyInput(el, 'a'), '2');
    const checkout = el.querySelector<HTMLAnchorElement>('a[href="/checkout"]')!;
    act(() => checkout.click());
    await settle();
    await resolveSave(0, { ok: false, message: 'Below the minimum (10 pcs)' });
    expect(navigate).not.toHaveBeenCalled();
    expect(status(el, 'a')).toBe('Below the minimum (10 pcs)');
    expect(document.activeElement).toBe(qtyInput(el, 'a'));
    // The refusal has been seen; a second click goes on.
    act(() => checkout.click());
    await settle();
    expect(navigate).toHaveBeenCalledWith('/checkout');
  });

  it('a thrown save reads as the generic failure', async () => {
    const el = mount([line('a', 3)]);
    const input = qtyInput(el, 'a');
    type(input, '6');
    act(() => input.form!.requestSubmit());
    await settle();
    await act(async () => {
      // A rejected server action — a network failure, not a refusal.
      saves[0]!.resolve(Promise.reject(new Error('offline')) as unknown as CartQuantitySaveResult);
    });
    await settle();
    expect(status(el, 'a')).toBe('Could not update the quantity.');
  });
});
