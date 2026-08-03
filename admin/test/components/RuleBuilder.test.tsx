import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PromotionRule } from '@b2b/contracts';
import {
  RuleBuilder,
  type RuleBuilderBuiltinField,
  type StructuralRule,
} from '@/components/rule-builder/RuleBuilder';

describe('RuleBuilder', () => {
  it('converts the match-all node into a condition on "Add condition"', async () => {
    const onChange = vi.fn();
    render(<RuleBuilder value={{ kind: 'all' }} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /add condition/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as PromotionRule;
    expect(next.kind).toBe('condition');
  });

  it('renders an existing condition with its field and operator', () => {
    const rule: PromotionRule = {
      kind: 'condition',
      field: { kind: 'builtin', key: 'cartTotal' },
      op: 'gte',
      values: [500],
    };
    render(<RuleBuilder value={rule} onChange={vi.fn()} />);
    // The value text input echoes the configured values.
    expect(screen.getByDisplayValue('500')).toBeTruthy();
  });

  /**
   * Feature 067 / T064 — the component became parametric over its built-in
   * field catalogue so the product feed criteria panel could reuse it instead
   * of the admin growing a third rule builder (Principle IX).
   *
   * Promotions is the incumbent caller and passes **no** `builtinFields`. These
   * cases pin that path: same catalogue, same seed condition, same copy. If a
   * future edit to the generalisation changes any of them, it changes a live
   * promotions screen, and that is what this block exists to catch.
   */
  describe('the default catalogue (promotions regression)', () => {
    it('offers exactly today’s cart-context fields, in today’s order', () => {
      render(<RuleBuilder value={{ kind: 'all' }} onChange={vi.fn()} />);
      const rule: PromotionRule = {
        kind: 'condition',
        field: { kind: 'builtin', key: 'cartTotal' },
        op: 'gte',
        values: [500],
      };
      const { container } = render(<RuleBuilder value={rule} onChange={vi.fn()} />);
      const options = [...container.querySelectorAll('optgroup option')].map((o) => o.textContent);
      expect(options).toEqual([
        'cartTotal',
        'paymentMethod',
        'deliveryMethod',
        'deliveryCountry',
        'deliveryPostalCode',
        'organization',
        'customerGroup',
        'category',
      ]);
      expect(container.querySelector('optgroup')?.getAttribute('label')).toBe(
        'Cart & relationship',
      );
    });

    it('still seeds `cartTotal >= 0` and still says "Matches all carts."', async () => {
      const onChange = vi.fn();
      render(<RuleBuilder value={{ kind: 'all' }} onChange={onChange} />);
      expect(screen.getByText('Matches all carts.')).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: /add condition/i }));
      expect(onChange.mock.calls[0]![0]).toEqual({
        kind: 'condition',
        field: { kind: 'builtin', key: 'cartTotal' },
        op: 'gte',
        values: [0],
      });
    });

    it('still offers today’s operators for the seeded field', () => {
      const rule: PromotionRule = {
        kind: 'condition',
        field: { kind: 'builtin', key: 'cartTotal' },
        op: 'gte',
        values: [500],
      };
      const { container } = render(<RuleBuilder value={rule} onChange={vi.fn()} />);
      const selects = [...container.querySelectorAll('select')];
      const operators = [...selects[1]!.querySelectorAll('option')].map((o) => o.textContent);
      expect(operators).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between']);
    });
  });

  describe('a caller-supplied catalogue', () => {
    const PRODUCT_FIELDS: RuleBuilderBuiltinField[] = [
      { key: 'category', kind: 'set', ops: ['in', 'notIn'], label: 'Category' },
      { key: 'price', kind: 'number', ops: ['gte', 'lte', 'between'], label: 'Price' },
    ];

    it('replaces the built-in fields and their labels', () => {
      const rule: StructuralRule = {
        kind: 'condition',
        field: { kind: 'builtin', key: 'price' },
        op: 'gte',
        values: [10],
      };
      const { container } = render(
        <RuleBuilder
          value={rule}
          onChange={vi.fn()}
          builtinFields={PRODUCT_FIELDS}
          labels={{ builtinGroup: 'Product', matchAll: 'Every product in this channel.' }}
        />,
      );
      const options = [...container.querySelectorAll('optgroup option')].map((o) => o.textContent);
      expect(options).toEqual(['Category', 'Price']);
      expect(container.querySelector('optgroup')?.getAttribute('label')).toBe('Product');
    });

    it('seeds the first supplied field rather than a cart field', async () => {
      const onChange = vi.fn();
      render(
        <RuleBuilder
          value={{ kind: 'all' }}
          onChange={onChange}
          builtinFields={PRODUCT_FIELDS}
          labels={{ matchAll: 'Every product in this channel.' }}
        />,
      );
      expect(screen.getByText('Every product in this channel.')).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: /add condition/i }));
      expect(onChange.mock.calls[0]![0]).toEqual({
        kind: 'condition',
        field: { kind: 'builtin', key: 'category' },
        op: 'in',
        values: [],
      });
    });

    it('keeps a caller’s field kind when it is not in the catalogue at all', () => {
      // A rule saved before a field was removed must still render rather than
      // crash — the operator has to be able to see and fix it.
      const rule: StructuralRule = {
        kind: 'condition',
        field: { kind: 'attribute', attributeKey: 'colour' },
        op: 'eq',
        values: ['red'],
      };
      render(
        <RuleBuilder
          value={rule}
          onChange={vi.fn()}
          builtinFields={PRODUCT_FIELDS}
          attributeFields={[{ attributeKey: 'colour', label: 'Colour' }]}
        />,
      );
      expect(screen.getByDisplayValue('red')).toBeTruthy();
    });
  });
});
