import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';

// Feature 002 (T035) — DB-level value types. Foundation 001 had
// the original 5 (string, number, boolean, enum, date); 002 adds
// `multiselect` and `price`. The presentation hint
// `displayAsSlider` is honored only when valueType ∈ (number, price).
const VALUE_TYPES = ['string', 'number', 'boolean', 'enum', 'multiselect', 'price'] as const;
type ValueType = (typeof VALUE_TYPES)[number];

interface AdminAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  /** Feature 012 — fallback label used when active locale is missing from `label`. */
  labelDefault: string;
  valueType: ValueType;
  /** Legacy projection from `attribute_options` rows (feature 012 read shape). */
  enumValues: string[] | null;
  isSearchable: boolean;
  isFilterable: boolean;
  isVariantAxis: boolean;
  displayAsSlider: boolean;
  isComparable: boolean;
  /** Feature 012 — enforced at product save time when in the assigned set. */
  isRequired: boolean;
  /** Feature 012 — surfaces the attribute in the Promotion Rule criterion picker. */
  isPromoRule: boolean;
  /** Feature 012 — ascending sort order on the storefront filter sidebar. */
  filterPosition: number;
  /** Feature 012 — gates inclusion in the storefront PDP "Parametry produktu" tab. */
  isVisibleOnProductPage: boolean;
  /** Feature 022 — gates appearance in the Products Bulk Edit dialog. */
  massEditable: boolean;
  /** Feature 039 — gates participation in Quick Order search. */
  quickSearchable: boolean;
  /** Feature 061 — backing product-host custom-field definition (read-only, additive). */
  customFieldDefinitionId?: string;
}

// Boolean flags surfaced as togglable checkbox columns in the list.
const FLAG_KEYS = [
  'isSearchable',
  'isFilterable',
  'isVariantAxis',
  'isComparable',
  'massEditable',
  'quickSearchable',
  'isPromoRule',
] as const;
type FlagKey = (typeof FLAG_KEYS)[number];
type FlagSet = Record<FlagKey, boolean>;

function flagsOf(a: AdminAttribute): FlagSet {
  return {
    isSearchable: a.isSearchable,
    isFilterable: a.isFilterable,
    isVariantAxis: a.isVariantAxis,
    isComparable: a.isComparable,
    massEditable: a.massEditable,
    quickSearchable: a.quickSearchable,
    isPromoRule: a.isPromoRule,
  };
}
function flagsEqual(a: FlagSet, b: FlagSet): boolean {
  return FLAG_KEYS.every((k) => a[k] === b[k]);
}

export function AttributesManager(): ReactNode {
  const t = useTranslation('catalog');
  const [attrs, setAttrs] = useState<AdminAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Per-attribute local flag drafts; only flushed to the API on Save.
  const [flagDrafts, setFlagDrafts] = useState<Record<string, FlagSet>>({});
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminAttribute[] }>(
        '/api/v1/admin/catalog/attributes',
      );
      setAttrs(res.data);
      setFlagDrafts(Object.fromEntries(res.data.map((a) => [a.id, flagsOf(a)])));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const editingAttr = useMemo(
    () => attrs.find((a) => a.id === editingId) ?? null,
    [attrs, editingId],
  );

  // Attributes whose checkbox draft differs from the persisted flags.
  const dirtyIds = useMemo(
    () => attrs.filter((a) => flagDrafts[a.id] && !flagsEqual(flagDrafts[a.id]!, flagsOf(a))).map((a) => a.id),
    [attrs, flagDrafts],
  );

  const toggleFlag = useCallback((id: string, key: FlagKey, value: boolean): void => {
    setFlagDrafts((prev) => ({ ...prev, [id]: { ...prev[id]!, [key]: value } }));
  }, []);

  const buildAttributePayload = (input: AttributeFormValues): Record<string, unknown> => {
    const label: Record<string, string> = {};
    if (input.labelEn) label['en-US'] = input.labelEn;
    if (input.labelPl) label['pl-PL'] = input.labelPl;
    return {
      label,
      isSearchable: input.isSearchable,
      isFilterable: input.isFilterable,
      isVariantAxis: input.isVariantAxis,
      isComparable: input.isComparable,
      massEditable: input.massEditable,
      quickSearchable: input.quickSearchable,
      isPromoRule: input.isPromoRule,
      ...(input.valueType === 'number' || input.valueType === 'price'
        ? { displayAsSlider: input.displayAsSlider }
        : {}),
    };
  };

  const handleCreate = useCallback(
    async (input: AttributeFormValues): Promise<void> => {
      // enumValues required for both `enum` (single-select) and `multiselect`.
      const enumValues =
        input.valueType === 'enum' || input.valueType === 'multiselect'
          ? input.enumValues
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      try {
        await apiClient.post<{ data: AdminAttribute }>('/api/v1/admin/catalog/attributes', {
          key: input.key,
          valueType: input.valueType,
          ...buildAttributePayload(input),
          ...(enumValues !== undefined ? { enumValues } : {}),
        });
        setInfo(t('attributes.success.create', { key: input.key }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.create'));
      }
    },
    [refresh, t],
  );

  const handleEditSave = useCallback(
    async (attr: AdminAttribute, input: AttributeFormValues): Promise<void> => {
      try {
        await apiClient.patch<{ data: AdminAttribute }>(
          `/api/v1/admin/catalog/attributes/${attr.key}`,
          buildAttributePayload(input),
        );
        setInfo(t('attributes.success.update', { key: attr.key }));
        setEditingId(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.update'));
      }
    },
    [refresh, t],
  );

  // Flush every dirty row's flags in one batch, then refresh once.
  const saveFlags = useCallback(async (): Promise<void> => {
    if (dirtyIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const id of dirtyIds) {
        const attr = attrs.find((a) => a.id === id);
        if (!attr) continue;
        await apiClient.patch(`/api/v1/admin/catalog/attributes/${attr.key}`, flagDrafts[id]!);
      }
      setInfo(t('attributes.success.flagsSaved', { count: dirtyIds.length }));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.update'));
    } finally {
      setSaving(false);
    }
  }, [attrs, dirtyIds, flagDrafts, refresh, t]);

  const resetFlags = useCallback((): void => {
    setFlagDrafts(Object.fromEntries(attrs.map((a) => [a.id, flagsOf(a)])));
  }, [attrs]);

  return (
    <>
      <PageHeader
        title={t('attributes.page.title')}
        description={t('attributes.page.description')}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {editingAttr ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('attributes.edit.title', { key: editingAttr.key })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <AttributeForm
              mode="edit"
              attribute={editingAttr}
              onSubmit={(input): Promise<void> => handleEditSave(editingAttr, input)}
              onCancel={(): void => setEditingId(null)}
            />
            {editingAttr.valueType === 'enum' || editingAttr.valueType === 'multiselect' ? (
              <AttributeOptionsEditor
                attribute={editingAttr}
                onError={setError}
                onChanged={(): void => void refresh()}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('attributes.create.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <AttributeForm mode="create" onSubmit={handleCreate} />
          </CardContent>
        </Card>
      )}

      {dirtyIds.length > 0 ? (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <span className="text-sm text-muted-foreground">
              {t('attributes.batch.unsaved', { count: dirtyIds.length })}
            </span>
            <Button size="sm" disabled={saving} onClick={(): void => void saveFlags()}>
              {t('attributes.action.save')}
            </Button>
            <Button size="sm" variant="ghost" disabled={saving} onClick={resetFlags}>
              {t('attributes.action.cancel')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('attributes.loading')}</p>
          ) : attrs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('attributes.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('attributes.column.key')}</TableHead>
                  <TableHead>{t('attributes.column.label')}</TableHead>
                  <TableHead>{t('attributes.column.type')}</TableHead>
                  <TableHead>{t('attributes.column.enumValues')}</TableHead>
                  <TableHead>{t('attributes.column.searchable')}</TableHead>
                  <TableHead>{t('attributes.column.filterable')}</TableHead>
                  <TableHead>{t('attributes.column.variantAxis')}</TableHead>
                  <TableHead>{t('attributes.column.comparable')}</TableHead>
                  <TableHead>{t('attributes.column.massEditable')}</TableHead>
                  <TableHead>{t('attributes.column.quickSearchable')}</TableHead>
                  <TableHead>{t('attributes.column.promoRule')}</TableHead>
                  <TableHead className="text-right">{t('attributes.column.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attrs.map((a) => {
                  const draft = flagDrafts[a.id] ?? flagsOf(a);
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <code className="font-mono text-xs">{a.key}</code>
                      </TableCell>
                      <TableCell>{a.label['en-US'] ?? Object.values(a.label)[0] ?? ''}</TableCell>
                      <TableCell>{a.valueType}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {a.enumValues && a.enumValues.length ? a.enumValues.join(', ') : '—'}
                      </TableCell>
                      {FLAG_KEYS.map((key) => (
                        <TableCell key={key}>
                          <Checkbox
                            checked={draft[key]}
                            aria-label={`${a.key}-${key}`}
                            onChange={(e): void => toggleFlag(a.id, key, e.target.checked)}
                          />
                        </TableCell>
                      ))}
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(): void => {
                            setEditingId(a.id);
                            setInfo(null);
                          }}
                        >
                          <Pencil />
                          {t('attributes.action.edit')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

interface AttributeFormValues {
  key: string;
  labelEn: string;
  labelPl: string;
  valueType: ValueType;
  enumValues: string;
  isSearchable: boolean;
  isFilterable: boolean;
  isVariantAxis: boolean;
  displayAsSlider: boolean;
  isComparable: boolean;
  massEditable: boolean;
  quickSearchable: boolean;
  isPromoRule: boolean;
}

interface AttributeFormProps {
  mode: 'create' | 'edit';
  attribute?: AdminAttribute;
  onSubmit: (input: AttributeFormValues) => Promise<void>;
  onCancel?: () => void;
}

/**
 * Shared create/edit form. In `edit` mode the `key` and `valueType` are locked
 * (immutable server-side) while the label and flags stay editable; enum /
 * multiselect options are managed by the separate {@link AttributeOptionsEditor}.
 */
function AttributeForm({ mode, attribute, onSubmit, onCancel }: AttributeFormProps): ReactNode {
  const t = useTranslation('catalog');
  const isEdit = mode === 'edit';
  const [key, setKey] = useState(attribute?.key ?? '');
  // Pre-fill from the stored label, tolerating older rows whose locale keys are
  // `en`/`pl` (or only `labelDefault`) rather than the canonical `en-US`/`pl-PL`.
  const [labelEn, setLabelEn] = useState(
    attribute?.label['en-US'] ?? attribute?.label['en'] ?? attribute?.labelDefault ?? '',
  );
  const [labelPl, setLabelPl] = useState(attribute?.label['pl-PL'] ?? attribute?.label['pl'] ?? '');
  const [valueType, setValueType] = useState<ValueType>(attribute?.valueType ?? 'string');
  const [enumValues, setEnumValues] = useState('');
  const [isSearchable, setIsSearchable] = useState(attribute?.isSearchable ?? false);
  const [isFilterable, setIsFilterable] = useState(attribute?.isFilterable ?? false);
  const [isVariantAxis, setIsVariantAxis] = useState(attribute?.isVariantAxis ?? false);
  const [displayAsSlider, setDisplayAsSlider] = useState(attribute?.displayAsSlider ?? false);
  const [isComparable, setIsComparable] = useState(attribute?.isComparable ?? false);
  const [massEditable, setMassEditable] = useState(attribute?.massEditable ?? false);
  const [quickSearchable, setQuickSearchable] = useState(attribute?.quickSearchable ?? false);
  const [isPromoRule, setIsPromoRule] = useState(attribute?.isPromoRule ?? false);
  const [busy, setBusy] = useState(false);
  const isNumeric = valueType === 'number' || valueType === 'price';

  const collect = (): AttributeFormValues => ({
    key,
    labelEn,
    labelPl,
    valueType,
    enumValues,
    isSearchable,
    isFilterable,
    isVariantAxis,
    displayAsSlider,
    isComparable,
    massEditable,
    quickSearchable,
    isPromoRule,
  });

  const reset = (): void => {
    setKey('');
    setLabelEn('');
    setLabelPl('');
    setEnumValues('');
    setIsSearchable(false);
    setIsFilterable(false);
    setIsVariantAxis(false);
    setDisplayAsSlider(false);
    setIsComparable(false);
    setMassEditable(false);
    setQuickSearchable(false);
    setIsPromoRule(false);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        setBusy(true);
        void onSubmit(collect())
          .then(() => {
            if (!isEdit) reset();
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="akey">{t('attributes.field.key')}</Label>
          <Input
            id="akey"
            value={key}
            onChange={(e): void => setKey(e.target.value)}
            pattern="[a-z][a-z0-9_]*"
            required
            maxLength={64}
            disabled={isEdit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="atype">{t('attributes.field.type')}</Label>
          <Select
            id="atype"
            value={valueType}
            onChange={(e): void => setValueType(e.target.value as ValueType)}
            disabled={isEdit}
          >
            {VALUE_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="alen">{t('attributes.field.labelEn')}</Label>
          <Input id="alen" value={labelEn} onChange={(e): void => setLabelEn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="alpl">{t('attributes.field.labelPl')}</Label>
          <Input id="alpl" value={labelPl} onChange={(e): void => setLabelPl(e.target.value)} />
        </div>
      </div>
      {isEdit ? (
        <p className="text-xs text-muted-foreground">{t('attributes.edit.lockedHint')}</p>
      ) : null}
      {isEdit && attribute?.customFieldDefinitionId ? (
        <p className="text-xs text-muted-foreground">
          {t('attributes.edit.customFieldDefinitionId')}{' '}
          <span className="font-mono">{attribute.customFieldDefinitionId}</span>
        </p>
      ) : null}
      {/* Options of an existing enum/multiselect are edited below via the
          dedicated editor; the comma input is for initial creation only. */}
      {!isEdit && (valueType === 'enum' || valueType === 'multiselect') ? (
        <div className="space-y-2">
          <Label htmlFor="aenum">{t('attributes.field.enumValues')}</Label>
          <Input
            id="aenum"
            value={enumValues}
            onChange={(e): void => setEnumValues(e.target.value)}
            placeholder={t('attributes.field.enumValuesPlaceholder')}
            required
          />
          <p className="text-xs text-muted-foreground">
            {valueType === 'multiselect'
              ? t('attributes.field.enumValues.help.multiselect')
              : t('attributes.field.enumValues.help.enum')}
          </p>
        </div>
      ) : null}
      {isNumeric ? (
        <div>
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={displayAsSlider}
              onChange={(e): void => setDisplayAsSlider(e.target.checked)}
            />
            {t('attributes.flag.displayAsSlider')}
          </label>
        </div>
      ) : null}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isSearchable} onChange={(e): void => setIsSearchable(e.target.checked)} />
          {t('attributes.flag.searchable')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isFilterable} onChange={(e): void => setIsFilterable(e.target.checked)} />
          {t('attributes.flag.filterable')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isVariantAxis} onChange={(e): void => setIsVariantAxis(e.target.checked)} />
          {t('attributes.flag.variantAxis')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isComparable} onChange={(e): void => setIsComparable(e.target.checked)} />
          {t('attributes.flag.comparable')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={massEditable} onChange={(e): void => setMassEditable(e.target.checked)} />
          {t('attributes.flag.massEditable')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={quickSearchable}
            onChange={(e): void => setQuickSearchable(e.target.checked)}
          />
          {t('attributes.column.quickSearchable')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isPromoRule} onChange={(e): void => setIsPromoRule(e.target.checked)} />
          {t('attributes.flag.promoRule')}
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {isEdit ? t('attributes.action.saveEdit') : t('attributes.action.create')}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            {t('attributes.action.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

interface AttributeOption {
  id: string;
  value: string;
  label: Record<string, string>;
  labelDefault: string;
  isDefault: boolean;
  sortOrder: number;
}

interface OptionsEditorProps {
  attribute: AdminAttribute;
  onError: (message: string) => void;
  onChanged: () => void;
}

/**
 * Add / rename / remove the selectable options of an enum or multiselect
 * attribute. Each mutation hits the per-option endpoints and reloads the local
 * list; `onChanged` lets the parent refresh the attribute's `enumValues` cell.
 */
function AttributeOptionsEditor({ attribute, onError, onChanged }: OptionsEditorProps): ReactNode {
  const t = useTranslation('catalog');
  const [options, setOptions] = useState<AttributeOption[]>([]);
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/admin/catalog/attributes/${attribute.id}/options`;

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: { items: AttributeOption[] } }>(base);
      setOptions(res.data.items);
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.load'));
    }
  }, [base, onError, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (): Promise<void> => {
    if (!newValue.trim()) return;
    setBusy(true);
    try {
      await apiClient.post(base, {
        value: newValue.trim(),
        labelDefault: newLabel.trim() || newValue.trim(),
      });
      setNewValue('');
      setNewLabel('');
      await load();
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.update'));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (opt: AttributeOption, labelDefault: string): Promise<void> => {
    try {
      await apiClient.patch(`${base}/${opt.id}`, { labelDefault });
      await load();
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.update'));
    }
  };

  const remove = async (opt: AttributeOption): Promise<void> => {
    setBusy(true);
    try {
      await apiClient.delete(`${base}/${opt.id}`);
      await load();
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.envelope.error.message : t('attributes.error.update'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <h3 className="text-sm font-semibold">{t('attributes.options.title')}</h3>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('attributes.options.empty')}</p>
      ) : (
        <div className="space-y-2">
          {options.map((opt) => (
            <div key={opt.id} className="flex items-center gap-2">
              <code className="w-40 shrink-0 font-mono text-xs">{opt.value}</code>
              <Input
                defaultValue={opt.labelDefault}
                aria-label={`option-label-${opt.value}`}
                onBlur={(e): void => {
                  const next = e.target.value.trim();
                  if (next && next !== opt.labelDefault) void rename(opt, next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={(): void => void remove(opt)}
              >
                {t('attributes.options.remove')}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="opt-value">{t('attributes.options.value')}</Label>
          <Input
            id="opt-value"
            value={newValue}
            onChange={(e): void => setNewValue(e.target.value)}
            pattern="[a-z0-9_-]+"
            placeholder={t('attributes.options.valuePlaceholder')}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="opt-label">{t('attributes.options.labelDefault')}</Label>
          <Input
            id="opt-label"
            value={newLabel}
            onChange={(e): void => setNewLabel(e.target.value)}
          />
        </div>
        <Button type="button" disabled={busy || !newValue.trim()} onClick={(): void => void add()}>
          {t('attributes.options.add')}
        </Button>
      </div>
    </div>
  );
}
