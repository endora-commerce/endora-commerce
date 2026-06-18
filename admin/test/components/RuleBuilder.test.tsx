import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PromotionRule } from '@b2b/contracts';
import { RuleBuilder } from '@/components/rule-builder/RuleBuilder';

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
});
