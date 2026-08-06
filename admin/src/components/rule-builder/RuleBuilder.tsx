import { type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import type { PromotionRule } from '@b2b/contracts';

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

const DEFAULT_LABELS: Required<RuleBuilderLabels> = {
  builtinGroup: 'Cart & relationship',
  attributeGroup: 'Attributes',
  matchAll: 'Matches all carts.',
  valuesPlaceholder: 'Any value',
  valuesLabel: 'Value',
  valuesSearchPlaceholder: 'Search…',
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
}

export function RuleBuilder<T extends StructuralRule = PromotionRule>({
  value,
  onChange,
  builtinFields = BUILTIN_FIELDS,
  attributeFields = [],
  fieldOptions = {},
  labels,
  disabled = false,
}: RuleBuilderProps<T>): ReactNode {
  const copy: Required<RuleBuilderLabels> = { ...DEFAULT_LABELS, ...labels };
  return (
    <div className="rounded-md border border-line p-3">
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
          <Plus className="mr-1 h-3 w-3" /> Add condition
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
          <Plus className="mr-1 h-3 w-3" /> Add group
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
            <Plus className="mr-1 h-3 w-3" /> Combine with…
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
          onChange={(e) => onChange({ ...node, op: e.target.value as 'AND' | 'OR' })}
        >
          <option value="AND">ALL of</option>
          <option value="OR">ANY of</option>
        </Select>
        <span className="text-xs text-muted-foreground">the following conditions:</span>
      </div>
      <div className="flex flex-col gap-2 border-l-2 border-line pl-3">
        {node.children.map((child, idx) => (
          <div key={idx} className="flex items-start gap-2">
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
            <Button type="button" size="icon" variant="ghost" disabled={disabled} onClick={() => removeChild(idx)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
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
            <Plus className="mr-1 h-3 w-3" /> Condition
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
              <Plus className="mr-1 h-3 w-3" /> Group
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
      <Select className="w-44" value={fieldKey(condition.field)} disabled={disabled} onChange={(e) => onFieldChange(e.target.value)}>
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
          placeholder={numeric ? '0' : 'value(s), comma-separated'}
          onChange={(e) => onChange({ ...condition, values: textToValues(e.target.value, numeric) })}
        />
      )}
      <Button type="button" size="icon" variant="ghost" disabled={disabled} onClick={onRemove}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
