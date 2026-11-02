import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FORM_CONDITION_OPERATORS_BY_TYPE,
  type FormDefinition,
  type FormDefinitionIssue,
  type VisibilityRule,
} from '@endora-commerce/contracts';
import { ConditionRuleEditor } from '../../../../packages/modules/forms/src/admin/components/ConditionRuleEditor';
import { LANGUAGE, definition, en, renderForms } from './forms-fixtures';

/**
 * The condition editor (`specs/170-forms-module/` User Story 3, T066; FR-030, FR-031, research R-19):
 * conditions inside a group joined by the rule's connective and groups by the opposite one, the
 * operators each referenced type allows and no other, a condition naming a field that is gone shown
 * as broken, the publish refusals about the rule shown beside it, and every control reachable and
 * operable with the keyboard alone.
 */

const FORM: FormDefinition = definition({
  sections: [
    {
      id: 's1',
      columns: 1,
      fields: [
        { id: 'f_topic', type: 'select', key: 'topic', options: [{ id: 'o1', value: 'sales' }, { id: 'o2', value: 'support' }] },
        { id: 'f_qty', type: 'number', key: 'qty' },
        { id: 'f_tags', type: 'checkboxes', key: 'tags', options: [{ id: 'o3', value: 'doors' }] },
        { id: 'f_intro', type: 'content' },
        { id: 'f_owner', type: 'text', key: 'detail' },
      ],
    },
  ],
  texts: {
    [LANGUAGE]: {
      'fields.f_topic.label': 'Topic',
      'fields.f_topic.options.o1': 'Sales',
      'fields.f_topic.options.o2': 'Support',
      'fields.f_qty.label': 'Quantity',
      'fields.f_tags.label': 'Tags',
      'fields.f_owner.label': 'Details',
    },
  },
});

function Harness(props: {
  readonly initial?: VisibilityRule | undefined;
  readonly issues?: readonly FormDefinitionIssue[];
  readonly onChange?: (rule: VisibilityRule | undefined) => void;
}): ReactNode {
  const [rule, setRule] = useState<VisibilityRule | undefined>(props.initial);
  return (
    <ConditionRuleEditor
      definition={FORM}
      language={LANGUAGE}
      ownerId="f_owner"
      rule={rule}
      issues={props.issues ?? []}
      onChange={(next) => {
        setRule(next);
        props.onChange?.(next);
      }}
    />
  );
}

const renderEditor = (props: Parameters<typeof Harness>[0] = {}) => renderForms(<Harness {...props} />);

const operatorLabels = (type: keyof typeof FORM_CONDITION_OPERATORS_BY_TYPE) =>
  FORM_CONDITION_OPERATORS_BY_TYPE[type].map((operator) => en(`conditions.operator.${operator}`));

const optionsOf = (select: HTMLElement) => within(select).getAllByRole('option').map((option) => option.textContent);

describe('ConditionRuleEditor (T066)', () => {
  it('says an element without a rule is always shown, and adds a first condition', async () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    expect(screen.getByText(en('conditions.always'))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en('conditions.add') }));
    expect(onChange).toHaveBeenLastCalledWith({
      connective: 'and',
      groups: [[{ fieldId: 'f_topic', operator: 'equals', value: 'sales' }]],
    });
  });

  it('offers only input fields other than its own element', async () => {
    renderEditor({ initial: { connective: 'and', groups: [[{ fieldId: 'f_topic', operator: 'equals', value: 'sales' }]] } });
    const field = screen.getByRole('combobox', { name: en('conditions.field', { n: 1 }) });
    expect(optionsOf(field)).toEqual(['Topic', 'Quantity', 'Tags']);
  });

  it('joins conditions in a group by the connective and groups by the opposite one (FR-030)', async () => {
    const onChange = vi.fn();
    renderEditor({
      onChange,
      initial: {
        connective: 'and',
        groups: [
          [{ fieldId: 'f_topic', operator: 'equals', value: 'sales' }],
          [{ fieldId: 'f_qty', operator: 'greater_than', value: 3 }],
        ],
      },
    });
    expect(screen.getByText(en('conditions.between.or'))).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: en('conditions.connective') }), 'or');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ connective: 'or' }));
    expect(screen.getByText(en('conditions.between.and'))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: en('conditions.addToGroup', { n: 1 }) }));
    expect(onChange.mock.lastCall![0].groups[0]).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: en('conditions.addGroup') }));
    expect(onChange.mock.lastCall![0].groups).toHaveLength(3);
  });

  it('offers the operators the referenced type allows, and resets one the new type does not (FR-031)', async () => {
    const onChange = vi.fn();
    renderEditor({ onChange, initial: { connective: 'and', groups: [[{ fieldId: 'f_topic', operator: 'equals', value: 'sales' }]] } });
    const operator = () => screen.getByRole('combobox', { name: en('conditions.operator', { n: 1 }) });
    expect(optionsOf(operator())).toEqual(operatorLabels('select'));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: en('conditions.field', { n: 1 }) }), 'f_qty');
    expect(optionsOf(operator())).toEqual(operatorLabels('number'));
    expect(screen.getByRole('spinbutton', { name: en('conditions.value', { n: 1 }) })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: en('conditions.field', { n: 1 }) }), 'f_tags');
    expect(optionsOf(operator())).toEqual(operatorLabels('checkboxes'));
    expect(onChange).toHaveBeenLastCalledWith({
      connective: 'and',
      groups: [[{ fieldId: 'f_tags', operator: 'contains', value: 'doors' }]],
    });

    await userEvent.selectOptions(operator(), 'is_empty');
    expect(screen.queryByRole('combobox', { name: en('conditions.value', { n: 1 }) })).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({ connective: 'and', groups: [[{ fieldId: 'f_tags', operator: 'is_empty' }]] });
  });

  it('offers a choice field’s options as the value to compare with', () => {
    renderEditor({ initial: { connective: 'and', groups: [[{ fieldId: 'f_topic', operator: 'equals', value: 'support' }]] } });
    const value = screen.getByRole('combobox', { name: en('conditions.value', { n: 1 }) });
    expect(optionsOf(value)).toEqual(['Sales', 'Support']);
    expect((value as HTMLSelectElement).value).toBe('support');
  });

  it('shows a condition on a removed field as broken (edge case)', () => {
    renderEditor({ initial: { connective: 'and', groups: [[{ fieldId: 'f_gone', operator: 'equals', value: 'x' }]] } });
    expect(screen.getByText(en('conditions.broken'))).toBeInTheDocument();
    const field = screen.getByRole('combobox', { name: en('conditions.field', { n: 1 }) }) as HTMLSelectElement;
    expect(field.value).toBe('f_gone');
    expect(field.selectedOptions[0]!.textContent).toBe(en('conditions.removedField'));
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the publish refusals that are about this rule (cycle)', () => {
    renderEditor({
      initial: { connective: 'and', groups: [[{ fieldId: 'f_qty', operator: 'is_not_empty' }]] },
      issues: [
        { code: 'cyclic_visibility', elementId: 'f_owner', path: 'sections.0.fields.4.visibility' },
        { code: 'duplicate_key', elementId: 'f_qty', path: 'sections.0.fields.1.key' },
      ],
    });
    expect(screen.getByText(en('issues.cyclic_visibility'))).toBeInTheDocument();
    expect(screen.queryByText(en('issues.duplicate_key'))).toBeNull();
  });

  it('removes conditions, and the rule with its last one', async () => {
    const onChange = vi.fn();
    renderEditor({ onChange, initial: { connective: 'and', groups: [[{ fieldId: 'f_qty', operator: 'is_empty' }]] } });
    await userEvent.click(screen.getByRole('button', { name: en('conditions.remove', { n: 1 }) }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByText(en('conditions.always'))).toBeInTheDocument();
  });

  it('is operable with the keyboard alone, and keeps the focus where the change happened', async () => {
    const onChange = vi.fn();
    renderEditor({ onChange });
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: en('conditions.add') })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(1);
    // The new condition's field takes the focus; the connective sits before it.
    expect(screen.getByRole('combobox', { name: en('conditions.field', { n: 1 }) })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('combobox', { name: en('conditions.connective') })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('combobox', { name: en('conditions.operator', { n: 1 }) })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('combobox', { name: en('conditions.value', { n: 1 }) })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: en('conditions.remove', { n: 1 }) })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByRole('button', { name: en('conditions.add') })).toHaveFocus();
  });
});
