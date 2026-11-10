// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { LINE_QUANTITY_MAX } from '@endora-commerce/contracts';
import { DraftLine, strings } from '../../components/rfq/RfqDraftView';
import { PdpStickyBuyBar } from '../../components/mobile/PdpStickyBuyBar';
import type { RfqDraftItem } from '../../lib/rfqDraft';

/**
 * Issue #351, architect ruling R4 — where a quantity is committed without a
 * form submit (the quote draft line, the mobile buy bar's stepper), a value
 * typed past `LINE_QUANTITY_MAX` is clamped, and the clamped value is written
 * back into the visible field at once, so the correction is seen rather than
 * applied behind the buyer's back.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | null = null;

afterEach(() => {
  host?.remove();
  host = null;
});

function mount(node: React.ReactElement): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return host;
}

/** Type into a controlled input the way a browser does: set the native value, then fire `input`. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const line: RfqDraftItem = {
  productId: 'prod-1',
  slug: 'widget',
  name: 'Widget',
  unitPrice: { amount: 12, currency: 'PLN' },
  proposedUnitPrice: null,
  quantity: 3,
};

function Draft({ saved }: { saved: number[] }) {
  const [quantity, setQuantity] = useState(line.quantity);
  return (
    <DraftLine
      line={{ ...line, quantity }}
      t={strings('en-US')}
      locale="en-US"
      minimum={null}
      proposalsAllowed={false}
      onQty={(q): void => {
        saved.push(q);
        setQuantity(q);
      }}
      onProposedPrice={(): void => undefined}
      onRemove={(): void => undefined}
    />
  );
}

describe('a quantity typed past the bound is clamped where it is seen (R4)', () => {
  it('the quote draft line saves the bound and shows it', () => {
    const saved: number[] = [];
    const el = mount(<Draft saved={saved} />);
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Quantity"]')!;
    type(input, String(LINE_QUANTITY_MAX + 5));
    expect(saved.at(-1)).toBe(LINE_QUANTITY_MAX);
    expect(input.value).toBe(String(LINE_QUANTITY_MAX));
  });

  it('the quote draft line keeps a typed value within the bound as typed', () => {
    const saved: number[] = [];
    const el = mount(<Draft saved={saved} />);
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Quantity"]')!;
    type(input, '15');
    expect(saved.at(-1)).toBe(15);
    expect(input.value).toBe('15');
  });

  it('the mobile buy bar shows the bound', () => {
    const el = mount(
      <PdpStickyBuyBar
        locale="en-US"
        productId="p"
        addToCartAction={async () => ({ status: 'idle' })}
        addToCartLabel="Add"
      />,
    );
    const input = el.querySelector<HTMLInputElement>('input[name="quantity"]')!;
    type(input, String(LINE_QUANTITY_MAX + 5));
    expect(input.value).toBe(String(LINE_QUANTITY_MAX));
  });
});
