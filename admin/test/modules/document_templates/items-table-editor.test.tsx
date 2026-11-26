import { StrictMode, useState, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { DocumentCollectionDetail } from '@endora-commerce/contracts';
import { adminSession, everyDeclaredModule, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../../helpers/axe';
import documentTemplatesEn from '../../../../packages/modules/document_templates/i18n/en.json';
import { DocumentCollectionsProvider } from '../../../../packages/modules/document_templates/src/admin/blocks/items-table/collections-context';
import { ColumnsField } from '../../../../packages/modules/document_templates/src/admin/blocks/items-table/ColumnsField';
import { DetailRowField } from '../../../../packages/modules/document_templates/src/admin/blocks/items-table/DetailRowField';
import { TotalsField } from '../../../../packages/modules/document_templates/src/admin/blocks/items-table/TotalsField';
import { GroupingField } from '../../../../packages/modules/document_templates/src/admin/blocks/items-table/GroupingField';
import { ItemsTableCanvas } from '../../../../packages/modules/document_templates/src/admin/blocks/items-table/canvas';

/**
 * `specs/153-quote-request-pdf-template/` T023 — the Line items table editor
 * (`contracts/admin-ui.md` §2): the grouped field picker with search and the
 * Internal badge (owner answer Q7), add / edit / remove, the announced reorder,
 * the 16-column limit, the unknown-field flag, the visibility rules, the
 * detail row, totals and grouping writing `data-model.md` §2's shape, and the
 * canvas hiding columns as the PDF would, with the shared formatter.
 */

const BUNDLE = {
  document_templates: documentTemplatesEn as Record<string, string>,
  ...passthroughBundle('core', ['reorder.groupLabel', 'reorder.moveUp', 'reorder.moveDown']),
};

const LINES: DocumentCollectionDetail = {
  key: 'lines',
  labelKey: 'documentTypes.quoteRequest.collections.lines',
  ownerModule: 'quote_requests',
  fields: [
    { path: 'row.number', label: 'No.', valueKind: 'number', group: 'line', audience: 'customer', defaultFormat: { decimals: 0 }, defaultAlign: 'right' },
    { path: 'productName', label: 'Product', valueKind: 'text', group: 'line', audience: 'customer', linkPath: 'productUrl' },
    { path: 'listUnitPrice', label: 'List price', valueKind: 'money', group: 'pricing', audience: 'internal', defaultFormat: { decimals: 2 } },
    { path: 'discountPercent', label: 'Discount %', valueKind: 'percent', group: 'pricing', audience: 'internal', defaultFormat: { decimals: 1 } },
    { path: 'lineNet', label: 'Net value', valueKind: 'money', group: 'pricing', audience: 'customer', defaultFormat: { decimals: 2 } },
    { path: 'lineNote', label: 'Line note', valueKind: 'text', group: 'line', audience: 'customer' },
    { path: 'attributes.brand', label: 'Brand', valueKind: 'text', group: 'product', audience: 'customer', sampleValue: { kind: 'text', value: 'Example' } },
    { path: 'productUrl', label: 'Product page URL', valueKind: 'text', group: 'line', audience: 'customer', linkPath: 'productUrl' },
  ],
  summaryFields: [
    { path: 'discountTotal', label: 'Discounts', valueKind: 'money', group: 'pricing', audience: 'internal' },
    { path: 'netTotal', label: 'Total net', valueKind: 'money', group: 'pricing', audience: 'customer' },
  ],
  sampleItems: [
    { values: { 'row.number': { kind: 'number', value: 1 }, productName: { kind: 'text', value: 'Bolt' }, listUnitPrice: { kind: 'money', amount: 1234.5, currency: 'USD' }, discountPercent: null, lineNet: { kind: 'money', amount: 10, currency: 'USD' }, lineNote: { kind: 'text', value: 'Urgent' }, 'attributes.brand': { kind: 'text', value: 'Example' }, productUrl: { kind: 'text', value: 'https://shop.example.com/p/bolt' } } },
    { values: { 'row.number': { kind: 'number', value: 2 }, productName: { kind: 'text', value: 'Nut' }, listUnitPrice: null, discountPercent: null, lineNet: { kind: 'money', amount: 2.5, currency: 'USD' }, lineNote: null, 'attributes.brand': { kind: 'text', value: 'Example' } } },
  ],
  sampleSummary: { netTotal: { kind: 'money', amount: 12.5, currency: 'USD' }, discountTotal: null },
  sampleSections: [],
};

const column = (id: string, field: string, over: Record<string, unknown> = {}) => ({
  id,
  field,
  label: '',
  width: 'auto',
  align: 'auto',
  format: {},
  emptyText: '',
  visibleWhen: { op: 'always' },
  ...over,
});

/** A field rendered as Puck would, its value kept in state so a test reads what was written. */
function Harness<T>({ initial, render, onValue }: { initial: T; render: (value: T, onChange: (next: T) => void) => ReactElement; onValue: (value: T) => void }): ReactElement {
  const [value, setValue] = useState<T>(initial);
  return render(value, (next) => {
    onValue(next);
    setValue(next);
  });
}

function renderIn(ui: ReactElement): HTMLElement {
  return renderWithSession(
    <StrictMode>
      <DocumentCollectionsProvider value={[LINES]} language="en-US">
        {ui}
      </DocumentCollectionsProvider>
    </StrictMode>,
    { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: everyDeclaredModule() }), bundle: BUNDLE },
  ).container;
}

describe('Columns field', () => {
  it('lists the columns with their field, Internal badge and an unknown field flagged (FR-026, FR-037)', async () => {
    const container = renderIn(
      <ColumnsField value={[column('c1', 'productName'), column('c2', 'listUnitPrice'), column('c3', 'attributes.gone')]} onChange={() => undefined} />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Product')).toBeTruthy();
    expect(within(rows[1]!).getByText('Internal')).toBeTruthy();
    expect(within(rows[2]!).getByText('Unknown field')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('adds a column from the grouped, searchable picker with the field’s default format', () => {
    let written: unknown[] = [];
    renderIn(
      <Harness initial={[column('c1', 'productName')] as unknown[]} onValue={(v) => (written = v)} render={(value, onChange) => <ColumnsField value={value} onChange={onChange} />} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    const picker = screen.getByRole('group', { name: 'Choose a field' });
    expect(within(picker).getByRole('region', { name: 'Pricing' })).toBeTruthy();
    expect(within(picker).getByRole('region', { name: 'Product attributes' })).toBeTruthy();
    fireEvent.change(within(picker).getByLabelText('Search fields'), { target: { value: 'list' } });
    expect(within(picker).queryByText('Product')).toBeNull();
    fireEvent.click(within(picker).getByRole('button', { name: /List price/ }));
    expect(written).toEqual([
      column('c1', 'productName'),
      { id: 'c2', field: 'listUnitPrice', label: '', width: 'auto', align: 'auto', format: { decimals: 2 }, emptyText: '', visibleWhen: { op: 'always' } },
    ]);
  });

  it('moves a column down by button, announcing the move', () => {
    let written: unknown[] = [];
    renderIn(
      <Harness
        initial={[column('c1', 'productName'), column('c2', 'lineNet')] as unknown[]}
        onValue={(v) => (written = v)}
        render={(value, onChange) => <ColumnsField value={value} onChange={onChange} />}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'reorder.moveDown' })[0]!);
    expect((written as { field: string }[]).map((c) => c.field)).toEqual(['lineNet', 'productName']);
    expect(screen.getByText('Product moved to position 2 of 2.')).toBeTruthy();
  });

  it('edits a column inline: label, currency display and the visibility rule', () => {
    let written: Record<string, unknown>[] = [];
    renderIn(
      <Harness
        initial={[column('c1', 'listUnitPrice')] as Record<string, unknown>[]}
        onValue={(v) => (written = v)}
        render={(value, onChange) => <ColumnsField value={value} onChange={onChange} />}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit column List price' }));
    fireEvent.change(screen.getByLabelText('Header label'), { target: { value: 'Cennik' } });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'code' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Only if any line has a value' }));
    expect(written[0]).toMatchObject({ label: 'Cennik', format: { currencyDisplay: 'code' }, visibleWhen: { op: 'any_has_value' } });
  });

  it('issue #1904 — a column whose field declares a page offers Print as a link, off until ticked', () => {
    let written: Record<string, unknown>[] = [];
    renderIn(
      <Harness
        initial={[column('c1', 'productName'), column('c2', 'lineNote')] as Record<string, unknown>[]}
        onValue={(v) => (written = v)}
        render={(value, onChange) => <ColumnsField value={value} onChange={onChange} />}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit column Line note' }));
    expect(screen.queryByRole('checkbox', { name: /Print as a link/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit column Line note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit column Product' }));
    const option = screen.getByRole('checkbox', { name: 'Print as a link to Product page URL' }) as HTMLInputElement;
    expect(option.checked).toBe(false);
    fireEvent.click(option);
    expect(written[0]).toMatchObject({ field: 'productName', link: true });
    expect(written[1]).not.toHaveProperty('link');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Print as a link to Product page URL' }));
    expect(written[0]).toMatchObject({ link: false });
  });

  it('refuses a 17th column with the reason as text, and keeps the last column', () => {
    renderIn(<ColumnsField value={Array.from({ length: 16 }, (_, i) => column(`c${i}`, 'productName'))} onChange={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Add column' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('A table holds at most 16 columns. Remove one to add another.')).toBeTruthy();
  });

  it('cannot remove the only column', () => {
    renderIn(<ColumnsField value={[column('c1', 'productName')]} onChange={() => undefined} />);
    expect((screen.getByRole('button', { name: 'Remove column Product' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Detail row, totals and grouping fields — the stored shape (data-model §2)', () => {
  it('the detail row: enabled, an entry from the picker with has_value', () => {
    let written: Record<string, unknown> = {};
    renderIn(
      <Harness
        initial={{ enabled: false, entries: [], separator: ' · ', italics: true, fontSize: 8 } as Record<string, unknown>}
        onValue={(v) => (written = v)}
        render={(value, onChange) => <DetailRowField value={value} onChange={onChange} />}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show a detail row under each line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    fireEvent.click(screen.getByRole('button', { name: /Line note/ }));
    expect(written).toEqual({
      enabled: true,
      entries: [{ field: 'lineNote', label: '', visibleWhen: { op: 'has_value' } }],
      separator: ' · ',
      italics: true,
      fontSize: 8,
    });
  });

  it('totals: added from the summary fields, Internal marked, emphasis', () => {
    let written: Record<string, unknown>[] = [];
    renderIn(
      <Harness initial={[] as Record<string, unknown>[]} onValue={(v) => (written = v)} render={(value, onChange) => <TotalsField value={value} onChange={onChange} />} />,
    );
    expect(screen.getByRole('option', { name: 'Discounts (Internal)' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Add total'), { target: { value: 'netTotal' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Emphasise' }));
    expect(written).toEqual([{ field: 'netTotal', label: '', visibleWhen: { op: 'has_value' }, emphasis: true }]);
  });

  it('grouping by field: a field, then a numeric subtotal — the 153 shape (159 FR-041)', () => {
    let written: unknown = undefined;
    renderIn(
      <Harness initial={null as unknown} onValue={(v) => (written = v)} render={(value, onChange) => <GroupingField value={value} onChange={onChange} />} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'By field' }));
    expect(written).toEqual({ field: 'productName', emptyLabel: '', subtotalField: null, subtotalLabel: '' });
    fireEvent.change(screen.getByLabelText('Group lines by'), { target: { value: 'attributes.brand' } });
    const subtotal = screen.getByLabelText('Subtotal');
    expect(within(subtotal).queryByRole('option', { name: 'Product' })).toBeNull();
    fireEvent.change(subtotal, { target: { value: 'lineNet' } });
    expect(written).toEqual({ field: 'attributes.brand', emptyLabel: '', subtotalField: 'lineNet', subtotalLabel: '' });
  });
});

describe('the Grouping field — Document’s groups, By field, No grouping (159 FR-041)', () => {
  const grouped: DocumentCollectionDetail = {
    ...LINES,
    sampleSections: [
      { key: 'g1', kind: 'group', label: 'Hall A', itemIndexes: [0], summary: { netTotal: { kind: 'money', amount: 10, currency: 'USD' }, discountTotal: null } },
      { key: 'ungrouped', kind: 'ungrouped', label: null, itemIndexes: [1], summary: { netTotal: { kind: 'money', amount: 2.5, currency: 'USD' }, discountTotal: null } },
    ],
  };
  function renderGrouping(initial: unknown, collection: DocumentCollectionDetail = grouped): { read: () => unknown; container: HTMLElement } {
    let written: unknown = initial;
    const container = renderWithSession(
      <StrictMode>
        <DocumentCollectionsProvider value={[collection]} language="en-US">
          <Harness initial={initial} onValue={(v) => (written = v)} render={(value, onChange) => <GroupingField value={value} onChange={onChange} />} />
        </DocumentCollectionsProvider>
      </StrictMode>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: everyDeclaredModule() }), bundle: BUNDLE },
    ).container;
    return { read: () => written, container };
  }

  it('a table never configured (null) reads as Document’s groups, with its two options', async () => {
    const { container } = renderGrouping(null);
    expect((screen.getByRole('radio', { name: "Document's groups" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Other items heading') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('checkbox', { name: 'Show item count' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('Group lines by')).toBeNull();
    expect(screen.queryByText('This document type has no groups.')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('touching an option writes the sections shape', () => {
    const { read } = renderGrouping(null);
    fireEvent.change(screen.getByLabelText('Other items heading'), { target: { value: 'Rest' } });
    expect(read()).toEqual({ by: 'sections', otherItemsLabel: 'Rest', showItemCount: true });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show item count' }));
    expect(read()).toEqual({ by: 'sections', otherItemsLabel: 'Rest', showItemCount: false });
  });

  it('No grouping writes { by: none }; choosing Document’s groups again writes null', () => {
    const { read } = renderGrouping({ by: 'sections', otherItemsLabel: 'Rest', showItemCount: false });
    fireEvent.click(screen.getByRole('radio', { name: 'No grouping' }));
    expect(read()).toEqual({ by: 'none' });
    expect(screen.queryByLabelText('Other items heading')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: "Document's groups" }));
    expect(read()).toBeNull();
  });

  it('a stored 153 field grouping reads as By field with its controls', () => {
    renderGrouping({ field: 'attributes.brand', emptyLabel: 'Other', subtotalField: 'lineNet', subtotalLabel: 'Sum' });
    expect((screen.getByRole('radio', { name: 'By field' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Group lines by') as HTMLSelectElement).value).toBe('attributes.brand');
    expect((screen.getByLabelText('Group name for lines without a value') as HTMLInputElement).value).toBe('Other');
  });

  it('a document type with no groups says so under Document’s groups', () => {
    renderGrouping(null, LINES);
    expect(screen.getByText('This document type has no groups.')).toBeTruthy();
  });

  it('read-only: every control disabled', () => {
    let written: unknown = 'untouched';
    renderIn(<GroupingField value={null} readOnly onChange={(v) => (written = v)} />);
    for (const radio of screen.getAllByRole('radio')) expect((radio as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Other items heading') as HTMLInputElement).disabled).toBe(true);
    expect(written).toBe('untouched');
  });
});

describe('the canvas — as the PDF prints it', () => {
  it('formats with the shared formatter and fades a column its rule hides on the sample', () => {
    renderIn(
      <ItemsTableCanvas
        columns={[
          column('c1', 'row.number'),
          column('c2', 'listUnitPrice'),
          column('c3', 'discountPercent', { visibleWhen: { op: 'any_has_value' } }),
          column('c4', 'lineNote', { visibleWhen: { op: 'never' } }),
        ]}
        detailRow={{ enabled: true, entries: [{ field: 'lineNote', label: 'Note', visibleWhen: { op: 'has_value' } }] }}
        totals={[
          { field: 'netTotal', label: '', visibleWhen: { op: 'has_value' }, emphasis: true },
          { field: 'discountTotal', label: '', visibleWhen: { op: 'has_value' } },
        ]}
      />,
    );
    expect(screen.getByText('$1,234.50')).toBeTruthy();
    expect(screen.getAllByText('(hidden in this sample)')).toHaveLength(2);
    expect(screen.getByText('Note: Urgent')).toBeTruthy();
    expect(screen.getByText('Total net')).toBeTruthy();
    expect(screen.queryByText('Discounts')).toBeNull();
  });
});

describe('the canvas — a column printed as a link (issue #1904)', () => {
  it('draws a linked value as the PDF does — the link colour, the address on hover — and a line without one as text', () => {
    const container = renderIn(<ItemsTableCanvas columns={[column('c1', 'productName', { link: true })]} />);
    const bolt = within(container).getByText('Bolt');
    expect(bolt.getAttribute('title')).toBe('https://shop.example.com/p/bolt');
    expect(bolt.getAttribute('data-link')).toBe('true');
    expect(within(container).getByText('Nut').getAttribute('data-link')).toBeNull();
  });

  it('draws plain text with the option off', () => {
    const container = renderIn(<ItemsTableCanvas columns={[column('c1', 'productName')]} />);
    expect(container.querySelector('[data-link]')).toBeNull();
  });
});

describe('the canvas — the sample’s groups (159 §4)', () => {
  const grouped: DocumentCollectionDetail = {
    ...LINES,
    sampleSections: [
      { key: 'g1', kind: 'group', label: 'Hall A', itemIndexes: [0], summary: { netTotal: { kind: 'money', amount: 10, currency: 'USD' }, discountTotal: null } },
      { key: 'ungrouped', kind: 'ungrouped', label: null, itemIndexes: [1], summary: { netTotal: { kind: 'money', amount: 2.5, currency: 'USD' }, discountTotal: null } },
    ],
  };
  const canvas = (props: Record<string, unknown>, collection: DocumentCollectionDetail = grouped, language = 'en-US') =>
    renderWithSession(
      <StrictMode>
        <DocumentCollectionsProvider value={[collection]} language={language}>
          <ItemsTableCanvas columns={[column('c1', 'row.number'), column('c2', 'productName')]} totals={[{ field: 'netTotal', label: '', visibleWhen: { op: 'has_value' } }]} {...props} />
        </DocumentCollectionsProvider>
      </StrictMode>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: everyDeclaredModule() }), bundle: BUNDLE },
    ).container;
  const rows = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('tbody')[0]!.querySelectorAll('tr')).map((tr) => Array.from(tr.querySelectorAll('th,td')).map((c) => c.textContent));

  it('draws each section with its heading, item count and subtotal rows, as the PDF prints them', () => {
    const container = canvas({ grouping: null });
    expect(rows(container)).toEqual([
      ['Hall A · 1 item'],
      ['1', 'Bolt'],
      ['Total net', '$10.00'],
      ['Other items · 1 item'],
      ['2', 'Nut'],
      ['Total net', '$2.50'],
    ]);
  });

  it('the Other items heading and the count follow the settings; Polish defaults in a Polish layout', () => {
    expect(rows(canvas({ grouping: { by: 'sections', otherItemsLabel: 'Rest', showItemCount: false }, totals: [] }))).toEqual([
      ['Hall A'],
      ['1', 'Bolt'],
      ['Rest'],
      ['2', 'Nut'],
    ]);
    expect(rows(canvas({ grouping: null, totals: [] }, grouped, 'pl-PL'))[2]).toEqual(['Pozostałe pozycje · 1 pozycja']);
  });

  it('No grouping and By field ignore the sample’s groups', () => {
    expect(rows(canvas({ grouping: { by: 'none' } }))).toEqual([
      ['1', 'Bolt'],
      ['2', 'Nut'],
    ]);
    expect(rows(canvas({ grouping: { field: 'attributes.brand' } }))[0]).toEqual(['Example']);
  });

  it('a type with no groups draws the table flat', () => {
    expect(rows(canvas({ grouping: null }, LINES))).toEqual([
      ['1', 'Bolt'],
      ['2', 'Nut'],
    ]);
  });
});
