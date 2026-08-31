import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateFieldList } from '../../../../packages/modules/product_feeds/src/admin/components/TemplateFieldList';
import type { DraftField } from '../../../../packages/modules/product_feeds/src/admin/template-draft';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 067 / T082 — the template field list (FR-067, FR-069, SC-014).
 *
 * The product owner asked for a builder "an average user understands"; the
 * accessibility floor says the same builder has to work with no pointer at all.
 * Those two are the same requirement seen from two sides, and this file pins
 * the second one:
 *
 *  - a field can be moved from first to last **by keyboard alone**, through the
 *    handle's grab mode;
 *  - the live region exists from the first render, because a region created at
 *    the moment of its first message is never announced;
 *  - while the search filter is on, every reorder affordance is off — a
 *    reordered subset has no unambiguous meaning, and the operator is told why
 *    rather than left with buttons that quietly do the wrong thing.
 */

const BUNDLE = {
  product_feeds: {
    // Real sentences for the announcements, because what the live region says
    // is the requirement (FR-069) — not that it says something.
    'builder.reorder.grabbed': 'Grabbed {name}. Position {index} of {total}.',
    'builder.reorder.moving': '{name}, position {index} of {total}.',
    'builder.reorder.dropped': '{name} dropped. Now at position {index} of {total}.',
    'builder.reorder.cancelled': 'Reorder cancelled. {name} is back at position {index}.',
    'builder.reorder.moved': '{name} moved to position {index} of {total}.',
    'builder.reorder.atStart': '{name} is already first.',
    'builder.reorder.atEnd': '{name} is already last.',
    'builder.field.reorderHandle': 'Reorder {name}',
    'builder.field.menu': 'More actions for {name}',
    'builder.field.fallback': 'if empty: {value}',
  },
} as const;

const KEYS = passthroughBundle('product_feeds', [
  'builder.list.ariaLabel',
  'builder.field.notFilled',
  'builder.field.required',
  'builder.help.filterBlocksReorder',
  'builder.reorder.instructions',
  'builder.empty.filtered',
  'builder.empty.title',
  'builder.empty.subtitle',
  'builder.preview.empty.omitted',
]);

const CORE = passthroughBundle('core', ['reorder.moveUp', 'reorder.moveDown', 'reorder.groupLabel']);

const bundle = {
  ...CORE,
  product_feeds: { ...KEYS['product_feeds'], ...BUNDLE.product_feeds },
};

function field(over: Partial<DraftField> & { id: string; outputName: string }): DraftField {
  return {
    sourceKind: 'sku',
    sourceKey: null,
    constantValue: null,
    fallbackValue: null,
    providerRequired: false,
    transform: null,
    transformArg: null,
    helpKey: null,
    unbound: false,
    ...over,
  };
}

const FIELDS: DraftField[] = [
  field({ id: 'f1', outputName: 'id' }),
  field({ id: 'f2', outputName: 'title', sourceKind: 'name' }),
  field({ id: 'f3', outputName: 'price', sourceKind: 'price' }),
];

function renderList(over: Partial<Parameters<typeof TemplateFieldList>[0]> = {}) {
  const onChange = vi.fn();
  const onSelect = vi.fn();
  renderWithI18n(
    <TemplateFieldList
      fields={FIELDS}
      selectedFieldId="f1"
      onSelect={onSelect}
      onChange={onChange}
      onRemove={vi.fn()}
      onDuplicate={vi.fn()}
      search=""
      preview={null}
      problems={{}}
      disabled={false}
      {...over}
    />,
    bundle,
  );
  return { onChange, onSelect };
}

describe('TemplateFieldList', () => {
  it('mounts the live region before there is anything to announce', () => {
    renderList();
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('');
  });

  it('moves a field from first to last by keyboard alone', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();

    const handle = screen.getByRole('button', { name: 'Reorder id' });
    handle.focus();
    await user.keyboard('{ }');
    expect(screen.getByRole('status')).toHaveTextContent('Grabbed id. Position 1 of 3.');

    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenCalledWith([FIELDS[1], FIELDS[0], FIELDS[2]]);
    expect(screen.getByRole('status')).toHaveTextContent('id, position 2 of 3.');
  });

  it('gives the whole list exactly one tab stop', () => {
    renderList();
    const list = screen.getByRole('list', { name: 'builder.list.ariaLabel' });
    const tabbable = within(list)
      .getAllByRole('button')
      .filter((button) => button.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });

  it('numbers every row for a screen reader', () => {
    renderList();
    const rows = screen.getAllByRole('listitem');
    expect(rows[1]).toHaveAttribute('aria-posinset', '2');
    expect(rows[1]).toHaveAttribute('aria-setsize', '3');
    expect(rows[1]).toHaveAttribute('aria-roledescription');
  });

  it('turns every reorder affordance off while the search filter is on, and says why', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList({ search: 'ti' });

    expect(screen.getByText('builder.help.filterBlocksReorder')).toBeInTheDocument();
    // Only the matching row survives the filter.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    for (const button of screen.getAllByRole('button', { name: /reorder\.move/ })) {
      expect(button).toBeDisabled();
    }

    const handle = screen.getByRole('button', { name: 'Reorder title' });
    handle.focus();
    await user.keyboard('{ }{ArrowDown}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves a field with the touch buttons, and announces that too', async () => {
    const user = userEvent.setup();
    const { onChange } = renderList();
    const rows = screen.getAllByRole('listitem');
    const down = within(rows[0]!).getByRole('button', { name: 'reorder.moveDown' });
    await user.click(down);
    expect(onChange).toHaveBeenCalledWith([FIELDS[1], FIELDS[0], FIELDS[2]]);
    expect(screen.getByRole('status')).toHaveTextContent('id moved to position 2 of 3.');
  });

  it('shows an unbound field as needing attention, in words and not only in colour', () => {
    renderWithI18n(
      <TemplateFieldList
        fields={[field({ id: 'f9', outputName: 'gtin', sourceKind: 'attribute', unbound: true })]}
        selectedFieldId={null}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onDuplicate={vi.fn()}
        search=""
        preview={null}
        problems={{}}
        disabled={false}
      />,
      bundle,
    );
    expect(screen.getByText('builder.field.notFilled')).toBeInTheDocument();
  });

  it('disables every control for a read-only administrator, explained rather than hidden', () => {
    renderList({ disabled: true, disabledTitle: 'You need write access' });
    for (const button of screen.getAllByRole('button', { name: /reorder\.move/ })) {
      expect(button).toBeDisabled();
    }
  });
});
