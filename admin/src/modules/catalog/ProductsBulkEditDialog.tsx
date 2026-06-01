import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { CategoryTreePicker } from '@/components/category-tree-picker';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Feature 022 — Products Bulk Edit dialog.
 *
 * Rendered as a fixed-overlay panel on top of the products list when the
 * admin clicks "Bulk Edit" from the selection toolbar. Each field-group
 * starts in an "untouched" state — only modified fields are sent to the
 * backend. Attributes flagged `mass_editable=true` are fetched once on
 * open via `/attributes/by-flag?flag=isMassEditable`.
 */

type BulkStatus = 'draft' | 'active' | 'inactive';
type BulkVisibility = 'public' | 'logged_in_only' | 'organization_restricted';
type BulkMode = 'add' | 'replace';

interface AdminAttributeSummary {
  id: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  valueType: string;
}

interface SalesChannel {
  id: string;
  code: string;
  name: Record<string, string> | string;
}

interface AdminCategory {
  id: string;
  parentCategoryId: string | null;
  slug: string;
  name: Record<string, string>;
  sortOrder: number;
}

interface BulkUpdateResultRow {
  productId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  reason?: string;
  details?: { code?: string; message?: string; attribute?: string };
  changedFields?: string[];
}

interface BulkUpdateResponse {
  data: {
    bulkOperationId: string;
    summary: { succeeded: number; skipped: number; failed: number; total: number };
    results: BulkUpdateResultRow[];
  };
}

export interface ProductsBulkEditDialogProps {
  productIds: string[];
  /** Feature 033 — whether ids came from page-only or full filtered collection. */
  selectionScope?: 'page' | 'collection';
  onClose: () => void;
  /** Invoked after a successful apply so the parent can refresh the list. */
  onApplied?: () => void;
}

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.4)',
  zIndex: 50,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const PANEL_STYLE: CSSProperties = {
  background: 'var(--bg-surface, #fff)',
  borderRadius: 8,
  width: 640,
  maxWidth: '90vw',
  maxHeight: '90vh',
  overflow: 'auto',
  boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
  padding: 0,
};

export function ProductsBulkEditDialog(props: ProductsBulkEditDialogProps): ReactNode {
  const t = useTranslation('catalog');
  const { productIds, selectionScope, onClose, onApplied } = props;

  // Touched flags — a field is sent to the backend only when its touched
  // flag is true. Default values are placeholders that are NOT sent.
  const [touchStatus, setTouchStatus] = useState(false);
  const [status, setStatus] = useState<BulkStatus>('active');

  const [touchVisibility, setTouchVisibility] = useState(false);
  const [visibility, setVisibility] = useState<BulkVisibility>('public');

  const [touchChannels, setTouchChannels] = useState(false);
  const [channelsMode, setChannelsMode] = useState<BulkMode>('add');
  const [channelIds, setChannelIds] = useState<string[]>([]);

  const [touchCategories, setTouchCategories] = useState(false);
  const [categoriesMode, setCategoriesMode] = useState<BulkMode>('add');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const [attributeValues, setAttributeValues] = useState<Record<string, unknown>>({});
  const [touchedAttrs, setTouchedAttrs] = useState<Set<string>>(new Set());

  // Catalog metadata fetched on open.
  const [attrs, setAttrs] = useState<AdminAttributeSummary[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkUpdateResponse['data'] | null>(null);

  // Load mass-editable attributes + channel / category metadata on mount.
  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const [attrRes, chRes, catRes] = await Promise.all([
          apiClient.get<{ data: { items: AdminAttributeSummary[] } }>(
            '/api/v1/admin/catalog/attributes/by-flag?flag=isMassEditable',
          ),
          apiClient
            .get<{ data: SalesChannel[] }>('/api/v1/admin/sales-channels')
            .catch(() => ({ data: [] as SalesChannel[] })),
          apiClient
            .get<{ data: AdminCategory[] }>('/api/v1/admin/catalog/categories')
            .catch(() => ({ data: [] as AdminCategory[] })),
        ]);
        if (cancelled) return;
        setAttrs(attrRes.data.items);
        setChannels(chRes.data);
        setCategories(catRes.data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.envelope.error.message : String(e));
        }
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  const anyTouched = useMemo(
    () =>
      touchStatus ||
      touchVisibility ||
      touchChannels ||
      touchCategories ||
      touchedAttrs.size > 0,
    [touchStatus, touchVisibility, touchChannels, touchCategories, touchedAttrs],
  );

  const submit = useCallback(async (): Promise<void> => {
    if (!anyTouched) {
      setError(t('productsList.bulkEdit.empty'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fields: Record<string, unknown> = {};
      if (touchStatus) fields.status = status;
      if (touchVisibility) fields.visibility = visibility;
      if (touchChannels) {
        fields.salesChannels = { mode: channelsMode, channelIds };
      }
      if (touchCategories) {
        fields.categories = { mode: categoriesMode, categoryIds };
      }
      if (touchedAttrs.size > 0) {
        const av: Record<string, unknown> = {};
        for (const k of touchedAttrs) av[k] = attributeValues[k];
        fields.attributeValues = av;
      }
      const res = await apiClient.post<BulkUpdateResponse>(
        '/api/v1/admin/catalog/products/bulk-update',
        { productIds, fields },
      );
      setResult(res.data);
      onApplied?.();
    } catch (e) {
      if (e instanceof ApiError) {
        const code = e.envelope.error.code;
        if (code === 'ATTRIBUTE_NOT_MASS_EDITABLE') {
          const details = e.envelope.error.details as { attribute?: string } | undefined;
          setError(
            t('productsList.bulkEdit.error.attribute_not_mass_editable', {
              attribute: details?.attribute ?? '?',
            }),
          );
        } else if (code === 'BULK_TOO_LARGE') {
          const details = e.envelope.error.details as
            | { maxBatchSize?: number }
            | undefined;
          setError(
            t('productsList.bulkEdit.error.bulk_too_large', {
              total: productIds.length,
              maxBatchSize: details?.maxBatchSize ?? 200,
            }),
          );
        } else {
          setError(e.envelope.error.message);
        }
      } else {
        setError(String(e));
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    anyTouched,
    touchStatus,
    status,
    touchVisibility,
    visibility,
    touchChannels,
    channelsMode,
    channelIds,
    touchCategories,
    categoriesMode,
    categoryIds,
    touchedAttrs,
    attributeValues,
    productIds,
    onApplied,
    t,
  ]);

  return (
    <div style={OVERLAY_STYLE} role="dialog" aria-modal="true">
      <div style={PANEL_STYLE}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border, #e5e7eb)',
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {t('productsList.bulkEdit.title', { count: productIds.length })}
            </div>
            {selectionScope ? (
              <div className="b2b-muted" style={{ fontSize: 12, marginTop: 2 }}>
                {selectionScope === 'collection'
                  ? t('productsList.selection.scopeCollection')
                  : t('productsList.selection.scopePage')}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
            onClick={onClose}
            aria-label="close"
          >
            <X size={14} />
          </button>
        </div>

        {error ? (
          <div
            style={{
              margin: '12px 18px 0',
              padding: '10px 12px',
              background: 'var(--danger-soft, #fee2e2)',
              color: 'var(--danger-soft-fg, #991b1b)',
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        {result ? (
          <BulkEditSummary result={result} onClose={onClose} t={t} />
        ) : (
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <FieldGroup
              label={t('productsList.bulkEdit.section.status')}
              touched={touchStatus}
              onToggle={setTouchStatus}
              t={t}
            >
              <select
                className="b2b-field"
                disabled={!touchStatus}
                value={status}
                onChange={(e): void => setStatus(e.target.value as BulkStatus)}
              >
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.visibility')}
              touched={touchVisibility}
              onToggle={setTouchVisibility}
              t={t}
            >
              <select
                className="b2b-field"
                disabled={!touchVisibility}
                value={visibility}
                onChange={(e): void => setVisibility(e.target.value as BulkVisibility)}
              >
                <option value="public">public</option>
                <option value="logged_in_only">logged_in_only</option>
                <option value="organization_restricted">organization_restricted</option>
              </select>
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.salesChannels')}
              touched={touchChannels}
              onToggle={setTouchChannels}
              t={t}
            >
              <ModePicker
                mode={channelsMode}
                onChange={setChannelsMode}
                disabled={!touchChannels}
                t={t}
              />
              <MultiSelect
                options={channels.map((c) => ({
                  id: c.id,
                  label:
                    typeof c.name === 'string'
                      ? c.name
                      : c.name['en-US'] ?? c.name['pl-PL'] ?? c.code,
                }))}
                selected={channelIds}
                onChange={setChannelIds}
                disabled={!touchChannels}
              />
            </FieldGroup>

            <FieldGroup
              label={t('productsList.bulkEdit.section.categories')}
              touched={touchCategories}
              onToggle={setTouchCategories}
              t={t}
            >
              <ModePicker
                mode={categoriesMode}
                onChange={setCategoriesMode}
                disabled={!touchCategories}
                t={t}
              />
              <CategoryTreePicker
                categories={categories}
                selectedIds={categoryIds}
                onChange={setCategoryIds}
                disabled={!touchCategories}
              />
            </FieldGroup>

            {attrs.length > 0 ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  {t('productsList.bulkEdit.section.attributes')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {attrs.map((a) => {
                    const touched = touchedAttrs.has(a.key);
                    return (
                      <div
                        key={a.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: 10,
                          background: 'var(--bg-muted, #f8fafc)',
                          borderRadius: 6,
                        }}
                      >
                        <input
                          type="checkbox"
                          className="b2b-cbx"
                          checked={touched}
                          onChange={(): void => {
                            setTouchedAttrs((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.key)) {
                                next.delete(a.key);
                              } else {
                                next.add(a.key);
                              }
                              return next;
                            });
                          }}
                        />
                        <div style={{ minWidth: 140, fontSize: 13 }}>
                          {a.label['en-US'] ?? a.labelDefault}
                        </div>
                        <input
                          type="text"
                          className="b2b-field"
                          disabled={!touched}
                          style={{ flex: 1 }}
                          value={(attributeValues[a.key] as string | undefined) ?? ''}
                          onChange={(e): void =>
                            setAttributeValues((prev) => ({ ...prev, [a.key]: e.target.value }))
                          }
                          placeholder={a.valueType}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {!result ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: 14,
              borderTop: '1px solid var(--border, #e5e7eb)',
            }}
          >
            <button
              type="button"
              className="b2b-btn"
              onClick={onClose}
              disabled={submitting}
            >
              {t('productsList.bulkEdit.action.cancel')}
            </button>
            <button
              type="button"
              className="b2b-btn b2b-btn--primary"
              onClick={(): void => {
                void submit();
              }}
              disabled={submitting || !anyTouched}
            >
              {t('productsList.bulkEdit.action.apply')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface FieldGroupProps {
  label: string;
  touched: boolean;
  onToggle: (next: boolean) => void;
  t: ReturnType<typeof useTranslation>;
  children: ReactNode;
}

function FieldGroup(props: FieldGroupProps): ReactNode {
  return (
    <div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 6,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          className="b2b-cbx"
          checked={props.touched}
          onChange={(e): void => props.onToggle(e.target.checked)}
        />
        {props.label}
        {!props.touched ? (
          <span style={{ fontWeight: 400, color: 'var(--fg-muted, #64748b)', fontSize: 12 }}>
            {props.t('productsList.bulkEdit.untouched')}
          </span>
        ) : null}
      </label>
      <div style={{ paddingLeft: 26, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {props.children}
      </div>
    </div>
  );
}

interface ModePickerProps {
  mode: BulkMode;
  onChange: (next: BulkMode) => void;
  disabled: boolean;
  t: ReturnType<typeof useTranslation>;
}

function ModePicker(props: ModePickerProps): ReactNode {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {(['add', 'replace'] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={`b2b-btn b2b-btn--sm${props.mode === m ? ' b2b-btn--primary' : ''}`}
          disabled={props.disabled}
          onClick={(): void => props.onChange(m)}
        >
          {props.t(`productsList.bulkEdit.mode.${m}`)}
        </button>
      ))}
    </div>
  );
}

interface MultiSelectProps {
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

function MultiSelect(props: MultiSelectProps): ReactNode {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        opacity: props.disabled ? 0.5 : 1,
        pointerEvents: props.disabled ? 'none' : 'auto',
      }}
    >
      {props.options.map((o) => {
        const active = props.selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            className={`b2b-btn b2b-btn--sm${active ? ' b2b-btn--primary' : ''}`}
            onClick={(): void => {
              if (active) {
                props.onChange(props.selected.filter((x) => x !== o.id));
              } else {
                props.onChange([...props.selected, o.id]);
              }
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

interface BulkEditSummaryProps {
  result: BulkUpdateResponse['data'];
  onClose: () => void;
  t: ReturnType<typeof useTranslation>;
}

function BulkEditSummary(props: BulkEditSummaryProps): ReactNode {
  const { summary, results } = props.result;
  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <SummaryBadge
          label={props.t('productsList.bulkEdit.summary.succeeded')}
          count={summary.succeeded}
          color="#16a34a"
        />
        <SummaryBadge
          label={props.t('productsList.bulkEdit.summary.skipped')}
          count={summary.skipped}
          color="#ca8a04"
        />
        <SummaryBadge
          label={props.t('productsList.bulkEdit.summary.failed')}
          count={summary.failed}
          color="#dc2626"
        />
        <SummaryBadge
          label={props.t('productsList.bulkEdit.summary.total')}
          count={summary.total}
          color="#475569"
        />
      </div>

      {results.some((r) => r.status !== 'succeeded') ? (
        <div
          style={{
            maxHeight: 260,
            overflow: 'auto',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 6,
          }}
        >
          <table className="b2b-tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Product</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {results
                .filter((r) => r.status !== 'succeeded')
                .map((r) => (
                  <tr key={r.productId}>
                    <td>
                      <a
                        href={`/catalog/products/${r.productId}`}
                        style={{ color: 'var(--primary-color, #2563eb)' }}
                      >
                        {r.productId.slice(0, 8)}…
                      </a>
                    </td>
                    <td>{r.status}</td>
                    <td>
                      {r.reason
                        ? props.t(`productsList.bulkEdit.reason.${r.reason}`)
                        : ''}
                      {r.details?.attribute ? ` (${r.details.attribute})` : ''}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="b2b-btn b2b-btn--primary"
          onClick={props.onClose}
        >
          {props.t('productsList.bulkEdit.action.cancel')}
        </button>
      </div>
    </div>
  );
}

function SummaryBadge(props: { label: string; count: number; color: string }): ReactNode {
  return (
    <div
      style={{
        flex: 1,
        padding: '10px 12px',
        borderRadius: 6,
        background: 'var(--bg-muted, #f8fafc)',
        borderLeft: `4px solid ${props.color}`,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--fg-muted, #64748b)' }}>{props.label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: props.color }}>{props.count}</div>
    </div>
  );
}
