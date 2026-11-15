// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShoppingListEditor } from '../../components/shopping-lists/ShoppingListEditor';

/**
 * Issue #1251 — the list page's one form, once JavaScript is running: it says while there
 * are unsaved edits, and a Save or a conversion with a quantity it would refuse is held
 * back in the browser — the row says why and takes focus — so the buyer's other typed
 * quantities are not lost to a round trip.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

const noop = async (_data: FormData): Promise<void> => undefined;
const save = vi.fn(async (_data: FormData): Promise<void> => undefined);
const toCart = vi.fn(async (_data: FormData): Promise<void> => undefined);
afterEach(() => {
  save.mockClear();
  toCart.mockClear();
});

function mount(props: Partial<Parameters<typeof ShoppingListEditor>[0]> = {}): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <ShoppingListEditor
        listId="l1"
        locale="en-US"
        name="Site A"
        canEdit
        canConvertToCart
        canConvertToQuote
        rows={[
          { id: 'i1', quantity: 4, note: null, product: <span>Bolt</span> },
          { id: 'i2', quantity: 2, note: null, product: <span>Nut</span> },
        ]}
        qtyErrorItemId={null}
        nameError={false}
        heading={<h3>Items</h3>}
        empty={<p>Empty</p>}
        saveListAction={save}
        removeAction={noop}
        convertAllToCartAction={toCart}
        convertSelectedToCartAction={noop}
        convertAllToRfqAction={noop}
        convertSelectedToRfqAction={noop}
        {...props}
      />,
    ),
  );
  return host;
}

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Presses a submit button of the list form, as a click does. */
async function press(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

const qty = (el: HTMLElement, id: string): HTMLInputElement =>
  el.querySelector<HTMLInputElement>(`input[name="quantity.${id}"]`)!;
const button = (el: HTMLElement, label: string): HTMLButtonElement =>
  [...el.querySelectorAll('button')].find((b) => b.textContent === label)! as HTMLButtonElement;
const status = (el: HTMLElement): string => el.querySelector('#sl-unsaved')!.textContent ?? '';

describe('ShoppingListEditor', () => {
  it('says nothing until a field changes, then that the changes are unsaved', () => {
    const el = mount();
    expect(el.querySelector('#sl-unsaved')!.getAttribute('role')).toBe('status');
    expect(status(el)).toBe('');
    type(qty(el, 'i1'), '5');
    type(qty(el, 'i2'), '7');
    expect(status(el)).toBe(
      'You have unsaved changes. Adding to the cart or a quote request saves them first.',
    );
    type(qty(el, 'i1'), '4');
    type(qty(el, 'i2'), '2');
    expect(status(el)).toBe('');
  });

  it('holds back a Save with a refused quantity, marks the row and focuses it', async () => {
    const el = mount();
    type(qty(el, 'i1'), '5');
    type(qty(el, 'i2'), '0');
    await press(button(el, 'Save changes'));
    expect(save).not.toHaveBeenCalled();
    const input = qty(el, 'i2');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('sl-qty-error-i2');
    expect(el.querySelector('#sl-qty-error-i2')!.textContent).toBe('Enter a whole number from 1 to 9999.');
    expect(document.activeElement).toBe(input);
    // The other typed quantity is still there.
    expect(qty(el, 'i1').value).toBe('5');
  });

  it('holds back a conversion with a refused quantity too', async () => {
    const el = mount();
    type(qty(el, 'i1'), '-2');
    await press(button(el, 'Convert all to cart'));
    expect(toCart).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(qty(el, 'i1'));
  });

  it('holds back an empty name and focuses it', async () => {
    const el = mount();
    const name = el.querySelector<HTMLInputElement>('input[name="name"]')!;
    type(name, '   ');
    await press(button(el, 'Save changes'));
    expect(save).not.toHaveBeenCalled();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(el.querySelector('#sl-name-error')!.textContent).toBe('Enter a name for the list.');
  });

  it('sends every typed quantity and the name in one Save, and clears a corrected row', async () => {
    const el = mount();
    type(qty(el, 'i2'), '0');
    await press(button(el, 'Save changes'));
    type(qty(el, 'i1'), '6');
    type(qty(el, 'i2'), '3');
    type(el.querySelector<HTMLInputElement>('input[name="name"]')!, 'Site B');
    expect(qty(el, 'i2').hasAttribute('aria-invalid')).toBe(false);
    await press(button(el, 'Save changes'));
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0]![0];
    expect(sent.get('name')).toBe('Site B');
    expect(sent.get('nameWas')).toBe('Site A');
    expect(sent.get('quantity.i1')).toBe('6');
    expect(sent.get('quantityWas.i1')).toBe('4');
    expect(sent.get('quantity.i2')).toBe('3');
  });

  it('a conversion pressed with unsaved quantities sends the typed ones', async () => {
    const el = mount();
    type(qty(el, 'i1'), '15');
    await press(button(el, 'Convert all to cart'));
    expect(save).not.toHaveBeenCalled();
    expect(toCart).toHaveBeenCalledTimes(1);
    expect(toCart.mock.calls[0]![0].get('quantity.i1')).toBe('15');
  });

  it('focuses the row a server-side refusal names when it mounts', () => {
    const el = mount({ qtyErrorItemId: 'i2' });
    expect(document.activeElement).toBe(qty(el, 'i2'));
    expect(qty(el, 'i2').getAttribute('aria-invalid')).toBe('true');
  });
});
