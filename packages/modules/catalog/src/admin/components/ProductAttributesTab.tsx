import { useEffect, useState, type ReactNode } from 'react';
import type { AdminProductContentList } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Input, Label, Select, Checkbox, MultiSelect } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';
import { ProductContentCard, type ProductContentCardBlocker } from './ProductContentCard.js';

/**
 * The locales this screen edits product copy in — the same list
 * `ProductEditor.tsx` renders its per-language name and description controls
 * from.
 *
 * It is stated here because the zone below carries it: a contributor beside a
 * language-scoped attribute renders one control per locale, and *which* locales
 * a field is edited in is the host's fact, not the contributor's. Before
 * feature 091's P4b the list lived in `pim_ergonode`'s control, restated there
 * so a catalogue screen needed no language wiring — which put the catalogue's
 * own vocabulary inside an integration.
 */
const LOCALES = ['en-US', 'pl-PL'] as const;

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
  | 'select'
  // Feature 172 — a Page Builder content attribute: a card, never an input.
  | 'page_builder';

interface SetAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  valueType: ValueType;
  position: number;
  /** Feature 023 — the value is stored per language, one slot per active locale. */
  languageScoped: boolean;
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
   * Only for the per-value zone mount below; absent while the product is still
   * being created, which is also when there is nothing to contribute about.
   */
  productId?: string | null | undefined;
  attributeSetId: string;
  /**
   * Feature 172 — the attribute set the product is saved with. A content
   * attribute is edited on its own screen against the saved set, so while the
   * Details tab has chosen another one the card offers no editing.
   */
  savedAttributeSetId?: string | undefined;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

/** Never called: the card only counts the editor's contributors (Z15). */
const NO_EDIT = (): void => undefined;

export function ProductAttributesTab({
  productId,
  attributeSetId,
  savedAttributeSetId,
  values,
  onChange,
}: ProductAttributesTabProps): ReactNode {
  const t = useTranslation('catalog');
  const [attributes, setAttributes] = useState<SetAttribute[]>([]);
  // Feature 172 — the stored languages of each content attribute, by key.
  const [contentByKey, setContentByKey] = useState<Record<string, AdminProductContentList['attributes'][number]>>({});
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

        // Feature 172 — one read of the content summaries, only for a saved
        // product whose set has a content attribute (research R-3).
        if (productId && attrs.some((a) => a.valueType === 'page_builder')) {
          const content = await apiClient.get<{ data: AdminProductContentList }>(
            `/api/v1/admin/catalog/products/${productId}/content`,
          );
          if (cancelled) return;
          setContentByKey(Object.fromEntries(content.data.attributes.map((a) => [a.key, a])));
        } else {
          setContentByKey({});
        }
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
  }, [attributeSetId, productId, t]);

  // Z15 — whether anyone contributes the content editor, counted with the same
  // zone the content screen mounts, so the card and the screen cannot disagree.
  const contentEditors = useAdminZone('product.content.editor', {
    productId: productId ?? '',
    attributeKey: '',
    language: LOCALES[0],
    data: null,
    onChange: NO_EDIT,
  });

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
        {attributes.map((attr) =>
          attr.valueType === 'page_builder' ? (
            <ProductContentCard
              key={attr.id}
              productId={productId}
              attributeKey={attr.key}
              label={pickLabel(attr.label, attr.key)}
              languages={[
                ...new Set<string>([
                  ...LOCALES,
                  ...(contentByKey[attr.key]?.languages ?? []).map((status) => status.language),
                ]),
              ]}
              stored={contentByKey[attr.key]?.languages ?? []}
              preferredLanguage={LOCALES[0]}
              blocker={contentCardBlocker({
                productId,
                attributeSetId,
                savedAttributeSetId,
                editors: contentEditors.length,
              })}
            />
          ) : (
            <AttributeField
              key={attr.id}
              attr={attr}
              options={optionsByAttr[attr.id] ?? []}
              value={values[attr.key]}
              onChange={(v): void => onChange(attr.key, v)}
              noneLabel={t('productEditor.attributes.selectNone')}
              productId={productId}
            />
          ),
        )}
      </div>
    </div>
  );
}

/** Why a content card offers no editing, or `null` (contracts/admin-surfaces.md §4). */
function contentCardBlocker(input: {
  productId: string | null | undefined;
  attributeSetId: string;
  savedAttributeSetId: string | undefined;
  editors: number;
}): ProductContentCardBlocker {
  if (!input.productId) return 'saveFirst';
  if (input.savedAttributeSetId !== undefined && input.savedAttributeSetId !== input.attributeSetId) {
    return 'saveSetFirst';
  }
  if (input.editors === 0) return 'noEditor';
  return null;
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

  // Feature 091 / P4b — the eighth mount of `product.editor.field.after`, one
  // per attribute value, because that is the granularity a per-value protection
  // asks for: an operator curates *this* value, not "the attributes". The host
  // says which locales the value is edited in and a contributor fans out over
  // them; the screen names no integration and knows about none.
  const protection = productId ? (
    <AdminZone
      name="product.editor.field.after"
      props={{
        productId,
        fieldPath: `attributeValues.${attr.key}`,
        languageCodes: attr.languageScoped === true ? LOCALES : null,
      }}
    />
  ) : null;

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
