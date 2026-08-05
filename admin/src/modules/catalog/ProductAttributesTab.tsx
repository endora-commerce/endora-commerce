import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { MultiSelect } from '@/components/ui/multi-select';
// Feature 068 / US4 — the Ergonode overwrite-protection control. Renders `null`
// unless an Ergonode connection is enabled (FR-058), so no condition is needed
// here.
import { FieldProtectionToggle } from '../pim_ergonode/components/FieldProtectionToggle';

/**
 * Feature: product Attributes tab.
 *
 * Renders editable value inputs for every attribute assigned to the product's
 * currently-selected Attribute Set. The attribute list is fetched from the
 * Attribute Set detail endpoint and re-fetched whenever `attributeSetId`
 * changes, so swapping the set in the Details tab immediately re-renders the
 * matching attribute fields (no save round-trip required).
 */

type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'date'
  | 'multiselect'
  | 'price'
  | 'select';

interface SetAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  valueType: ValueType;
  position: number;
}

interface AttributeOption {
  id: string;
  value: string;
  label: Record<string, string>;
  labelDefault: string;
  sortOrder: number;
}

/** Attribute value types whose values come from a fixed option list. */
const OPTION_TYPES = new Set<ValueType>(['enum', 'select', 'multiselect']);

function pickLabel(label: Record<string, string>, fallback: string): string {
  return label['en-US'] ?? Object.values(label)[0] ?? fallback;
}

export interface ProductAttributesTabProps {
  /**
   * Only for the Ergonode protection control (FR-052 asks for it per attribute
   * value); absent while the product is still being created, which is also when
   * there is nothing to protect.
   */
  productId?: string | null | undefined;
  attributeSetId: string;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export function ProductAttributesTab({
  productId,
  attributeSetId,
  values,
  onChange,
}: ProductAttributesTabProps): ReactNode {
  const t = useTranslation('catalog');
  const [attributes, setAttributes] = useState<SetAttribute[]>([]);
  const [optionsByAttr, setOptionsByAttr] = useState<Record<string, AttributeOption[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-load whenever the selected Attribute Set changes — this is what makes
  // the tab track the Details-tab selector live.
  useEffect(() => {
    if (!attributeSetId) {
      setAttributes([]);
      setOptionsByAttr({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async (): Promise<void> => {
      try {
        const res = await apiClient.get<{ data: { attributes: SetAttribute[] } }>(
          `/api/v1/admin/catalog/attribute-sets/${attributeSetId}`,
        );
        if (cancelled) return;
        const attrs = [...res.data.attributes].sort((a, b) => a.position - b.position);
        setAttributes(attrs);

        const optionAttrs = attrs.filter((a) => OPTION_TYPES.has(a.valueType));
        const entries = await Promise.all(
          optionAttrs.map(async (a) => {
            const optRes = await apiClient.get<{ data: { items: AttributeOption[] } }>(
              `/api/v1/admin/catalog/attributes/${a.id}/options`,
            );
            const opts = [...optRes.data.items].sort((x, y) => x.sortOrder - y.sortOrder);
            return [a.id, opts] as const;
          }),
        );
        if (cancelled) return;
        setOptionsByAttr(Object.fromEntries(entries));
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.envelope.error.message
            : t('productEditor.attributes.loadFailed'),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [attributeSetId, t]);

  if (!attributeSetId) {
    return <div className="b2b-help">{t('productEditor.attributes.noSet')}</div>;
  }
  if (loading) {
    return <div className="b2b-help">{t('productEditor.attributes.loading')}</div>;
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (attributes.length === 0) {
    return <div className="b2b-help">{t('productEditor.attributes.empty')}</div>;
  }

  return (
    <div className="b2b-col" style={{ gap: 16 }}>
      <div className="b2b-help" style={{ marginTop: 0 }}>
        {t('productEditor.attributes.help')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {attributes.map((attr) => (
          <AttributeField
            key={attr.id}
            attr={attr}
            options={optionsByAttr[attr.id] ?? []}
            value={values[attr.key]}
            onChange={(v): void => onChange(attr.key, v)}
            noneLabel={t('productEditor.attributes.selectNone')}
            productId={productId}
          />
        ))}
      </div>
    </div>
  );
}

function AttributeField({
  attr,
  options,
  value,
  onChange,
  noneLabel,
  productId,
}: {
  attr: SetAttribute;
  options: AttributeOption[];
  value: unknown;
  onChange: (value: unknown) => void;
  noneLabel: string;
  productId: string | null | undefined;
}): ReactNode {
  const label = pickLabel(attr.label, attr.key);
  const inputId = `attr-${attr.id}`;

  let control: ReactNode;
  switch (attr.valueType) {
    case 'boolean':
      control = (
        <label htmlFor={inputId} className="b2b-row" style={{ gap: 8, alignItems: 'center' }}>
          <Checkbox
            id={inputId}
            checked={value === true}
            onChange={(e): void => onChange(e.target.checked)}
          />
          <span>{label}</span>
        </label>
      );
      break;

    case 'number':
    case 'price':
      control = (
        <Input
          id={inputId}
          type="number"
          step="any"
          value={value == null ? '' : String(value)}
          onChange={(e): void => {
            const raw = e.target.value;
            if (raw === '') {
              onChange(undefined);
              return;
            }
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
        />
      );
      break;

    case 'date':
      control = (
        <Input
          id={inputId}
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e): void => onChange(e.target.value || undefined)}
        />
      );
      break;

    case 'enum':
    case 'select':
      control = (
        <Select
          id={inputId}
          value={typeof value === 'string' ? value : ''}
          onChange={(e): void => onChange(e.target.value || undefined)}
        >
          <option value="">{noneLabel}</option>
          {options.map((o) => (
            <option key={o.id} value={o.value}>
              {pickLabel(o.label, o.labelDefault)}
            </option>
          ))}
        </Select>
      );
      break;

    case 'multiselect':
      control = (
        <MultiSelect
          options={options.map((o) => ({ value: o.value, label: pickLabel(o.label, o.labelDefault) }))}
          selected={Array.isArray(value) ? (value as string[]) : []}
          onChange={(next): void => onChange(next)}
          placeholder={noneLabel}
          ariaLabel={label}
        />
      );
      break;

    case 'string':
    default:
      control = (
        <Input
          id={inputId}
          type="text"
          value={typeof value === 'string' ? value : value == null ? '' : String(value)}
          onChange={(e): void => onChange(e.target.value)}
        />
      );
      break;
  }

  // Feature 068 / US4 — one control per attribute value, because that is the
  // granularity FR-052 asks for: an operator curates *this* value, not "the
  // attributes".
  const protection = (
    <FieldProtectionToggle productId={productId} fieldPath={`attributeValues.${attr.key}`} />
  );

  // The boolean control renders its own inline label.
  if (attr.valueType === 'boolean') {
    return (
      <div>
        {control}
        {protection}
      </div>
    );
  }

  return (
    <div>
      <Label htmlFor={inputId}>
        {label} <span className="b2b-mono" style={{ opacity: 0.6 }}>({attr.key})</span>
      </Label>
      {control}
      {protection}
    </div>
  );
}
