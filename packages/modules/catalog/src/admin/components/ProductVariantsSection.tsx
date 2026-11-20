import { useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  EditorSection,
  InlineStatus,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { ImmediateBadge } from '@endora-commerce/admin-kit/components';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useConfirmRemoval } from './editor/confirm-removal.js';
import { RowRemoveButton } from './editor/RowRemoveButton.js';
import { useProductEditor } from './editor/editor-context.js';
import {
  OPTION_VALUE_TYPES,
  buildVariantAttributeValues,
  draftFromVariantValues,
  findVariantWithSameValues,
  formatVariantAxisValue,
  pickAttributeLabel,
  selectVariantAxes,
  unknownVariantKeys,
  type SetAttributeForAxes,
  type VariantAxis,
  type VariantAxisDraft,
} from '../lib/variant-axes.js';

/**
 * The product editor's Variants tab (feature 002 T054; issue #1457, UX audit CAT-04) — admin
 * CRUD for the variants of a configurable product. Variant writes apply at once (the section
 * carries the "Applies immediately" badge) and sit outside the editor's one Save.
 *
 * A variant's attribute values are chosen with one control per **variant axis** — an attribute
 * of the product's saved attribute set flagged `isVariantAxis` — with the attribute's options,
 * not typed as `key=value` text; the table shows one column per axis. The axes are read from the
 * catalog's own admin reads: the attributes flagged as axes (`…/attributes/by-flag`), the set's
 * attributes (`…/attribute-sets/:id`) and each option attribute's options. Stock is not asked
 * for: the Inventory tab owns it, per warehouse.
 */

interface AdminVariant {
  id: string;
  parentProductId: string;
  sku: string;
  variantAttributeValues: Record<string, unknown>;
  stockLevel: number | null;
  createdAt: string;
  updatedAt: string;
}

interface AxisOptionRow {
  value: string;
  label: Record<string, string>;
  labelDefault: string;
  sortOrder: number;
}

type AxisErrors = Record<string, 'required' | 'invalid'>;

/** The axes of the product's saved attribute set; `null` while they load. */
function useVariantAxes(setId: string, language: string): { axes: VariantAxis[] | null; failed: boolean } {
  const [axes, setAxes] = useState<VariantAxis[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!setId) {
      setAxes([]);
      setFailed(false);
      return undefined;
    }
    let cancelled = false;
    setAxes(null);
    setFailed(false);
    void (async (): Promise<void> => {
      try {
        const [flagged, set] = await Promise.all([
          apiClient.get<{ data: { items: Array<{ id: string }> } }>('/api/v1/admin/catalog/attributes/by-flag?flag=isVariantAxis'),
          apiClient.get<{ data: { attributes: SetAttributeForAxes[] } }>(
            `/api/v1/admin/catalog/attribute-sets/${encodeURIComponent(setId)}`,
          ),
        ]);
        const ids = new Set((flagged.data?.items ?? []).map((a) => a.id));
        const selected = selectVariantAxes(set.data?.attributes ?? [], ids, language);
        const withOptions = await Promise.all(
          selected.map(async (axis): Promise<VariantAxis> => {
            if (!OPTION_VALUE_TYPES.has(axis.valueType)) return axis;
            const res = await apiClient.get<{ data: { items: AxisOptionRow[] } }>(
              `/api/v1/admin/catalog/attributes/${encodeURIComponent(axis.id)}/options`,
            );
            const options = [...(res.data?.items ?? [])]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((o) => ({ value: o.value, label: pickAttributeLabel(o.label, o.labelDefault || o.value, language) }));
            return { ...axis, options };
          }),
        );
        if (!cancelled) setAxes(withOptions);
      } catch {
        if (!cancelled) {
          setAxes([]);
          setFailed(true);
        }
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [setId, language]);
  return { axes, failed };
}

export function ProductVariantsSection({ productId, readOnly = false }: { productId: string; readOnly?: boolean }): ReactNode {
  const t = useTranslation('catalog');
  const language = useContext(AppLanguageContext)?.language ?? 'en';
  const ctx = useProductEditor();
  const setId = ctx.state.data?.product.attributeSetId ?? '';
  const { axes, failed: axesFailed } = useVariantAxes(setId, language);
  const { ask, dialog: removalDialog } = useConfirmRemoval();
  const [variants, setVariants] = useState<AdminVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // Issue #410 — the admin read answers every variant whatever the product's status or
      // channels; the storefront's product read answers an inactive product 410 and an
      // out-of-channel one 404.
      const res = await apiClient.get<{ data: AdminVariant[] }>(`/api/v1/admin/catalog/products/${productId}/variants`);
      setVariants(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.variants.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: { sku: string; variantAttributeValues: Record<string, unknown> }): Promise<boolean> => {
      setError(null);
      setInfo(null);
      try {
        await apiClient.post<{ data: AdminVariant }>(`/api/v1/admin/catalog/products/${productId}/variants`, input);
        setInfo(t('productEditor.variants.success.create', { sku: input.sku }));
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.variants.error.create'));
        return false;
      }
    },
    [productId, refresh, t],
  );

  const handleUpdate = useCallback(
    async (variant: AdminVariant, variantAttributeValues: Record<string, unknown>): Promise<boolean> => {
      setError(null);
      setInfo(null);
      try {
        await apiClient.patch<{ data: AdminVariant }>(`/api/v1/admin/catalog/products/${productId}/variants/${variant.id}`, {
          variantAttributeValues,
        });
        setInfo(t('productEditor.variants.success.update', { sku: variant.sku }));
        setEditingId(null);
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.variants.error.update'));
        return false;
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (variantId: string, sku: string): Promise<void> => {
      if (!(await ask(t('productEditor.variants.deleteConfirm', { sku })))) return;
      setError(null);
      setInfo(null);
      try {
        await apiClient.delete<void>(`/api/v1/admin/catalog/products/${productId}/variants/${variantId}`);
        setInfo(t('productEditor.variants.success.delete', { sku }));
        if (editingId === variantId) setEditingId(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.variants.error.delete'));
      }
    },
    [productId, refresh, ask, t, editingId],
  );

  const axisList = axes ?? [];
  const otherKeys = unknownVariantKeys(axisList, variants);
  const valueLabels = {
    yes: t('productEditor.attributes.yes'),
    no: t('productEditor.attributes.no'),
    empty: '—',
  };

  return (
    <EditorSection
      title={
        <>
          {t('productEditor.variants.title')}
          {readOnly ? null : <ImmediateBadge />}
        </>
      }
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {/* Mounted before it has text, so the outcome of a write is announced (WCAG 4.1.3). No
          frame of its own: a box inside the editor card reads as another object (#1488). */}
      <InlineStatus>{info}</InlineStatus>
      {axesFailed ? (
        <Alert variant="warning">
          <AlertDescription>{t('productEditor.variants.error.axes')}</AlertDescription>
        </Alert>
      ) : null}

      {loading || axes === null ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('productEditor.loading')}
        </p>
      ) : variants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('productEditor.variants.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('productEditor.variants.column.sku')}</TableHead>
              {axisList.map((axis) => (
                <TableHead key={axis.key}>{axis.label}</TableHead>
              ))}
              {otherKeys.length > 0 ? <TableHead>{t('productEditor.variants.column.other')}</TableHead> : null}
              {readOnly ? null : (
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.variants.column.actions')}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((v) =>
              editingId === v.id && !readOnly ? (
                <EditVariantRow
                  key={v.id}
                  variant={v}
                  axes={axisList}
                  variants={variants}
                  otherKeys={otherKeys}
                  onSave={(values): Promise<boolean> => handleUpdate(v, values)}
                  onCancel={(): void => setEditingId(null)}
                />
              ) : (
                <TableRow key={v.id}>
                  <TableCell className="font-mono">{v.sku}</TableCell>
                  {axisList.map((axis) => (
                    <TableCell key={axis.key}>{formatVariantAxisValue(axis, v.variantAttributeValues[axis.key], valueLabels)}</TableCell>
                  ))}
                  {otherKeys.length > 0 ? <OtherValuesCell values={v.variantAttributeValues} keys={otherKeys} /> : null}
                  {readOnly ? null : (
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {axisList.length > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="max-lg:h-11 max-lg:w-11"
                            aria-label={t('productEditor.variants.action.editFor', { sku: v.sku })}
                            title={t('productEditor.variants.action.editFor', { sku: v.sku })}
                            onClick={(): void => setEditingId(v.id)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        ) : null}
                        <RowRemoveButton
                          label={t('productEditor.variants.action.deleteFor', { sku: v.sku })}
                          onClick={(): void => void handleDelete(v.id, v.sku)}
                        />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}

      {readOnly || axes === null || axesFailed ? null : axisList.length === 0 ? (
        <div className="border-t pt-4 text-sm">
          <p className="text-muted-foreground">{t('productEditor.variants.noAxes.body')}</p>
          <Link to="/catalog/attribute-sets" className="mt-1 inline-block underline underline-offset-2">
            {t('productEditor.variants.noAxes.action')}
          </Link>
        </div>
      ) : (
        <CreateVariantInline axes={axisList} variants={variants} onCreate={handleCreate} />
      )}
      {removalDialog}
    </EditorSection>
  );
}

function OtherValuesCell({ values, keys }: { values: Record<string, unknown>; keys: readonly string[] }): ReactNode {
  const present = keys.filter((k) => values[k] !== undefined);
  return (
    <TableCell className="font-mono text-xs text-muted-foreground">
      {present.length === 0 ? '—' : present.map((k) => `${k}: ${typeof values[k] === 'object' ? JSON.stringify(values[k]) : String(values[k])}`).join(', ')}
    </TableCell>
  );
}

/** One control per axis: a select of the options, Yes / No, or a typed input. */
function AxisControl({
  axis,
  id,
  value,
  error,
  errorId,
  disabled,
  ariaLabel,
  onChange,
}: {
  axis: VariantAxis;
  id: string;
  value: string;
  error: 'required' | 'invalid' | undefined;
  errorId: string;
  disabled: boolean;
  /** Set when the control has no visible `<label>` (in a table row). */
  ariaLabel?: string;
  onChange: (value: string) => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const common = {
    id,
    value,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
  };
  if (axis.valueType === 'boolean' || axis.options) {
    const options =
      axis.valueType === 'boolean'
        ? [
            { value: 'true', label: t('productEditor.attributes.yes') },
            { value: 'false', label: t('productEditor.attributes.no') },
          ]
        : (axis.options ?? []);
    return (
      <Select {...common} onChange={(e): void => onChange(e.target.value)}>
        <option value="">{t('productEditor.variants.field.choose')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  }
  const numeric = axis.valueType === 'number' || axis.valueType === 'price';
  return (
    <Input
      {...common}
      type={axis.valueType === 'date' ? 'date' : 'text'}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={(e): void => onChange(e.target.value)}
    />
  );
}

function AxisError({ id, error }: { id: string; error: 'required' | 'invalid' | undefined }): ReactNode {
  const t = useTranslation('catalog');
  if (!error) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {t(error === 'required' ? 'productEditor.variants.error.axisRequired' : 'productEditor.variants.error.axisInvalid')}
    </p>
  );
}

function toAxisErrors(missing: readonly string[], invalid: readonly string[]): AxisErrors {
  const errors: AxisErrors = {};
  for (const key of missing) errors[key] = 'required';
  for (const key of invalid) errors[key] = 'invalid';
  return errors;
}

function CreateVariantInline({
  axes,
  variants,
  onCreate,
}: {
  axes: readonly VariantAxis[];
  variants: readonly AdminVariant[];
  onCreate: (input: { sku: string; variantAttributeValues: Record<string, unknown> }) => Promise<boolean>;
}): ReactNode {
  const t = useTranslation('catalog');
  const baseId = useId();
  const [sku, setSku] = useState('');
  const [draft, setDraft] = useState<VariantAxisDraft>({});
  const [skuError, setSkuError] = useState(false);
  const [axisErrors, setAxisErrors] = useState<AxisErrors>({});
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const trimmedSku = sku.trim();
    const built = buildVariantAttributeValues(axes, draft);
    const errors = toAxisErrors(built.missing, built.invalid);
    setSkuError(trimmedSku === '');
    setAxisErrors(errors);
    const duplicate = Object.keys(errors).length === 0 ? findVariantWithSameValues(axes, variants, built.values) : null;
    setDuplicateOf(duplicate?.sku ?? null);
    if (trimmedSku === '' || Object.keys(errors).length > 0 || duplicate) return;
    setBusy(true);
    const ok = await onCreate({ sku: trimmedSku, variantAttributeValues: built.values });
    setBusy(false);
    if (ok) {
      setSku('');
      setDraft({});
    }
  };

  const skuId = `${baseId}-sku`;
  const duplicateId = `${baseId}-duplicate`;
  return (
    <div className="grid gap-3 border-t pt-4 md:grid-cols-4" role="group" aria-label={t('productEditor.variants.createTitle')}>
      <div className="space-y-1">
        <Label htmlFor={skuId}>{t('productEditor.variants.field.sku')}</Label>
        <Input
          id={skuId}
          value={sku}
          required
          disabled={busy}
          aria-invalid={skuError || undefined}
          aria-describedby={skuError ? `${skuId}-error` : undefined}
          onChange={(e): void => {
            setSku(e.target.value);
            if (skuError && e.target.value.trim() !== '') setSkuError(false);
          }}
        />
        {skuError ? (
          <p id={`${skuId}-error`} className="text-xs text-destructive">
            {t('productEditor.variants.error.skuRequired')}
          </p>
        ) : null}
      </div>
      {axes.map((axis) => {
        const id = `${baseId}-axis-${axis.key}`;
        return (
          <div key={axis.key} className="space-y-1">
            <Label htmlFor={id}>{axis.label}</Label>
            <AxisControl
              axis={axis}
              id={id}
              value={draft[axis.key] ?? ''}
              error={axisErrors[axis.key]}
              errorId={`${id}-error`}
              disabled={busy}
              onChange={(value): void => {
                setDraft((d) => ({ ...d, [axis.key]: value }));
                setAxisErrors(({ [axis.key]: _cleared, ...rest }) => rest);
                setDuplicateOf(null);
              }}
            />
            <AxisError id={`${id}-error`} error={axisErrors[axis.key]} />
          </div>
        );
      })}
      <div className="space-y-2 md:col-span-4">
        {duplicateOf ? (
          <p id={duplicateId} role="alert" className="text-sm text-destructive">
            {t('productEditor.variants.error.duplicate', { sku: duplicateOf })}
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          aria-busy={busy || undefined}
          aria-describedby={duplicateOf ? duplicateId : undefined}
          className="max-lg:min-h-11"
          onClick={(): void => void submit()}
        >
          <Plus aria-hidden="true" />
          {t('productEditor.variants.action.add')}
        </Button>
      </div>
    </div>
  );
}

function EditVariantRow({
  variant,
  axes,
  variants,
  otherKeys,
  onSave,
  onCancel,
}: {
  variant: AdminVariant;
  axes: readonly VariantAxis[];
  variants: readonly AdminVariant[];
  otherKeys: readonly string[];
  onSave: (values: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const baseId = useId();
  const [draft, setDraft] = useState<VariantAxisDraft>(() => draftFromVariantValues(axes, variant.variantAttributeValues));
  const [axisErrors, setAxisErrors] = useState<AxisErrors>({});
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    const built = buildVariantAttributeValues(axes, draft, variant.variantAttributeValues);
    const errors = toAxisErrors(built.missing, built.invalid);
    setAxisErrors(errors);
    const duplicate = Object.keys(errors).length === 0 ? findVariantWithSameValues(axes, variants, built.values, variant.id) : null;
    setDuplicateOf(duplicate?.sku ?? null);
    if (Object.keys(errors).length > 0 || duplicate) return;
    setBusy(true);
    const ok = await onSave(built.values);
    if (!ok) setBusy(false);
  };

  const duplicateId = `${baseId}-duplicate`;
  return (
    <TableRow>
      <TableCell className="font-mono">{variant.sku}</TableCell>
      {axes.map((axis) => {
        const id = `${baseId}-axis-${axis.key}`;
        return (
          <TableCell key={axis.key} className="space-y-1 align-top">
            <AxisControl
              axis={axis}
              id={id}
              value={draft[axis.key] ?? ''}
              error={axisErrors[axis.key]}
              errorId={`${id}-error`}
              disabled={busy}
              ariaLabel={axis.label}
              onChange={(value): void => {
                setDraft((d) => ({ ...d, [axis.key]: value }));
                setAxisErrors(({ [axis.key]: _cleared, ...rest }) => rest);
                setDuplicateOf(null);
              }}
            />
            <AxisError id={`${id}-error`} error={axisErrors[axis.key]} />
          </TableCell>
        );
      })}
      {otherKeys.length > 0 ? <OtherValuesCell values={variant.variantAttributeValues} keys={otherKeys} /> : null}
      <TableCell className="align-top">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-lg:min-h-11"
            disabled={busy}
            aria-busy={busy || undefined}
            aria-describedby={duplicateOf ? duplicateId : undefined}
            onClick={(): void => void save()}
          >
            {t('productEditor.variants.action.save')}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="max-lg:min-h-11" disabled={busy} onClick={onCancel}>
            {t('productEditor.variants.action.cancel')}
          </Button>
        </div>
        {duplicateOf ? (
          <p id={duplicateId} role="alert" className="mt-1 text-xs text-destructive">
            {t('productEditor.variants.error.duplicate', { sku: duplicateOf })}
          </p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
