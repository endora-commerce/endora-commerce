import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { GroupedLineRows, quoteSectionTotals } from '../../components/line-groups/GroupedLineRows';
import { describeRfqDiff } from '../../lib/quote-requests/describe-diff';
import type { RfqDiffEntry, RfqItem } from '../../lib/api/rfq';
import { formatMoney } from '../../lib/i18n/money';

/**
 * Feature 159, T040 — the storefront shows a quote's groups read-only
 * (`specs/159-quote-request-item-groups/contracts/ui.md` §3): a heading row per
 * non-empty group, its lines, its summary by the page's own totals rule, then
 * *Other items*; a quote with no non-empty group renders exactly the rows it
 * always did (SC-004). Asserted on the markup the server sends.
 */

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const EMPTY = '33333333-3333-4333-8333-333333333333';

function item(id: string, extra: Partial<RfqItem> = {}): RfqItem {
  return {
    id,
    productId: `p-${id}`,
    productName: `Product ${id}`,
    productSlug: null,
    variantId: null,
    variantLabel: null,
    quantity: 2,
    desiredUnitPrice: null,
    agreedUnitPrice: 10,
    lineNote: null,
    lineCurrency: 'PLN',
    discountPercent: null,
    groupId: null,
    position: 0,
    ...extra,
  };
}

const row = (line: RfqItem): ReactNode => (
  <tr key={line.id}>
    <td>{line.productName}</td>
  </tr>
);

function html(props: { groups: Array<{ id: string; name: string; position: number }>; items: RfqItem[]; locale?: string }): string {
  return renderToString(
    <table>
      <tbody>
        <GroupedLineRows
          groups={props.groups}
          lines={props.items}
          columnCount={5}
          locale={props.locale ?? 'en-US'}
          taxRate={0.23}
          currency="PLN"
          renderRow={row}
        />
      </tbody>
    </table>,
  );
}

const headings = (markup: string): string[] =>
  [...markup.matchAll(/<th colSpan="5" scope="colgroup"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]!);
const products = (markup: string): string[] => [...markup.matchAll(/<td>(Product [^<]*)<\/td>/g)].map((m) => m[1]!);

describe('GroupedLineRows', () => {
  it('with no non-empty group renders the line rows alone — the markup it always was (SC-004)', () => {
    const items = [item('a'), item('b')];
    const plain = renderToString(
      <table>
        <tbody>{items.map(row)}</tbody>
      </table>,
    );
    expect(html({ groups: [], items })).toBe(plain);
    // An empty group changes nothing either (FR-033, FR-034).
    expect(html({ groups: [{ id: EMPTY, name: 'Empty', position: 0 }], items })).toBe(plain);
  });

  it('heads each non-empty group in order, then Other items; an empty group never shows', () => {
    const markup = html({
      groups: [
        { id: G2, name: 'Floor 1', position: 1 },
        { id: G1, name: 'Ground floor', position: 0 },
        { id: EMPTY, name: 'Empty', position: 2 },
      ],
      items: [
        item('u'),
        item('g2', { groupId: G2 }),
        item('g1b', { groupId: G1, position: 1 }),
        item('g1a', { groupId: G1, position: 0 }),
      ],
    });
    expect(headings(markup)).toEqual(['Ground floor', 'Floor 1', 'Other items']);
    expect(products(markup)).toEqual(['Product g1a', 'Product g1b', 'Product g2', 'Product u']);
    expect(markup).not.toContain('Empty');
  });

  it('summarises each section by the page rule: agreed prices, net, VAT and gross', () => {
    const markup = html({
      groups: [{ id: G1, name: 'Ground floor', position: 0 }],
      items: [item('a', { groupId: G1 }), item('b', { groupId: G1, agreedUnitPrice: 5, quantity: 4 }), item('c')],
    });
    // 2 × 10 + 4 × 5 = 40 net; 9.20 VAT; 49.20 gross.
    const pln = (n: number): string => formatMoney(n, 'PLN');
    expect(markup).toContain(`2 items · net ${pln(40)} · VAT ${pln(9.2)} · gross ${pln(49.2)}`);
    expect(markup).toContain(`1 item · net ${pln(20)}`);
  });

  it('falls back to desired prices when every line has one, and states only the count otherwise', () => {
    expect(
      quoteSectionTotals(
        [item('a', { agreedUnitPrice: null, desiredUnitPrice: 3 }), item('b', { agreedUnitPrice: null, desiredUnitPrice: 2 })],
        0.23,
      ),
    ).toEqual({ count: 2, net: 10, vat: 2.3, gross: 12.3 });
    expect(
      quoteSectionTotals([item('a', { agreedUnitPrice: null, desiredUnitPrice: 3 }), item('b', { agreedUnitPrice: null })], 0.23),
    ).toEqual({ count: 2, net: null, vat: null, gross: null });
  });

  it('speaks Polish: Pozostałe pozycje and the plural forms', () => {
    const markup = html({
      locale: 'pl-PL',
      groups: [{ id: G1, name: 'Parter', position: 0 }],
      items: [
        item('a', { groupId: G1 }),
        item('b', { groupId: G1 }),
        item('c', { groupId: G1 }),
        item('d'),
      ],
    });
    expect(headings(markup)).toEqual(['Parter', 'Pozostałe pozycje']);
    expect(markup).toContain('3 pozycje · netto');
    expect(markup).toContain('1 pozycja · netto');
  });

  it('describes the grouping notice of the comparison, in both languages', () => {
    expect(describeRfqDiff({ kind: 'grouping' }, 'en-US')).toBe('The arrangement of the lines changed.');
    expect(describeRfqDiff({ kind: 'grouping' }, 'pl-PL')).toBe('Zmieniono układ pozycji.');
    // The other kinds read as they did.
    expect(describeRfqDiff({ kind: 'line_removed', productId: 'p', productName: 'Bolt' }, 'pl-PL')).toBe('Usunięto: Bolt');
  });

  it('names the group of a product on several lines, so the entry says which line (N-32)', () => {
    const entry = { kind: 'line_quantity', productId: 'p', productName: 'Bolt', before: 5, after: 3 } as const;
    expect(describeRfqDiff({ ...entry, groupName: 'Hall A' }, 'pl-PL')).toBe('Bolt (Hall A): ilość 5 → 3');
    expect(describeRfqDiff({ ...entry, groupName: null }, 'pl-PL')).toBe('Bolt (Pozostałe pozycje): ilość 5 → 3');
    expect(describeRfqDiff({ ...entry, groupName: null }, 'en-US')).toBe('Bolt (Other items): quantity 5 → 3');
    expect(
      describeRfqDiff(
        { kind: 'line_added', productId: 'p', productName: 'Bolt', groupName: 'Hall B', quantity: 2, agreedUnitPrice: null },
        'pl-PL',
      ),
    ).toBe('Dodano: Bolt (Hall B) × 2');
    // A product on one line is named as before.
    expect(describeRfqDiff(entry, 'pl-PL')).toBe('Bolt: ilość 5 → 3');
  });
});

/**
 * Issue #85: the comparison's line and note sentences were Polish templates, so
 * an English shop read `Bolt (Other items): ilość 5 → 3` — the group name
 * translated and the sentence around it not. Every kind is a catalogue key now,
 * asserted in both languages with the values filled.
 */
describe('describeRfqDiff speaks the page language', () => {
  const cases = [
    {
      entry: { kind: 'header_note', before: 'old', after: null },
      en: 'Notes: “old” → “—”',
      pl: 'Uwagi: „old” → „—”',
    },
    {
      entry: { kind: 'line_added', productId: 'p', productName: 'Bolt', quantity: 2, agreedUnitPrice: null },
      en: 'Added: Bolt × 2',
      pl: 'Dodano: Bolt × 2',
    },
    {
      entry: { kind: 'line_removed', productId: 'p', productName: 'Bolt' },
      en: 'Removed: Bolt',
      pl: 'Usunięto: Bolt',
    },
    {
      entry: { kind: 'line_quantity', productId: 'p', productName: 'Bolt', before: 5, after: 3 },
      en: 'Bolt: quantity 5 → 3',
      pl: 'Bolt: ilość 5 → 3',
    },
    {
      entry: { kind: 'line_agreed_unit_price', productId: 'p', productName: 'Bolt', before: null, after: null },
      en: 'Bolt: price — → —',
      pl: 'Bolt: cena — → —',
    },
  ] as const;

  for (const { entry, en, pl } of cases) {
    it(`describes ${entry.kind} in English and in Polish`, () => {
      expect(describeRfqDiff(entry as RfqDiffEntry, 'en-US')).toBe(en);
      expect(describeRfqDiff(entry as RfqDiffEntry, 'pl-PL')).toBe(pl);
    });
  }

  it('names the agreed price in the line-added sentence in both languages', () => {
    const entry: RfqDiffEntry = {
      kind: 'line_added',
      productId: 'p',
      productName: 'Bolt',
      quantity: 2,
      agreedUnitPrice: 1.5,
    };
    expect(describeRfqDiff(entry, 'en-US')).toMatch(/^Added: Bolt × 2 at \S/);
    expect(describeRfqDiff(entry, 'pl-PL')).toMatch(/^Dodano: Bolt × 2 po \S/);
  });

  it('keeps a product name that looks like a replacement pattern verbatim', () => {
    const entry = { kind: 'line_removed', productId: 'p', productName: "Bolt $& {line} $'" } as const;
    expect(describeRfqDiff(entry, 'en-US')).toBe("Removed: Bolt $& {line} $'");
  });
});
