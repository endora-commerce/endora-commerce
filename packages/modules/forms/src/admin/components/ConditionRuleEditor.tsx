import { Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import {
  FORM_CONDITION_OPERATORS_BY_TYPE,
  FORMS_LIMITS,
  type FormCondition,
  type FormConditionOperator,
  type FormDefinition,
  type FormDefinitionIssue,
  type FormDefinitionIssueCode,
  type FormInputField,
  type VisibilityRule,
} from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { isInputField, textOf } from '../lib/definition-draft.js';

/**
 * The visibility rule of one field or section (`specs/170-forms-module/` User Story 3, FR-030,
 * FR-031, research R-6, R-19): conditions inside a group are joined by the rule's connective and the
 * groups by the opposite one — `and` inside reads "(A and B) or C"; each condition names another
 * input field, a comparison that field's type allows (`FORM_CONDITION_OPERATORS_BY_TYPE`, the table
 * the server's publish check reads) and, unless it tests for emptiness, a value. A condition naming a
 * field that no longer exists is shown as broken rather than dropped, and the publish refusals about
 * this rule — a cycle, a removed field, a comparison the type forbids — are shown beside it.
 *
 * **Principle IX — why a new component.** admin-kit's `RuleBuilder` is typed to `PromotionRule` and
 * has neither `contains`/`is empty` nor a per-type operator table; widening it would change three
 * live promotion screens. This editor is composed of admin-kit's `Select`, `Input`, `Label` and
 * `Button` only — native controls, so every part is reachable and operable with the keyboard — and
 * may be promoted to admin-kit by the designer later.
 */
export interface ConditionRuleEditorProps {
  readonly definition: FormDefinition;
  /** The form's default language: the labels the field and option choices are shown with. */
  readonly language: string;
  /** The field or section the rule belongs to. It, and a section's own fields, are not offered. */
  readonly ownerId: string;
  readonly rule: VisibilityRule | undefined;
  /** The last publish refusal's issues; the ones about this rule are shown. */
  readonly issues?: readonly FormDefinitionIssue[];
  readonly disabled?: boolean;
  /** `undefined` when the last condition is removed: the element is always shown again. */
  readonly onChange: (rule: VisibilityRule | undefined) => void;
}

/** The publish rules a visibility rule can break (data-model §3.5). */
const RULE_ISSUES: ReadonlySet<FormDefinitionIssueCode> = new Set([
  'unknown_condition_field',
  'condition_on_layout_element',
  'operator_not_allowed',
  'cyclic_visibility',
  'too_many_conditions',
]);

const NO_VALUE: ReadonlySet<FormConditionOperator> = new Set(['is_empty', 'is_not_empty']);
const BOOLEAN_TYPES: ReadonlySet<string> = new Set(['checkbox', 'privacy_consent', 'marketing_consent', 'terms']);
const DATETIME_INPUT = { date: 'date', time: 'time', datetime: 'datetime-local' } as const;

/** The fields a condition of this rule may name: input fields, not the owner nor a section's own. */
function candidatesOf(definition: FormDefinition, ownerId: string): FormInputField[] {
  return definition.sections.flatMap((section) =>
    section.id === ownerId ? [] : section.fields.filter(isInputField).filter((field) => field.id !== ownerId),
  );
}

/** The value a condition starts with for a field: its first option, "ticked", or none. */
function initialValue(field: FormInputField): FormCondition['value'] {
  if (field.type === 'select' || field.type === 'radio' || field.type === 'checkboxes') return field.options[0]?.value;
  if (BOOLEAN_TYPES.has(field.type)) return 'true';
  return undefined;
}

function conditionFor(field: FormInputField, operator?: FormConditionOperator): FormCondition {
  const allowed = FORM_CONDITION_OPERATORS_BY_TYPE[field.type];
  const chosen = operator && allowed.includes(operator) ? operator : allowed[0]!;
  const value = NO_VALUE.has(chosen) ? undefined : initialValue(field);
  return value === undefined ? { fieldId: field.id, operator: chosen } : { fieldId: field.id, operator: chosen, value };
}

export function ConditionRuleEditor(props: ConditionRuleEditorProps): ReactNode {
  const { definition, language, ownerId, rule, issues = [], disabled = false, onChange } = props;
  const t = useTranslation('forms');
  const baseId = useId();
  const pendingFocus = useRef<string | null>(null);
  const candidates = candidatesOf(definition, ownerId);
  const byId = new Map(candidates.map((field) => [field.id, field]));
  const ownIssues = issues.filter((issue) => issue.elementId === ownerId && RULE_ISSUES.has(issue.code));
  const groups = rule?.groups ?? [];
  const conditionCount = groups.reduce((count, group) => count + group.length, 0);
  const canAdd = !disabled && candidates.length > 0 && conditionCount < FORMS_LIMITS.conditionsPerRule;

  useEffect(() => {
    if (pendingFocus.current === null) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  const id = (suffix: string): string => `${baseId}-${suffix}`;
  const fieldControlId = (group: number, index: number): string => id(`c-${group}-${index}-field`);

  const labelOf = (field: FormInputField): string =>
    textOf(definition, language, `fields.${field.id}.label`).trim() || t('conditions.unlabelled', { key: field.key });

  const write = (nextGroups: FormCondition[][], connective = rule?.connective ?? 'and'): void => {
    const kept = nextGroups.filter((group) => group.length > 0);
    onChange(kept.length === 0 ? undefined : { connective, groups: kept });
  };

  const updateCondition = (group: number, index: number, next: FormCondition): void =>
    write(groups.map((conditions, g) => (g === group ? conditions.map((c, i) => (i === index ? next : c)) : conditions)));

  const addFirst = (): void => {
    const first = candidates[0];
    if (!first) return;
    pendingFocus.current = fieldControlId(0, 0);
    write([[conditionFor(first)]], 'and');
  };

  const addToGroup = (group: number): void => {
    const first = candidates[0];
    if (!first) return;
    pendingFocus.current = fieldControlId(group, groups[group]!.length);
    write(groups.map((conditions, g) => (g === group ? [...conditions, conditionFor(first)] : conditions)));
  };

  const addGroup = (): void => {
    const first = candidates[0];
    if (!first) return;
    pendingFocus.current = fieldControlId(groups.length, 0);
    write([...groups, [conditionFor(first)]]);
  };

  const remove = (group: number, index: number): void => {
    const next = groups.map((conditions, g) => (g === group ? conditions.filter((_, i) => i !== index) : conditions));
    const remaining = next.filter((conditions) => conditions.length > 0);
    if (remaining.length === 0) pendingFocus.current = id('add');
    else {
      // The condition now in its place, else the one before it.
      const groupIndex = Math.min(remaining.length - 1, next[group]!.length === 0 ? Math.max(0, group - 1) : group);
      const conditionIndex = Math.min(index, remaining[groupIndex]!.length - 1);
      pendingFocus.current = fieldControlId(groupIndex, conditionIndex);
    }
    write(next);
  };

  const issueList =
    ownIssues.length > 0 ? (
      <ul className="space-y-1" aria-live="polite">
        {ownIssues.map((issue) => (
          <li key={`${issue.code}-${issue.path}`} className="flex items-start gap-1 text-xs text-destructive">
            <AlertCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            {t(`issues.${issue.code}`)}
          </li>
        ))}
      </ul>
    ) : null;

  if (!rule || groups.length === 0) {
    return (
      <section aria-labelledby={id('title')} className="space-y-2">
        <h3 id={id('title')} className="text-sm font-medium">
          {t('conditions.title')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {candidates.length > 0 ? t('conditions.always') : t('conditions.noCandidates')}
        </p>
        {issueList}
        <Button id={id('add')} type="button" variant="outline" size="sm" disabled={!canAdd} onClick={addFirst}>
          <Plus size={14} aria-hidden="true" />
          {t('conditions.add')}
        </Button>
      </section>
    );
  }

  const between = rule.connective === 'and' ? 'or' : 'and';
  let number = 0;

  return (
    <section aria-labelledby={id('title')} className="space-y-3">
      <h3 id={id('title')} className="text-sm font-medium">
        {t('conditions.title')}
      </h3>
      {issueList}
      <div className="space-y-1">
        <Label htmlFor={id('connective')}>{t('conditions.connective')}</Label>
        <Select
          id={id('connective')}
          value={rule.connective}
          disabled={disabled}
          onChange={(event) => write(groups, event.target.value === 'or' ? 'or' : 'and')}
        >
          <option value="and">{t('conditions.connective.and')}</option>
          <option value="or">{t('conditions.connective.or')}</option>
        </Select>
      </div>

      {groups.map((conditions, groupIndex) => (
        <Fragment key={groupIndex}>
          {groupIndex > 0 ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`conditions.between.${between}`)}</p>
          ) : null}
          <fieldset className="space-y-2 rounded-md border border-border p-2">
            <legend className="px-1 text-xs font-medium">{t('conditions.group', { n: groupIndex + 1 })}</legend>
            {conditions.map((condition, index) => {
              number += 1;
              const n = number;
              const field = byId.get(condition.fieldId);
              const brokenId = id(`c-${groupIndex}-${index}-broken`);
              const allowed = field ? FORM_CONDITION_OPERATORS_BY_TYPE[field.type] : [];
              const valueId = id(`c-${groupIndex}-${index}-value`);
              return (
                <div key={index} className="space-y-1">
                  {index > 0 ? <p className="text-xs text-muted-foreground">{t(`conditions.within.${rule.connective}`)}</p> : null}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                    <div className="space-y-1">
                      <Label htmlFor={fieldControlId(groupIndex, index)} className="sr-only">
                        {t('conditions.field', { n })}
                      </Label>
                      <Select
                        id={fieldControlId(groupIndex, index)}
                        value={condition.fieldId}
                        disabled={disabled}
                        {...(field ? {} : { 'aria-invalid': true, 'aria-describedby': brokenId })}
                        onChange={(event) => {
                          const next = byId.get(event.target.value);
                          if (next) updateCondition(groupIndex, index, conditionFor(next, condition.operator));
                        }}
                      >
                        {field ? null : <option value={condition.fieldId}>{t('conditions.removedField')}</option>}
                        {candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {labelOf(candidate)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={id(`c-${groupIndex}-${index}-operator`)} className="sr-only">
                        {t('conditions.operator', { n })}
                      </Label>
                      <Select
                        id={id(`c-${groupIndex}-${index}-operator`)}
                        value={condition.operator}
                        disabled={disabled || !field}
                        onChange={(event) => {
                          const operator = event.target.value as FormConditionOperator;
                          const { value: _value, ...rest } = condition;
                          const value = NO_VALUE.has(operator) ? undefined : (condition.value ?? (field ? initialValue(field) : undefined));
                          updateCondition(groupIndex, index, value === undefined ? { ...rest, operator } : { ...rest, operator, value });
                        }}
                      >
                        {(field ? allowed : [condition.operator]).map((operator) => (
                          <option key={operator} value={operator}>
                            {t(`conditions.operator.${operator}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      {field && !NO_VALUE.has(condition.operator) ? (
                        <>
                          <Label htmlFor={valueId} className="sr-only">
                            {t('conditions.value', { n })}
                          </Label>
                          <ValueControl
                            id={valueId}
                            field={field}
                            definition={definition}
                            language={language}
                            value={condition.value}
                            disabled={disabled}
                            onChange={(value) => {
                              const { value: _value, ...rest } = condition;
                              updateCondition(groupIndex, index, value === undefined ? rest : { ...rest, value });
                            }}
                          />
                        </>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      aria-label={t('conditions.remove', { n })}
                      onClick={() => remove(groupIndex, index)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </div>
                  {field ? null : (
                    <p id={brokenId} className="flex items-start gap-1 text-xs text-destructive">
                      <AlertCircle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
                      {t('conditions.broken')}
                    </p>
                  )}
                </div>
              );
            })}
            <Button type="button" variant="ghost" size="sm" disabled={!canAdd} onClick={() => addToGroup(groupIndex)}>
              <Plus size={14} aria-hidden="true" />
              {t('conditions.addToGroup', { n: groupIndex + 1 })}
            </Button>
          </fieldset>
        </Fragment>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canAdd || groups.length >= FORMS_LIMITS.groupsPerRule}
        onClick={addGroup}
      >
        <Plus size={14} aria-hidden="true" />
        {t('conditions.addGroup')}
      </Button>
    </section>
  );
}

/** What a condition compares with, in the shape of the referenced field's type. */
function ValueControl(props: {
  readonly id: string;
  readonly field: FormInputField;
  readonly definition: FormDefinition;
  readonly language: string;
  readonly value: FormCondition['value'];
  readonly disabled: boolean;
  readonly onChange: (value: FormCondition['value']) => void;
}): ReactNode {
  const { id, field, definition, language, value, disabled, onChange } = props;
  const t = useTranslation('forms');
  if (field.type === 'select' || field.type === 'radio' || field.type === 'checkboxes') {
    return (
      <Select id={id} value={value === undefined ? '' : String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {field.options.map((option) => (
          <option key={option.id} value={option.value}>
            {textOf(definition, language, `fields.${field.id}.options.${option.id}`).trim() || option.value}
          </option>
        ))}
      </Select>
    );
  }
  if (BOOLEAN_TYPES.has(field.type)) {
    return (
      <Select id={id} value={value === 'false' ? 'false' : 'true'} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="true">{t('conditions.value.true')}</option>
        <option value="false">{t('conditions.value.false')}</option>
      </Select>
    );
  }
  if (field.type === 'number') {
    return (
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value.trim();
          const parsed = Number(raw);
          onChange(raw === '' || !Number.isFinite(parsed) ? undefined : parsed);
        }}
      />
    );
  }
  return (
    <Input
      id={id}
      type={field.type === 'datetime' ? DATETIME_INPUT[field.mode] : 'text'}
      value={value === undefined ? '' : String(value)}
      maxLength={FORMS_LIMITS.singleLineChars}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  );
}
