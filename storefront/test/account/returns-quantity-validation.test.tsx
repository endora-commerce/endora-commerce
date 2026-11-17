import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { ReturnFormLines } from '../../components/returns/ReturnFormLines';
import { orderBodyOf } from '../../lib/returns/returnForm';

/**
 * Feature 155, U4 (owner ruling S8 A) — the return form's quantity input. Its native `min`/`max`
 * made the browser refuse the whole form with its own bubble, worded in the browser's language.
 * The form asks the browser not to validate: the submit action already brings every quantity
 * into `1 … remaining` (Postel's Law), and the bound is stated beside the input, in the page's
 * language, and linked to it.
 *
 * No minimum hint: a return has no minimum order quantity.
 */
const line = {
  orderItemId: 'a',
  name: 'Bolt',
  remainingQty: 4,
  returnable: true,
  notReturnableText: null,
  selectable: true,
};

function qtyInput(html: string): string {
  const match = /<input[^>]*name="qty_a"[^>]*>/.exec(html);
  expect(match).not.toBeNull();
  return match![0];
}

describe('return form — quantity', () => {
  it('asks the browser not to validate and normalises on the server instead', () => {
    const page = readFileSync(resolve(import.meta.dirname, '../../app/(account)/returns/new/page.tsx'), 'utf8');
    // 180 research R-13: the form posts to the route handler, which normalises the quantity.
    expect(page).toMatch(/<form method="post" action="\/returns\/submit" encType="multipart\/form-data" noValidate/);
    const form = new FormData();
    form.set('orderId', '00000000-0000-4000-8000-000000000001');
    form.set('kind', 'return');
    for (const [id, qty] of [['a', '0'], ['b', 'x'], ['c', '2.7'], ['d', '9']] as const) {
      form.set(`include_${id}`, 'on');
      form.set(`qty_${id}`, qty);
      form.set(`remaining_${id}`, '4');
      form.set(`reason_${id}`, '00000000-0000-4000-8000-0000000000aa');
    }
    const { body } = orderBodyOf(form);
    expect((body as { lines: Array<{ quantity: number }> }).lines.map((l) => l.quantity)).toEqual([1, 1, 2, 4]);
  });

  it.each([
    ['en-US', 'Qty: Bolt', 'of 4'],
    ['pl-PL', 'Ilość: Bolt', 'z 4'],
  ])('%s: links the input to the bound it is held to', (locale, label, bound) => {
    const html = renderToString(<ReturnFormLines lines={[line]} reasons={[]} locale={locale} />).replaceAll(
      '<!-- -->',
      '',
    );
    const input = qtyInput(html);
    expect(input).toContain(`aria-label="${label}"`);
    expect(input).toContain('aria-describedby="qty-bound-a"');
    expect(html).toMatch(new RegExp(`<span id="qty-bound-a"[^>]*> ${bound}</span>`));
    expect(html).not.toMatch(/[Mm]inimum/);
  });
});
