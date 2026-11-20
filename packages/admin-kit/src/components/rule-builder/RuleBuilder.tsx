import { type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../ui/button.js';
import {
  EditorSection,
  useEditorSectionChrome,
  type EditorSectionChrome,
  type EditorSectionHeading,
} from '../../ui/editor-section.js';
import { Input } from '../../ui/input.js';
import { MultiSelect } from '../../ui/multi-select.js';
import { Select } from '../../ui/select.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import type { PromotionRule } from '@endora-commerce/contracts';

/**
 * Feature 045 — generic, controlled rule builder for a typed rule AST
 * (`all` | `condition` | `group`). Extracted as a shared admin component so it
 * can be reused beyond promotions.
 *
 * Feature 067 made the **built-in field catalogue a prop**. It was hard-coded
 * to the promotion cart context (`cartTotal`, `paymentMethod`, …), which the
 * product feed criteria panel cannot use: its criteria are about products, not
 * carts. Forking the file would have made this the admin's *third* rule builder
 * and forked its accessibility and bug fixes with it (Principle IX).
 *
 * The generalisation is deliberately conservative. Every new prop is optional
 * and every default reproduces the promotion behaviour **exactly** — the same
 * catalogue in the same order, the same operators, the same seed condition
 * (`cartTotal >= 0`) and the same copy. `admin/test/components/RuleBuilder.test.tsx`
 * pins all of it, because the incumbent callers (`PromotionRulesPage`,
 * `PromotionEditPage`) are live screens that must not shift under this feature.
 *
 * Issue #1433 (DS-16, SHELL-07) moved every word the component draws itself
 * into the `core` bundle, so a Polish operator no longer reads English on any of
 * the screens that render it. The one sentence that changed is `matchAll`: it
 * said "Matches all carts." on a product feed's criteria as well, and now says
 * what an empty rule means anywhere. Every entry of {@link RuleBuilderLabels}
 * still overrides its default.
 */
export interface RuleAttributeField {
  attributeKey: string;
  label: string;
}

/**
 * The structural rule tree the component actually manipulates. Every concrete
 * AST it edits (`PromotionRule`, the feed's `ProductSelectionRule`) is a
 * narrowing of this: same three node kinds, different field catalogue and
 * operator enum. Typing against the structure rather than one module's contract
 * is what lets a second caller reuse the component without either contract
 * learning about the other.
 */
export type StructuralRuleField =
  | { kind: 'builtin'; key: string }
  | { kind: 'attribute'; attributeKey: string }
  | { kind: 'customField'; fieldKey: string };

export type StructuralRuleValue = string | number | boolean;

export interface StructuralRuleCondition {
  kind: 'condition';
  field: StructuralRuleField;
  op: string;
  values: StructuralRuleValue[];
}

export type StructuralRule =
  | { kind: 'all' }
  | StructuralRuleCondition
  | { kind: 'group'; op: 'AND' | 'OR'; children: StructuralRule[] };

export interface RuleBuilderBuiltinField {
  key: string;
  kind: 'number' | 'string' | 'set';
  ops: string[];
  /** Shown in the picker. Defaults to `key`, which is what promotions renders. */
  label?: string;
  /**
   * The operator and values used when this field seeds a brand-new condition.
   * Only the first field of a catalogue ever needs it; it exists so the
   * promotion default (`cartTotal >= 0`) survives the generalisation verbatim
   * instead of silently becoming `cartTotal = ∅`.
   */
  seed?: { op: string; values: StructuralRuleValue[] };
}

/** Copy the component cannot know, because it depends on what is being filtered. */
export interface RuleBuilderLabels {
  /** Heading of the built-in `optgroup`. */
  builtinGroup?: string;
  /** Heading of the attribute `optgroup`. */
  attributeGroup?: string;
  /** The sentence shown on the `all` node. */
  matchAll?: string;
  /** Trigger text for the value picker while nothing is chosen. */
  valuesPlaceholder?: string;
  /** Accessible name for the value picker's trigger. */
  valuesLabel?: string;
  /** Placeholder inside the value picker's search box. */
  valuesSearchPlaceholder?: string;
  /** Placeholder of the free-text value input, for a field with no option set. */
  valuesInputPlaceholder?: string;
  /** Accessible name of a condition's field select. */
  fieldLabel?: string;
  /** Accessible name of a condition's operator select. */
  operatorLabel?: string;
  /** The two buttons on the `all` node. */
  addCondition?: string;
  addGroup?: string;
  /** The button under a lone condition that turns it into a group. */
  combineWith?: string;
  /** Accessible name of a group's AND / OR select, and its two options. */
  groupOperatorLabel?: string;
  groupAll?: string;
  groupAny?: string;
  /** The words after the AND / OR select: "ALL of [the following conditions:]". */
  groupSuffix?: string;
  /** The two buttons under a group's children. */
  addChildCondition?: string;
  addChildGroup?: string;
  /** Accessible name of a condition's icon-only remove button. */
  removeCondition?: string;
  /** Accessible name of the icon-only button that removes a child from its group. */
  removeChild?: string;
}

const BUILTIN_FIELDS: RuleBuilderBuiltinField[] = [
  {
    key: 'cartTotal',
    kind: 'number',
    ops: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'],
    seed: { op: 'gte', values: [0] },
  },
  { key: 'paymentMethod', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'deliveryMethod', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'deliveryCountry', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'deliveryPostalCode', kind: 'string', ops: ['eq', 'neq', 'contains', 'startsWith'] },
  { key: 'organization', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'customerGroup', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'category', kind: 'set', ops: ['in', 'notIn'] },
];

/** The `core` key behind each label's default (issue #1433). */
const DEFAULT_LABEL_KEYS: Readonly<Record<keyof RuleBuilderLabels, string>> = {
  builtinGroup: 'ruleBuilder.group.builtin',
  attributeGroup: 'ruleBuilder.group.attribute',
  matchAll: 'ruleBuilder.matchAll',
  valuesPlaceholder: 'ruleBuilder.values.placeholder',
  valuesLabel: 'ruleBuilder.values.label',
  valuesSearchPlaceholder: 'ruleBuilder.values.search',
  valuesInputPlaceholder: 'ruleBuilder.values.input',
  fieldLabel: 'ruleBuilder.field.label',
  operatorLabel: 'ruleBuilder.operator.label',
  addCondition: 'ruleBuilder.add.condition',
  addGroup: 'ruleBuilder.add.group',
  combineWith: 'ruleBuilder.combineWith',
  groupOperatorLabel: 'ruleBuilder.groupOp.label',
  groupAll: 'ruleBuilder.groupOp.all',
  groupAny: 'ruleBuilder.groupOp.any',
  groupSuffix: 'ruleBuilder.groupOp.suffix',
  addChildCondition: 'ruleBuilder.add.childCondition',
  addChildGroup: 'ruleBuilder.add.childGroup',
  removeCondition: 'ruleBuilder.remove.condition',
  removeChild: 'ruleBuilder.remove.child',
};

const ATTRIBUTE_OPS: string[] = ['eq', 'neq', 'in', 'notIn', 'between'];

function defaultCondition(fields: RuleBuilderBuiltinField[]): StructuralRuleCondition {
  const first = fields[0];
  if (!first) return { kind: 'condition', field: { kind: 'attribute', attributeKey: '' }, op: 'eq', values: [] };
  return {
    kind: 'condition',
    field: { kind: 'builtin', key: first.key },
    op: first.seed?.op ?? first.ops[0] ?? 'eq',
    values: first.seed?.values ?? [],
  };
}

function fieldKey(field: StructuralRuleField): string {
  if (field.kind === 'builtin') return `builtin:${field.key}`;
  if (field.kind === 'attribute') return `attribute:${field.attributeKey}`;
  return `attribute:${field.fieldKey}`;
}

function builtinDef(
  field: StructuralRuleField,
  fields: RuleBuilderBuiltinField[],
): RuleBuilderBuiltinField | null {
  if (field.kind !== 'builtin') return null;
  return fields.find((f) => f.key === field.key) ?? null;
}

function opsForField(field: StructuralRuleField, fields: RuleBuilderBuiltinField[]): string[] {
  const def = builtinDef(field, fields);
  return def ? def.ops : ATTRIBUTE_OPS;
}

function isNumericField(field: StructuralRuleField, fields: RuleBuilderBuiltinField[]): boolean {
  return builtinDef(field, fields)?.kind === 'number';
}

function valuesToText(values: ReadonlyArray<StructuralRuleValue>): string {
  return values.map((v) => String(v)).join(', ');
}

function textToValues(text: string, numeric: boolean): Array<string | number> {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (numeric ? Number(s) : s));
}

/** Option lists for fields that should render a value picker, keyed by field key. */
export type RuleFieldOptions = Partial<Record<string, Array<{ value: string; label: string }>>>;

export interface RuleBuilderProps<T extends StructuralRule = PromotionRule> {
  value: T;
  onChange: (next: T) => void;
  /** Defaults to the promotion cart catalogue — see the file header. */
  builtinFields?: RuleBuilderBuiltinField[];
  attributeFields?: RuleAttributeField[];
  fieldOptions?: RuleFieldOptions;
  labels?: RuleBuilderLabels;
  disabled?: boolean;
  /**
   * Issue #1503 (UX audit SHELL-22, K3; the DS-03 rule, #1437) — `section` (the default, unless
   * the mount says otherwise): the builder is part of the card it sits in, under the host's own
   * heading, with no frame and no heading of its own. `card` draws a titled card around it, for
   * a builder standing alone on a page.
   */
  chrome?: EditorSectionChrome;
  /** The card's title under `chrome="card"`; *Conditions* when omitted. */
  title?: ReactNode;
  /** The card's heading level: `h2` by default, `h3` under a titled card or section. */
  titleAs?: EditorSectionHeading;
}

export function RuleBuilder<T extends StructuralRule = PromotionRule>({
  value,
  onChange,
  builtinFields = BUILTIN_FIELDS,
  attributeFields = [],
  fieldOptions = {},
  labels,
  disabled = false,
  chrome,
  title,
  titleAs,
}: RuleBuilderProps<T>): ReactNode {
  const t = useTranslation('core');
  const inherited = useEditorSectionChrome();
  const copy = Object.fromEntries(
    (Object.keys(DEFAULT_LABEL_KEYS) as Array<keyof RuleBuilderLabels>).map((name) => [
      name,
      labels?.[name] ?? t(DEFAULT_LABEL_KEYS[name]),
    ]),
  ) as Required<RuleBuilderLabels>;
  const resolved = chrome ?? inherited;
  const body = (
    <div data-slot="rule-builder">
      <RuleNode
        node={value}
        // The editor produces structural nodes; the caller owns the concrete
        // AST. Every node this component can build is valid in `T` because the
        // caller supplied the field catalogue and the operator lists it uses.
        onChange={(next): void => onChange(next as T)}
        builtinFields={builtinFields}
        attributeFields={attributeFields}
        fieldOptions={fieldOptions}
        labels={copy}
        disabled={disabled}
        depth={0}
      />
    </div>
  );
  // A frame inside a card is a defect unless it is a field: the builder's own controls keep their
  // borders, the builder does not draw one around them. Standing alone, it is a titled card.
  if (resolved !== 'card') return body;
  return (
    <EditorSection chrome="card" title={title ?? t('ruleBuilder.title')} {...(titleAs ? { as: titleAs } : {})}>
      {body}
    </EditorSection>
  );
}

function RuleNode({
  node,
  onChange,
  builtinFields,
  attributeFields,
  fieldOptions,
  labels,
  disabled,
  depth,
}: {
  node: StructuralRule;
  onChange: (next: StructuralRule) => void;
  builtinFields: RuleBuilderBuiltinField[];
  attributeFields: RuleAttributeField[];
  fieldOptions: RuleFieldOptions;
  labels: Required<RuleBuilderLabels>;
  disabled: boolean;
  depth: number;
}): ReactNode {
  if (node.kind === 'all') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{labels.matchAll}</span>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange(defaultCondition(builtinFields))}>
          <Plus className="mr-1 h-3 w-3" aria-hidden="true" /> {labels.addCondition}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onChange({ kind: 'group', op: 'AND', children: [defaultCondition(builtinFields)] })
          }
        >
          <Plus className="mr-1 h-3 w-3" aria-hidden="true" /> {labels.addGroup}
        </Button>
      </div>
    );
  }

  if (node.kind === 'condition') {
    return (
      <div className="flex flex-col gap-2">
        <ConditionRow
          condition={node}
          onChange={onChange}
          builtinFields={builtinFields}
          attributeFields={attributeFields}
          fieldOptions={fieldOptions}
          labels={labels}
          disabled={disabled}
          onRemove={() => onChange({ kind: 'all' })}
        />
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() =>
              onChange({
                kind: 'group',
                op: 'AND',
                children: [node, defaultCondition(builtinFields)],
              })
            }
          >
            <Plus className="mr-1 h-3 w-3" aria-hidden="true" /> {labels.combineWith}
          </Button>
        </div>
      </div>
    );
  }

  // group
  const setChild = (idx: number, child: StructuralRule): void => {
    onChange({ ...node, children: node.children.map((c, i) => (i === idx ? child : c)) });
  };
  const removeChild = (idx: number): void => {
    const next = node.children.filter((_, i) => i !== idx);
    if (next.length === 0) onChange({ kind: 'all' });
    else if (next.length === 1 && next[0]) onChange(next[0]);
    else onChange({ ...node, children: next });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select
          className="w-24"
          value={node.op}
          disabled={disabled}
          aria-label={labels.groupOperatorLabel}
          onChange={(e) => onChange({ ...node, op: e.target.value as 'AND' | 'OR' })}
        >
          <option value="AND">{labels.groupAll}</option>
          <option value="OR">{labels.groupAny}</option>
        </Select>
        <span className="text-xs text-muted-foreground">{labels.groupSuffix}</span>
      </div>
      {/* One rule between a group's children, not a ruled-off column or a box around them
          (issue #1503, K3); the indent carries the nesting. */}
      <div data-slot="rule-group-children" className="flex flex-col divide-y divide-border pl-4">
        {node.children.map((child, idx) => (
          <div key={idx} className="flex items-start gap-2 py-2 first:pt-0">
            <div className="flex-1">
              <RuleNode
                node={child}
                onChange={(c) => setChild(idx, c)}
                builtinFields={builtinFields}
                attributeFields={attributeFields}
                fieldOptions={fieldOptions}
                labels={labels}
                disabled={disabled}
                depth={depth + 1}
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={disabled}
              aria-label={labels.removeChild}
              onClick={() => removeChild(idx)}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...node,
                children: [...node.children, defaultCondition(builtinFields)],
              })
            }
          >
            <Plus className="mr-1 h-3 w-3" aria-hidden="true" /> {labels.addChildCondition}
          </Button>
          {depth < 4 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...node,
                  children: [
                    ...node.children,
                    { kind: 'group', op: 'AND', children: [defaultCondition(builtinFields)] },
                  ],
                })
              }
            >
              <Plus className="mr-1 h-3 w-3" aria-hidden="true" /> {labels.addChildGroup}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ConditionRow({
  condition,
  onChange,
  builtinFields,
  attributeFields,
  fieldOptions,
  labels,
  disabled,
  onRemove,
}: {
  condition: StructuralRuleCondition;
  onChange: (next: StructuralRule) => void;
  builtinFields: RuleBuilderBuiltinField[];
  attributeFields: RuleAttributeField[];
  fieldOptions: RuleFieldOptions;
  labels: Required<RuleBuilderLabels>;
  disabled: boolean;
  onRemove: () => void;
}): ReactNode {
  const numeric = isNumericField(condition.field, builtinFields);
  const ops = opsForField(condition.field, builtinFields);
  const options = condition.field.kind === 'builtin' ? fieldOptions[condition.field.key] : undefined;

  const onFieldChange = (selected: string): void => {
    const field: StructuralRuleField = selected.startsWith('attribute:')
      ? { kind: 'attribute', attributeKey: selected.slice('attribute:'.length) }
      : { kind: 'builtin', key: selected.slice('builtin:'.length) };
    const nextOps = opsForField(field, builtinFields);
    const op = nextOps.includes(condition.op) ? condition.op : (nextOps[0] ?? condition.op);
    onChange({ ...condition, field, op, values: [] });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        className="w-44"
        value={fieldKey(condition.field)}
        disabled={disabled}
        aria-label={labels.fieldLabel}
        onChange={(e) => onFieldChange(e.target.value)}
      >
        <optgroup label={labels.builtinGroup}>
          {builtinFields.map((f) => (
            <option key={f.key} value={`builtin:${f.key}`}>
              {f.label ?? f.key}
            </option>
          ))}
        </optgroup>
        {attributeFields.length > 0 ? (
          <optgroup label={labels.attributeGroup}>
            {attributeFields.map((a) => (
              <option key={a.attributeKey} value={`attribute:${a.attributeKey}`}>
                {a.label}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
      <Select
        className="w-28"
        value={condition.op}
        disabled={disabled}
        aria-label={labels.operatorLabel}
        onChange={(e) => onChange({ ...condition, op: e.target.value })}
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </Select>
      {options ? (
        // Not a native `<select multiple>`: its only way to pick a second
        // option is ctrl-click, which most people have never been taught, and
        // one stray click silently drops everything already selected. It also
        // has no search — and categories, the field this is used for most, are
        // exactly the long list that makes worst. `MultiSelect` is the same
        // control every other filter surface in the admin uses (Principle IX).
        <MultiSelect
          className="w-48"
          options={options}
          selected={condition.values.map(String)}
          onChange={(next) => onChange({ ...condition, values: next })}
          placeholder={labels.valuesPlaceholder}
          ariaLabel={labels.valuesLabel}
          disabled={disabled}
          // Worth it wherever the set can be long; harmless when it is short.
          searchable
          searchPlaceholder={labels.valuesSearchPlaceholder}
        />
      ) : (
        <Input
          className="w-48"
          value={valuesToText(condition.values)}
          disabled={disabled}
          aria-label={labels.valuesLabel}
          placeholder={numeric ? '0' : labels.valuesInputPlaceholder}
          onChange={(e) => onChange({ ...condition, values: textToValues(e.target.value, numeric) })}
        />
      )}
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        aria-label={labels.removeCondition}
        onClick={onRemove}
      >
        <Trash2 className="h-3 w-3" aria-hidden="true" />
      </Button>
    </div>
  );
}
