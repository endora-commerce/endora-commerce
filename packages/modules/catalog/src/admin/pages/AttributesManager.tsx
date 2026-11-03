import { useCallback, useContext, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { getAttributeScope, isSystemAttributeKey } from '@endora-commerce/contracts';
import { ApiError, apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, PageHeader, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  isScopeNarrowing,
  previewAttributeScopeChange,
  scopeFlagsOf,
  type AttributeScopeFlags,
  type AttributeScopePreview,
} from '../lib/attribute-scope.js';
import { pickLocalized } from '../lib/scope-overview.js';

// Feature 002 (T035) — DB-level value types. Foundation 001 had
// the original 5 (string, number, boolean, enum, date); 002 adds
// `multiselect` and `price`; 061 keeps the legacy `select` (dropdown
// single-select, vs `enum` = pill). The presentation hint
// `displayAsSlider` is honored only when valueType ∈ (number, price).
const VALUE_TYPES = ['string', 'number', 'boolean', 'enum', 'select', 'multiselect', 'price'] as const;
type ValueType = (typeof VALUE_TYPES)[number];

/** Select-style types carry a list of options (backend `SELECT_STYLE_VALUE_TYPES`). */
const isOptionType = (valueType: ValueType): boolean =>
  valueType === 'enum' || valueType === 'select' || valueType === 'multiselect';

interface AdminAttribute {
  id: string;
  key: string;
  label: Record<string, string>;
  /** Feature 012 — fallback label used when active locale is missing from `label`. */
  labelDefault: string;
  valueType: ValueType;
  /** Legacy projection of the option values (feature 012 read shape; backed by `custom_field_options` since feature 061). */
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
  /** Whether the attribute may be used as a price-building rule in a Price List. */
  isPriceRule: boolean;
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
  /**
   * Feature 023 / 163 (FR-090) — may the value differ per sales channel / per language.
   * Optional: the form shows them only when the answer carries both.
   */
  channelScoped?: boolean;
  languageScoped?: boolean;
}

/** A narrowing waiting for the operator's confirmation (FR-090). */
interface PendingNarrowing {
  attribute: AdminAttribute;
  input: AttributeFormValues;
  preview: AttributeScopePreview;
  channelNames: Record<string, string>;
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
  'isPriceRule',
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
    isPriceRule: a.isPriceRule,
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
  const [pendingNarrowing, setPendingNarrowing] = useState<PendingNarrowing | null>(null);
  const [narrowing, setNarrowing] = useState(false);
  const language = useContext(AppLanguageContext)?.language ?? 'en';
  const narrowingBodyId = useId();

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
      isPriceRule: input.isPriceRule,
      ...(input.valueType === 'number' || input.valueType === 'price'
        ? { displayAsSlider: input.displayAsSlider }
        : {}),
      ...(input.scope ? { channelScoped: input.scope.channelScoped, languageScoped: input.scope.languageScoped } : {}),
    };
  };

  const handleCreate = useCallback(
    async (input: AttributeFormValues): Promise<void> => {
      // enumValues required for `enum` / `select` (single-select) and `multiselect`.
      const enumValues =
        isOptionType(input.valueType)
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

  const saveEdit = useCallback(
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

  // Feature 163 (FR-090) — narrowing a scope flag leaves values set at that level
  // unused, so the count is shown and confirmed before anything is sent.
  const handleEditSave = useCallback(
    async (attr: AdminAttribute, input: AttributeFormValues): Promise<void> => {
      const current = scopeFlagsOf(attr);
      if (!current || !input.scope || !isScopeNarrowing(current, input.scope)) {
        await saveEdit(attr, input);
        return;
      }
      setError(null);
      try {
        const [preview, channels] = await Promise.all([
          previewAttributeScopeChange(attr.key, input.scope),
          apiClient
            .get<{ items?: Array<{ id: string; code: string; name: Record<string, string> | string }> }>(
              '/api/v1/admin/sales-channels',
            )
            .catch(() => ({ items: [] })),
        ]);
        const channelNames = Object.fromEntries(
          (channels.items ?? []).map((c) => [
            c.id,
            typeof c.name === 'string' ? c.name : pickLocalized(c.name, language) || c.code,
          ]),
        );
        setPendingNarrowing({ attribute: attr, input, preview, channelNames });
      } catch {
        setError(t('attributes.scope.previewFailed'));
      }
    },
    [saveEdit, language, t],
  );

  const confirmNarrowing = useCallback(async (): Promise<void> => {
    if (!pendingNarrowing || narrowing) return;
    setNarrowing(true);
    try {
      await saveEdit(pendingNarrowing.attribute, pendingNarrowing.input);
    } finally {
      setNarrowing(false);
      setPendingNarrowing(null);
    }
  }, [pendingNarrowing, narrowing, saveEdit]);

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

      {pendingNarrowing ? (
        <ModalDialog
          title={t('attributes.scope.confirmTitle', {
            attribute:
              pickLocalized(pendingNarrowing.attribute.label, language) || pendingNarrowing.attribute.key,
          })}
          onClose={(): void => setPendingNarrowing(null)}
          busy={narrowing}
          aria-describedby={narrowingBodyId}
          footer={
            <>
              <Button type="button" variant="outline" disabled={narrowing} onClick={(): void => setPendingNarrowing(null)}>
                {t('attributes.action.cancel')}
              </Button>
              <Button
                type="button"
                disabled={narrowing}
                aria-busy={narrowing || undefined}
                onClick={(): void => {
                  void confirmNarrowing();
                }}
              >
                {t('attributes.scope.confirm')}
              </Button>
            </>
          }
        >
          <p id={narrowingBodyId} className="text-sm">
            {pendingNarrowing.preview.orphanedOverrides === 0
              ? t('attributes.scope.confirmNone')
              : t(
                  // D21 — the plural form the admin language needs (PL: one / few / many).
                  `attributes.scope.confirmBody.${new Intl.PluralRules(language).select(pendingNarrowing.preview.orphanedOverrides)}`,
                  { count: String(pendingNarrowing.preview.orphanedOverrides) },
                )}
          </p>
          {pendingNarrowing.preview.byChannel.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm">
              {pendingNarrowing.preview.byChannel.map((entry) => (
                <li key={entry.channelId}>
                  {t('attributes.scope.perChannel', {
                    channel: pendingNarrowing.channelNames[entry.channelId] ?? entry.channelId.slice(0, 8),
                    count: String(entry.count),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
        </ModalDialog>
      ) : null}

      {editingAttr ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('attributes.edit.title', { key: editingAttr.key })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Keyed so opening an attribute starts from its stored values, not the
                previous form's state (same element type at the same position). */}
            <AttributeForm
              key={editingAttr.id}
              mode="edit"
              attribute={editingAttr}
              onSubmit={(input): Promise<void> => handleEditSave(editingAttr, input)}
              onCancel={(): void => setEditingId(null)}
            />
            {isOptionType(editingAttr.valueType) ? (
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
            <AttributeForm key="create" mode="create" onSubmit={handleCreate} />
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
                  <TableHead>{t('attributes.column.priceRule')}</TableHead>
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
  isPriceRule: boolean;
  /** Feature 163 (FR-090) — `null` when the form does not show the flags. */
  scope: AttributeScopeFlags | null;
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
 * select / multiselect options are managed by the separate {@link AttributeOptionsEditor}.
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
  const [isPriceRule, setIsPriceRule] = useState(attribute?.isPriceRule ?? false);
  const [busy, setBusy] = useState(false);
  const isNumeric = valueType === 'number' || valueType === 'price';
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  // Feature 163 (FR-090) — shown on create, and on edit when the answer carries both
  // flags; a system attribute's are fixed (`getAttributeScope`) and read-only.
  const storedScope = attribute ? scopeFlagsOf(attribute) : { channelScoped: false, languageScoped: false };
  const systemAttribute = attribute ? isSystemAttributeKey(attribute.key) : false;
  const initialScope = systemAttribute && attribute ? getAttributeScope(attribute.key) : storedScope;
  const [channelScoped, setChannelScoped] = useState(initialScope?.channelScoped ?? false);
  const [languageScoped, setLanguageScoped] = useState(initialScope?.languageScoped ?? false);
  const showScope = initialScope !== null;
  const scopeEditable = showScope && !systemAttribute && canWrite;
  const scopeHelpId = useId();

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
    isPriceRule,
    scope: scopeEditable ? { channelScoped, languageScoped } : null,
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
    setIsPriceRule(false);
    setChannelScoped(false);
    setLanguageScoped(false);
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
      {/* Options of an existing select-style attribute are edited below via the
          dedicated editor; the comma input is for initial creation only. */}
      {!isEdit && isOptionType(valueType) ? (
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
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isPriceRule} onChange={(e): void => setIsPriceRule(e.target.checked)} />
          {t('attributes.flag.priceRule')}
        </label>
      </div>
      {showScope ? (
        <fieldset className="space-y-2" aria-describedby={scopeHelpId}>
          <legend className="text-sm font-medium">{t('attributes.scope.legend')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={channelScoped}
              disabled={!scopeEditable}
              onChange={(e): void => setChannelScoped(e.target.checked)}
            />
            {t('attributes.scope.channelScoped')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={languageScoped}
              disabled={!scopeEditable}
              onChange={(e): void => setLanguageScoped(e.target.checked)}
            />
            {t('attributes.scope.languageScoped')}
          </label>
          <p id={scopeHelpId} className="text-xs text-muted-foreground">
            {systemAttribute
              ? t('attributes.scope.systemHelp')
              : !canWrite
                ? t('attributes.scope.readOnly')
                : t('attributes.scope.help')}
          </p>
        </fieldset>
      ) : null}
      <div className="flex gap-2">
        {/* Disabled and announced as busy while the save — or a narrowing's preview — runs (D18). */}
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
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
 * Add / rename / remove the selectable options of an enum, select or multiselect
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

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default AttributesManager;
