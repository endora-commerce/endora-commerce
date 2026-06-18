import { type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type {
  PromotionRule,
  PromotionRuleCondition,
  PromotionRuleField,
  PromotionRuleOp,
} from '@b2b/contracts';

/**
 * Feature 045 — generic, controlled rule builder for the typed promotion
 * Rule AST (`all` | `condition` | `group`). Extracted as a shared admin
 * component so it can be reused beyond promotions. Built-in fields are a
 * fixed catalogue; promo-eligible product attributes are supplied by the
 * caller via `attributeFields`.
 */
export interface RuleAttributeField {
  attributeKey: string;
  label: string;
}

interface BuiltinFieldDef {
  key: Extract<PromotionRuleField, { kind: 'builtin' }>['key'];
  kind: 'number' | 'string' | 'set';
  ops: PromotionRuleOp[];
}

const BUILTIN_FIELDS: BuiltinFieldDef[] = [
  { key: 'cartTotal', kind: 'number', ops: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'] },
  { key: 'paymentMethod', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'deliveryMethod', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'deliveryCountry', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'deliveryPostalCode', kind: 'string', ops: ['eq', 'neq', 'contains', 'startsWith'] },
  { key: 'organization', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'customerGroup', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'] },
  { key: 'category', kind: 'set', ops: ['in', 'notIn'] },
];

const ATTRIBUTE_OPS: PromotionRuleOp[] = ['eq', 'neq', 'in', 'notIn', 'between'];

function defaultCondition(): PromotionRuleCondition {
  return { kind: 'condition', field: { kind: 'builtin', key: 'cartTotal' }, op: 'gte', values: [0] };
}

function fieldKey(field: PromotionRuleField): string {
  return field.kind === 'builtin' ? `builtin:${field.key}` : `attribute:${field.attributeKey}`;
}

function builtinDef(field: PromotionRuleField): BuiltinFieldDef | null {
  if (field.kind !== 'builtin') return null;
  return BUILTIN_FIELDS.find((f) => f.key === field.key) ?? null;
}

function opsForField(field: PromotionRuleField): PromotionRuleOp[] {
  const def = builtinDef(field);
  return def ? def.ops : ATTRIBUTE_OPS;
}

function isNumericField(field: PromotionRuleField): boolean {
  return builtinDef(field)?.kind === 'number';
}

function valuesToText(values: ReadonlyArray<string | number | boolean>): string {
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

export interface RuleBuilderProps {
  value: PromotionRule;
  onChange: (next: PromotionRule) => void;
  attributeFields?: RuleAttributeField[];
  fieldOptions?: RuleFieldOptions;
  disabled?: boolean;
}

export function RuleBuilder({
  value,
  onChange,
  attributeFields = [],
  fieldOptions = {},
  disabled = false,
}: RuleBuilderProps): ReactNode {
  return (
    <div className="rounded-md border border-line p-3">
      <RuleNode
        node={value}
        onChange={onChange}
        attributeFields={attributeFields}
        fieldOptions={fieldOptions}
        disabled={disabled}
        depth={0}
      />
    </div>
  );
}

function RuleNode({
  node,
  onChange,
  attributeFields,
  fieldOptions,
  disabled,
  depth,
}: {
  node: PromotionRule;
  onChange: (next: PromotionRule) => void;
  attributeFields: RuleAttributeField[];
  fieldOptions: RuleFieldOptions;
  disabled: boolean;
  depth: number;
}): ReactNode {
  if (node.kind === 'all') {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Matches all carts.</span>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange(defaultCondition())}>
          <Plus className="mr-1 h-3 w-3" /> Add condition
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChange({ kind: 'group', op: 'AND', children: [defaultCondition()] })}
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
          attributeFields={attributeFields}
          fieldOptions={fieldOptions}
          disabled={disabled}
          onRemove={() => onChange({ kind: 'all' })}
        />
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange({ kind: 'group', op: 'AND', children: [node, defaultCondition()] })}
          >
            <Plus className="mr-1 h-3 w-3" /> Combine with…
          </Button>
        </div>
      </div>
    );
  }

  // group
  const setChild = (idx: number, child: PromotionRule): void => {
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
                attributeFields={attributeFields}
                fieldOptions={fieldOptions}
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
            onClick={() => onChange({ ...node, children: [...node.children, defaultCondition()] })}
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
                onChange({ ...node, children: [...node.children, { kind: 'group', op: 'AND', children: [defaultCondition()] }] })
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
  attributeFields,
  fieldOptions,
  disabled,
  onRemove,
}: {
  condition: PromotionRuleCondition;
  onChange: (next: PromotionRule) => void;
  attributeFields: RuleAttributeField[];
  fieldOptions: RuleFieldOptions;
  disabled: boolean;
  onRemove: () => void;
}): ReactNode {
  const numeric = isNumericField(condition.field);
  const ops = opsForField(condition.field);
  const options = condition.field.kind === 'builtin' ? fieldOptions[condition.field.key] : undefined;

  const onFieldChange = (selected: string): void => {
    let field: PromotionRuleField;
    if (selected.startsWith('attribute:')) {
      field = { kind: 'attribute', attributeKey: selected.slice('attribute:'.length) };
    } else {
      field = { kind: 'builtin', key: selected.slice('builtin:'.length) as BuiltinFieldDef['key'] };
    }
    const nextOps = opsForField(field);
    const op = nextOps.includes(condition.op) ? condition.op : (nextOps[0] as PromotionRuleOp);
    onChange({ ...condition, field, op, values: [] });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="w-44" value={fieldKey(condition.field)} disabled={disabled} onChange={(e) => onFieldChange(e.target.value)}>
        <optgroup label="Cart & relationship">
          {BUILTIN_FIELDS.map((f) => (
            <option key={f.key} value={`builtin:${f.key}`}>
              {f.key}
            </option>
          ))}
        </optgroup>
        {attributeFields.length > 0 ? (
          <optgroup label="Attributes">
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
        onChange={(e) => onChange({ ...condition, op: e.target.value as PromotionRuleOp })}
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </Select>
      {options ? (
        <select
          multiple
          className="h-20 w-48 rounded-md border border-input bg-transparent px-2 py-1 text-sm"
          disabled={disabled}
          value={condition.values.map(String)}
          onChange={(e) =>
            onChange({
              ...condition,
              values: Array.from(e.target.selectedOptions).map((o) => o.value),
            })
          }
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
