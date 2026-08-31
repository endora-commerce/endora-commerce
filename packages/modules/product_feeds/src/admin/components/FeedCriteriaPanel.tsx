import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ProductSelectionRule } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import { RuleBuilder, adminLanguageToLocale, type RuleAttributeField, type RuleBuilderBuiltinField, type RuleFieldOptions } from '@endora-commerce/admin-kit/components';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { productFeedsClient, type SelectionPreview } from '../api.js';

/**
 * Which products go into the feed — ux-design §2.2 region 4 (FR-024, FR-025,
 * FR-028).
 *
 * The builder is the **shared** `components/rule-builder/RuleBuilder`, given a
 * product field catalogue instead of the promotion cart one (Principle IX — a
 * third rule builder is not an option). The count underneath is the whole point
 * of the panel: FR-039 says a zero-match feed keeps its last good file rather
 * than publishing an empty one, and an operator should learn that while they
 * are still editing, not from a run report the next morning.
 *
 * The count is debounced 400 ms (Doherty) and every response is checked against
 * a request sequence, so a slow early request can never overwrite a fast later
 * one with a stale number.
 */

const DEBOUNCE_MS = 400;

/** Kept small on purpose: enough SKUs to recognise the selection, not a listing. */
const SAMPLE_SKUS_SHOWN = 3;

interface AdminCategoryOption {
  id: string;
  name: Record<string, string>;
  slug: string;
}

interface AdminAttributeOption {
  key: string;
  label: Record<string, string>;
  labelDefault: string;
}

export interface FeedCriteriaPanelProps {
  salesChannelId: string;
  value: ProductSelectionRule;
  onChange: (next: ProductSelectionRule) => void;
  disabled?: boolean;
  /** Explains *why* the controls are disabled, per US6 AS-7. */
  disabledTitle?: string | undefined;
}

export function FeedCriteriaPanel(props: FeedCriteriaPanelProps): ReactNode {
  const { salesChannelId, value, onChange, disabled = false } = props;
  const t = useTranslation('product_feeds');
  const { language } = useTranslationContext();
  const locale = adminLanguageToLocale(language);

  const [categories, setCategories] = useState<AdminCategoryOption[]>([]);
  const [attributes, setAttributes] = useState<AdminAttributeOption[]>([]);
  const [preview, setPreview] = useState<SelectionPreview | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);

  // Monotonic request id: the only defence against a slow first request landing
  // after a fast second one and showing a number the rule no longer produces.
  const requestRef = useRef(0);

  const localized = useCallback(
    (map: Record<string, string>, fallback: string): string =>
      map[locale]?.trim() || Object.values(map).find((v) => v.trim() !== '') || fallback,
    [locale],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [cats, attrs] = await Promise.all([
          apiClient.get<{ data: AdminCategoryOption[] }>('/api/v1/admin/catalog/categories'),
          apiClient.get<{ data: AdminAttributeOption[] }>('/api/v1/admin/catalog/attributes'),
        ]);
        if (cancelled) return;
        setCategories(cats.data);
        setAttributes(attrs.data);
      } catch {
        // A missing picker source degrades the builder to free text rather than
        // blanking the panel — the operator can still see and edit their rule.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The channel's whole eligible catalogue, so the count reads as "x of y". */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await productFeedsClient.previewSelection({
          salesChannelId,
          selectionRule: { kind: 'all' },
        });
        if (!cancelled) setTotal(res.data.matchedCount);
      } catch {
        if (!cancelled) setTotal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [salesChannelId]);

  useEffect(() => {
    const seq = requestRef.current + 1;
    requestRef.current = seq;
    setCounting(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await productFeedsClient.previewSelection({
            salesChannelId,
            selectionRule: value,
          });
          if (requestRef.current !== seq) return;
          setPreview(res.data);
          setCountError(null);
        } catch (err) {
          if (requestRef.current !== seq) return;
          setPreview(null);
          setCountError(
            err instanceof ApiError ? err.envelope.error.message : t('feeds.criteria.error'),
          );
        } finally {
          if (requestRef.current === seq) setCounting(false);
        }
      })();
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [salesChannelId, value, t]);

  const builtinFields = useMemo<RuleBuilderBuiltinField[]>(
    () => [
      {
        key: 'category',
        kind: 'set',
        ops: ['in', 'notIn'],
        label: t('feeds.criteria.field.category'),
        seed: { op: 'in', values: [] },
      },
      { key: 'productType', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'], label: t('feeds.criteria.field.productType') },
      { key: 'status', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn'], label: t('feeds.criteria.field.status') },
      { key: 'stockState', kind: 'set', ops: ['eq', 'neq'], label: t('feeds.criteria.field.stockState') },
      { key: 'price', kind: 'number', ops: ['gte', 'lte', 'gt', 'lt', 'between'], label: t('feeds.criteria.field.price') },
      { key: 'brand', kind: 'string', ops: ['eq', 'neq', 'in', 'notIn', 'contains', 'startsWith', 'isSet', 'isNotSet'], label: t('feeds.criteria.field.brand') },
      { key: 'createdAt', kind: 'string', ops: ['gte', 'lte', 'between'], label: t('feeds.criteria.field.createdAt') },
      { key: 'updatedAt', kind: 'string', ops: ['gte', 'lte', 'between'], label: t('feeds.criteria.field.updatedAt') },
    ],
    [t],
  );

  const attributeFields = useMemo<RuleAttributeField[]>(
    () =>
      attributes.map((attribute) => ({
        attributeKey: attribute.key,
        label: localized(attribute.label, attribute.labelDefault || attribute.key),
      })),
    [attributes, localized],
  );

  const fieldOptions = useMemo<RuleFieldOptions>(
    () => ({
      category: categories.map((category) => ({
        value: category.id,
        label: localized(category.name, category.slug),
      })),
      status: [
        { value: 'active', label: 'active' },
        { value: 'inactive', label: 'inactive' },
        { value: 'draft', label: 'draft' },
      ],
      productType: ['simple', 'configurable', 'grouped', 'bundle', 'virtual'].map((type) => ({
        value: type,
        label: type,
      })),
      stockState: [
        { value: 'in_stock', label: t('feeds.criteria.stock.inStock') },
        { value: 'out_of_stock', label: t('feeds.criteria.stock.outOfStock') },
      ],
    }),
    [categories, localized, t],
  );

  const zeroMatch = !counting && countError === null && preview?.matchedCount === 0;

  return (
    <div className="flex flex-col gap-3" title={props.disabledTitle}>
      <RuleBuilder<ProductSelectionRule>
        value={value}
        onChange={onChange}
        builtinFields={builtinFields}
        attributeFields={attributeFields}
        fieldOptions={fieldOptions}
        labels={{
          builtinGroup: t('feeds.criteria.group.product'),
          attributeGroup: t('feeds.criteria.group.attribute'),
          matchAll: t('feeds.criteria.matchAll'),
          valuesPlaceholder: t('feeds.criteria.values.placeholder'),
          valuesLabel: t('feeds.criteria.values.label'),
          valuesSearchPlaceholder: t('feeds.criteria.values.search'),
        }}
        disabled={disabled}
      />

      <div aria-live="polite" className="text-sm text-muted-foreground">
        {counting ? (
          <span className="b2b-help">{t('feeds.criteria.counting')}</span>
        ) : countError !== null ? (
          <span className="text-destructive">{countError}</span>
        ) : preview ? (
          <>
            <span>
              {t('feeds.criteria.count', {
                matched: preview.matchedCount,
                total: total ?? preview.matchedCount,
              })}
            </span>
            {preview.sample.length > 0 && (
              <span className="ml-1">
                {t('feeds.criteria.sample', {
                  skus: preview.sample
                    .slice(0, SAMPLE_SKUS_SHOWN)
                    .map((item) => item.sku)
                    .join(', '),
                })}
              </span>
            )}
          </>
        ) : null}
      </div>

      {zeroMatch && (
        <Alert variant="destructive">
          <AlertDescription>{t('feeds.criteria.zeroMatch')}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
