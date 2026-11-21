import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import {
  getAttributeScope,
  isSystemAttributeKey,
  type AdminAttributeUsage,
  type CustomFieldAdminAccess as AdminAccess,
} from '@endora-commerce/contracts';
import { ApiError, apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Checkbox, EmptyState, InlineStatus, Input, Label, Select, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import {
  ImmediateBadge,
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  ModalDialog,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useRemovalFocus,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { isScopeNarrowing, previewAttributeScopeChange, scopableOf, type AttributeScopePreview } from '../lib/attribute-scope.js';
import {
  ATTRIBUTE_CAPABILITIES,
  CAPABILITY_LABEL_KEYS,
  VALUE_TYPES,
  attributeMatches,
  enabledCapabilities,
  valueTypeLabelKey,
  type AttributeCapability,
  type ValueType,
} from '../lib/attribute-list.js';
import { pickLocalized } from '../lib/scope-overview.js';

// Feature 002 (T035) — DB-level value types (`VALUE_TYPES`, `../lib/attribute-list`).
// Foundation 001 had the original 5 (string, number, boolean, enum, date); 002
// adds `multiselect` and `price`; 061 keeps the legacy `select` (dropdown
// single-select, vs `enum` = pill). The presentation hint `displayAsSlider` is
// honored only when valueType ∈ (number, price). Feature 172 adds
// `page_builder` — a Page Builder document per language, authored on the
// product content screen and never an ordinary value.

/**
 * Feature 172 (research R-6) — a content attribute holds every capability off
 * and is always language-scoped; the server refuses anything else, so the form
 * offers none of it.
 */
const isContentType = (valueType: ValueType): boolean => valueType === 'page_builder';

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
   * Feature 174 (FR-012, R15) — may the value differ per sales channel (and, for text, per
   * channel and language). Optional: the form shows it only when the answer carries it.
   */
  scopable?: boolean;
  /**
   * Feature 175 (FR-036) — how the admin panel offers the backing custom-field
   * definition. Optional: an answer from an older server carries none (`edit`).
   */
  adminAccess?: AdminAccess;
}

const ADMIN_ACCESS_LEVELS: readonly AdminAccess[] = ['edit', 'read', 'hidden'];

/** A narrowing waiting for the operator's confirmation (FR-090). */
interface PendingNarrowing {
  attribute: AdminAttribute;
  input: AttributeFormValues;
  preview: AttributeScopePreview;
  channelNames: Record<string, string>;
}

/** What the editor dialog holds: a blank attribute, or the id of the one being edited. */
type Editing = { mode: 'create' } | { mode: 'edit'; id: string };

const rowId = (attribute: AdminAttribute): string => attribute.id;

const messageOf = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? err.envelope.error.message : fallback;

/**
 * The attribute list (issue #1527, UX audit CAT-12): the kit's `ListPage` with
 * the list first, a search and a type filter, and *New attribute* in the
 * header. Create and edit open one editor dialog, whose Save is the only save
 * on the screen — the capabilities used to be a grid of eight checkbox columns
 * staged behind a second Save bar; they are edited in the dialog now and read
 * in the list as badges.
 */
export function AttributesManager(): ReactNode {
  const t = useTranslation('catalog');
  const language = useContext(AppLanguageContext)?.language ?? 'en';
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const [attrs, setAttrs] = useState<AdminAttribute[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<ValueType | ''>('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Issue #1499 (DEC-12 a) — a result is said beside *New attribute*, where the
  // editor and the delete dialogs hand focus back, in a region mounted before it
  // has text, not as a success banner above the page.
  const status = useInlineStatus();
  const { show: showStatus, clear: clearStatus } = status;
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [pendingNarrowing, setPendingNarrowing] = useState<PendingNarrowing | null>(null);
  const [narrowing, setNarrowing] = useState(false);
  const narrowingBodyId = useId();
  // Feature 172 (OR-5) — the attribute whose Delete confirmation is open.
  const [deleting, setDeleting] = useState<AdminAttribute | null>(null);
  // Where focus goes once a deleted row — and with it the menu that opened the
  // dialog — is gone (WCAG 2.4.3).
  const deleteFocusRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    // A reload after a write keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      const res = await apiClient.get<{ data: AdminAttribute[] }>('/api/v1/admin/catalog/attributes');
      setAttrs(res.data);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: messageOf(err, t('attributes.error.load')) });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The endpoint answers every attribute, so the search and the type filter run
  // here, on what is already loaded.
  const visible = useMemo(
    () => attrs.filter((a) => attributeMatches(a, { query: q, valueType: typeFilter })),
    [attrs, q, typeFilter],
  );
  const filtered = q.trim() !== '' || typeFilter !== '';
  const clearFilters = useCallback((): void => {
    setQ('');
    setTypeFilter('');
  }, []);
  const removalFocus = useRemovalFocus(visible, rowId, load.kind === 'ready');

  const editingAttr = useMemo(
    () => (editing?.mode === 'edit' ? (attrs.find((a) => a.id === editing.id) ?? null) : null),
    [attrs, editing],
  );

  const nameOf = useCallback(
    (a: AdminAttribute): string => pickLocalized(a.label, language) || a.labelDefault || a.key,
    [language],
  );

  const openEditor = useCallback(
    (next: Editing): void => {
      clearStatus();
      setDialogError(null);
      setEditing(next);
    },
    [clearStatus],
  );

  const closeEditor = useCallback((): void => {
    setEditing(null);
    setDialogError(null);
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
      ...(input.scopable !== null ? { scopable: input.scopable } : {}),
      adminAccess: input.adminAccess,
    };
  };

  /** A refused create keeps the dialog open with the server's message and the typed values. */
  const handleCreate = async (input: AttributeFormValues): Promise<void> => {
    // enumValues required for `enum` / `select` (single-select) and `multiselect`.
    const enumValues = isOptionType(input.valueType)
      ? input.enumValues
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    setDialogError(null);
    try {
      await apiClient.post<{ data: AdminAttribute }>('/api/v1/admin/catalog/attributes', {
        key: input.key,
        valueType: input.valueType,
        ...buildAttributePayload(input),
        ...(enumValues !== undefined ? { enumValues } : {}),
      });
      closeEditor();
      showStatus(t('attributes.success.create', { key: input.key }));
      await refresh();
    } catch (err) {
      setDialogError(messageOf(err, t('attributes.error.create')));
    }
  };

  const saveEdit = async (attr: AdminAttribute, input: AttributeFormValues): Promise<void> => {
    setDialogError(null);
    try {
      await apiClient.patch<{ data: AdminAttribute }>(
        `/api/v1/admin/catalog/attributes/${attr.key}`,
        buildAttributePayload(input),
      );
      closeEditor();
      showStatus(t('attributes.success.update', { key: attr.key }));
      await refresh();
    } catch (err) {
      setDialogError(messageOf(err, t('attributes.error.update')));
    }
  };

  // Feature 163 (FR-090) — narrowing a scope flag leaves values set at that level
  // unused, so the count is shown and confirmed before anything is sent.
  const handleEditSave = async (attr: AdminAttribute, input: AttributeFormValues): Promise<void> => {
    const stored = scopableOf(attr);
    const current = stored === null ? null : { scopable: stored, valueType: attr.valueType };
    const next = input.scopable === null ? null : { scopable: input.scopable, valueType: input.valueType };
    if (!current || !next || !isScopeNarrowing(current, next)) {
      await saveEdit(attr, input);
      return;
    }
    setDialogError(null);
    try {
      const [preview, channels] = await Promise.all([
        previewAttributeScopeChange(attr.key, next),
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
      setDialogError(t('attributes.scope.previewFailed'));
    }
  };

  const confirmNarrowing = async (): Promise<void> => {
    if (!pendingNarrowing || narrowing) return;
    setNarrowing(true);
    try {
      // A refusal is said in the editor, which stays open under this dialog.
      await saveEdit(pendingNarrowing.attribute, pendingNarrowing.input);
    } finally {
      setNarrowing(false);
      setPendingNarrowing(null);
    }
  };

  const newAttributeButton = (
    <Button
      ref={(element): void => {
        removalFocus.createRef.current = element;
      }}
      type="button"
      onClick={(): void => openEditor({ mode: 'create' })}
    >
      <Plus aria-hidden="true" />
      {t('attributes.action.new')}
    </Button>
  );
  // While the list is empty the empty state's *New attribute* is the one primary (Von Restorff).
  const nothingYet = load.kind === 'ready' && attrs.length === 0;

  const columns: ResponsiveColumn<AdminAttribute>[] = [
    {
      id: 'label',
      header: t('attributes.column.label'),
      primary: true,
      // The name opens the editor: no *Edit* button repeating it in every row.
      render: (a) => (
        <button
          ref={removalFocus.targetRef(a)}
          type="button"
          className="text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          onClick={(): void => openEditor({ mode: 'edit', id: a.id })}
        >
          {nameOf(a)}
        </button>
      ),
      meta: (a) => <code className="font-mono text-xs">{a.key}</code>,
    },
    {
      id: 'key',
      header: t('attributes.column.key'),
      hideOnMobile: true,
      render: (a) => <code className="font-mono text-xs">{a.key}</code>,
    },
    {
      id: 'type',
      header: t('attributes.column.type'),
      render: (a) => t(valueTypeLabelKey(a.valueType)),
    },
    {
      id: 'options',
      header: t('attributes.options.title'),
      hideOnMobile: true,
      render: (a) =>
        a.enumValues && a.enumValues.length > 0 ? (
          <span className="block max-w-xs truncate text-muted-foreground" title={a.enumValues.join(', ')}>
            {a.enumValues.join(', ')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'capabilities',
      header: t('attributes.column.capabilities'),
      hideOnMobile: true,
      render: (a) => <CapabilityBadges attribute={a} />,
    },
  ];

  return (
    <>
      <ListPage
        title={t('attributes.page.title')}
        description={t('attributes.page.description')}
        actions={
          <div className="flex items-center gap-3">
            <InlineStatus {...status.props} />
            {canWrite && !nothingYet ? newAttributeButton : null}
          </div>
        }
        toolbar={
          <ListToolbar
            className="min-w-0 flex-1"
            label={t('attributes.toolbar.label')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('attributes.search.label')}
                placeholder={t('attributes.search.placeholder')}
                value={q}
                onValueChange={setQ}
              />
            }
            filters={
              <Select
                aria-label={t('attributes.filter.type')}
                value={typeFilter}
                onChange={(e): void => setTypeFilter(e.target.value as ValueType | '')}
                className="w-auto"
              >
                <option value="">{t('attributes.filter.allTypes')}</option>
                {VALUE_TYPES.map((v) => (
                  <option key={v} value={v}>
                    {t(valueTypeLabelKey(v))}
                  </option>
                ))}
              </Select>
            }
            filtersActive={filtered}
            onClearFilters={clearFilters}
          />
        }
        count={t('attributes.count', { count: String(visible.length) })}
        load={load}
        onRetry={(): void => void refresh()}
      >
        <ResponsiveTable
          columns={columns}
          data={visible}
          keyExtractor={rowId}
          emptyState={
            filtered ? (
              <EmptyState
                variant="no-results"
                title={t('attributes.emptyFiltered')}
                onClearFilters={clearFilters}
                focusAfterClear={searchRef}
              />
            ) : (
              <EmptyState
                icon={<SlidersHorizontal size={20} />}
                title={t('attributes.empty')}
                description={canWrite ? t('attributes.empty.body') : t('attributes.empty.bodyReadOnly')}
                action={canWrite ? newAttributeButton : null}
              />
            )
          }
          renderActions={(a): ReactNode => (
            <RowActionMenu label={t('attributes.rowActions', { attribute: nameOf(a) })}>
              <RowActionMenuItem onSelect={(): void => openEditor({ mode: 'edit', id: a.id })}>
                {canWrite ? t('attributes.action.edit') : t('attributes.action.view')}
              </RowActionMenuItem>
              {canWrite ? (
                <>
                  <RowActionMenuSeparator />
                  <RowActionMenuItem
                    destructive
                    onSelect={(): void => {
                      clearStatus();
                      setDeleting(a);
                    }}
                  >
                    {t('attributes.delete.action')}
                  </RowActionMenuItem>
                </>
              ) : null}
            </RowActionMenu>
          )}
        />
      </ListPage>

      {editing !== null && (editing.mode === 'create' || editingAttr) ? (
        <AttributeEditorDialog
          key={editing.mode === 'create' ? 'create' : editing.id}
          {...(editingAttr ? { attribute: editingAttr } : {})}
          canWrite={canWrite}
          error={dialogError}
          onError={setDialogError}
          onClose={closeEditor}
          onSubmit={(input): Promise<void> =>
            editingAttr ? handleEditSave(editingAttr, input) : handleCreate(input)
          }
          onOptionsChanged={(): void => void refresh()}
        />
      ) : null}

      {pendingNarrowing ? (
        <ModalDialog
          title={t('attributes.scope.confirmTitle', { attribute: nameOf(pendingNarrowing.attribute) })}
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

      {deleting ? (
        <DeleteAttributeDialog
          attribute={deleting}
          finalFocusRef={deleteFocusRef}
          onClose={(): void => setDeleting(null)}
          onDeleted={(): void => {
            const gone = deleting;
            // Resolved while the row is still on screen; the next row's name, else
            // the previous one's, else the empty state's *New attribute*.
            deleteFocusRef.current = removalFocus.returnFocusTo(gone)();
            setAttrs((current) => current.filter((a) => a.id !== gone.id));
            setDeleting(null);
            if (editing?.mode === 'edit' && editing.id === gone.id) closeEditor();
            showStatus(t('attributes.success.delete', { key: gone.key }));
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The capabilities switched on, as one badge each — read at a glance down the
 * column instead of across eight checkbox columns. A content attribute has none
 * by construction, and says so.
 */
function CapabilityBadges({ attribute }: { attribute: AdminAttribute }): ReactNode {
  const t = useTranslation('catalog');
  if (isContentType(attribute.valueType)) {
    return <span className="text-xs text-muted-foreground">{t('attributes.pageBuilder.flagsLocked')}</span>;
  }
  const on = enabledCapabilities(attribute);
  if (on.length === 0) {
    return <span className="text-xs text-muted-foreground">{t('attributes.capabilities.none')}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1" aria-label={t('attributes.column.capabilities')}>
      {on.map((capability) => (
        <li key={capability}>
          <Badge variant="outline" className="font-normal">
            {t(CAPABILITY_LABEL_KEYS[capability])}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/**
 * The one editor (issue #1527): create and edit share it, its Save in the
 * footer is the screen's only save, and the options of a select-style
 * attribute are edited inside it — under the *Applies immediately* badge,
 * because each option change is its own request. Without `catalog:write` it
 * shows the attribute and offers no Save.
 */
function AttributeEditorDialog({
  attribute,
  canWrite,
  error,
  onError,
  onClose,
  onSubmit,
  onOptionsChanged,
}: {
  attribute?: AdminAttribute;
  canWrite: boolean;
  error: string | null;
  onError: (message: string) => void;
  onClose: () => void;
  onSubmit: (input: AttributeFormValues) => Promise<void>;
  onOptionsChanged: () => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const isEdit = attribute !== undefined;
  const title = !isEdit
    ? t('attributes.create.title')
    : canWrite
      ? t('attributes.edit.title', { key: attribute.key })
      : t('attributes.view.title', { key: attribute.key });

  const submit = async (input: AttributeFormValues): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await onSubmit(input);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={title}
      onClose={onClose}
      busy={busy}
      // A stray click must not throw away what was typed.
      dismissOnScrim={false}
      widthClassName="max-w-3xl"
      footer={
        canWrite ? (
          <>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t('attributes.action.cancel')}
            </Button>
            {/* Disabled and announced as busy while the save — or a narrowing's preview — runs (D18). */}
            <Button type="submit" form={formId} disabled={busy} aria-busy={busy || undefined}>
              {isEdit ? t('attributes.action.saveEdit') : t('attributes.action.create')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={onClose}>
            {t('attributes.action.close')}
          </Button>
        )
      }
    >
      <div className="space-y-6">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AttributeForm
          id={formId}
          mode={isEdit ? 'edit' : 'create'}
          {...(attribute ? { attribute } : {})}
          readOnly={!canWrite}
          onSubmit={submit}
        />
        {attribute && isOptionType(attribute.valueType) ? (
          <AttributeOptionsEditor
            attribute={attribute}
            readOnly={!canWrite}
            onError={onError}
            onChanged={onOptionsChanged}
          />
        ) : null}
      </div>
    </ModalDialog>
  );
}

/**
 * Feature 172 (FR-007 – FR-009, owner ruling OR-5, research R-21) — the Delete
 * confirmation, for every attribute type. It reads what the delete would meet
 * from `GET …/attributes/:idOrKey/usage`, the query the delete guard runs: a set
 * membership or a product value disables confirm and says why, Page Builder
 * content is counted because it goes with the attribute, and other modules'
 * rules — which this module cannot count — are named in one fixed sentence.
 */
function DeleteAttributeDialog({
  attribute,
  finalFocusRef,
  onClose,
  onDeleted,
}: {
  attribute: AdminAttribute;
  finalFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onDeleted: () => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const language = useContext(AppLanguageContext)?.language ?? 'en';
  const bodyId = useId();
  const [usage, setUsage] = useState<AdminAttributeUsage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/v1/admin/catalog/attributes/${attribute.key}`;

  useEffect(() => {
    let live = true;
    apiClient
      .get<{ data: AdminAttributeUsage }>(`${path}/usage`)
      .then((res) => {
        if (live) setUsage(res.data);
      })
      .catch((err: unknown) => {
        if (live) setError(messageOf(err, t('attributes.delete.error')));
      });
    return (): void => {
      live = false;
    };
  }, [path, t]);

  const blocked = !usage || usage.attributeSetCount > 0 || usage.productValueCount > 0;

  const confirm = async (): Promise<void> => {
    if (blocked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.delete(path);
      onDeleted();
    } catch (err) {
      // A set membership or a value added since the dialog opened: the API's
      // own message says which.
      setError(messageOf(err, t('attributes.delete.error')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('attributes.delete.title', { attribute: pickLocalized(attribute.label, language) || attribute.key })}
      onClose={onClose}
      busy={busy}
      finalFocusRef={finalFocusRef}
      aria-describedby={bodyId}
      footer={
        <>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('attributes.action.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={blocked || busy}
            aria-busy={busy || undefined}
            onClick={(): void => {
              void confirm();
            }}
          >
            {t('attributes.delete.confirm')}
          </Button>
        </>
      }
    >
      <div id={bodyId} className="space-y-2 text-sm">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {usage === null && !error ? <p className="text-muted-foreground">{t('attributes.loading')}</p> : null}
        {usage && usage.attributeSetCount > 0 ? (
          <p>{t('attributes.delete.inSets', { count: String(usage.attributeSetCount) })}</p>
        ) : null}
        {usage && usage.productValueCount > 0 ? (
          <p>{t('attributes.delete.hasValues', { count: String(usage.productValueCount) })}</p>
        ) : null}
        {usage && usage.productContentCount > 0 ? (
          <p>{t('attributes.delete.contentCount', { count: String(usage.productContentCount) })}</p>
        ) : null}
        <p className="text-muted-foreground">{t('attributes.delete.foreignRules')}</p>
      </div>
    </ModalDialog>
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
  /** Feature 174 (R15) — `null` when the form does not show the flag. */
  scopable: boolean | null;
  /** Feature 175 (FR-036) — the backing definition's admin access. */
  adminAccess: AdminAccess;
}

interface AttributeFormProps {
  /** The dialog footer's Save submits the form through this id. */
  id: string;
  mode: 'create' | 'edit';
  attribute?: AdminAttribute;
  readOnly: boolean;
  onSubmit: (input: AttributeFormValues) => Promise<void>;
}

/** The long, explanatory label of each capability in the editor. */
const CAPABILITY_FORM_LABEL_KEYS: Record<AttributeCapability, string> = {
  isSearchable: 'attributes.flag.searchable',
  isFilterable: 'attributes.flag.filterable',
  isVariantAxis: 'attributes.flag.variantAxis',
  isComparable: 'attributes.flag.comparable',
  massEditable: 'attributes.flag.massEditable',
  quickSearchable: 'attributes.column.quickSearchable',
  isPromoRule: 'attributes.flag.promoRule',
  isPriceRule: 'attributes.flag.priceRule',
};

type CapabilitySet = Record<AttributeCapability, boolean>;

function capabilitiesOf(attribute: AdminAttribute | undefined): CapabilitySet {
  return Object.fromEntries(
    ATTRIBUTE_CAPABILITIES.map((capability) => [capability, attribute?.[capability] ?? false]),
  ) as CapabilitySet;
}

/**
 * Shared create/edit form. In `edit` mode the `key` and `valueType` are locked
 * (immutable server-side) while the label and capabilities stay editable; enum /
 * select / multiselect options are managed by the separate {@link AttributeOptionsEditor}.
 */
function AttributeForm({ id, mode, attribute, readOnly, onSubmit }: AttributeFormProps): ReactNode {
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
  const [capabilities, setCapabilities] = useState<CapabilitySet>(() => capabilitiesOf(attribute));
  const [displayAsSlider, setDisplayAsSlider] = useState(attribute?.displayAsSlider ?? false);
  const [adminAccess, setAdminAccess] = useState<AdminAccess>(attribute?.adminAccess ?? 'edit');
  // A required attribute stays editable in the admin (SD-2); the form has no
  // required control of its own, so the stored flag decides.
  const accessLocked = attribute?.isRequired ?? false;
  const adminAccessId = useId();
  const isNumeric = valueType === 'number' || valueType === 'price';
  const canWrite = !readOnly;
  // Feature 174 (FR-012, R15) — one flag, shown on create and on edit when the answer
  // carries it; a system attribute's is fixed (`getAttributeScope`) and read-only.
  const systemAttribute = attribute ? isSystemAttributeKey(attribute.key) : false;
  const initialScopable: boolean | null = attribute
    ? systemAttribute
      ? getAttributeScope(attribute.key).scopable
      : scopableOf(attribute)
    : false;
  const [scopable, setScopable] = useState(initialScopable ?? false);
  const showScope = initialScopable !== null;
  const scopeEditable = showScope && !systemAttribute && canWrite;
  const scopeHelpId = useId();

  const isContent = isContentType(valueType);
  // A capability ticked before Page Builder content was chosen is hidden, so it
  // is not sent either; nor is `scopable` — a content attribute is never
  // scopable (feature 174), its languages being its document's.
  const capabilityValue = (capability: AttributeCapability): boolean => (isContent ? false : capabilities[capability]);
  const collect = (): AttributeFormValues => ({
    key,
    labelEn,
    labelPl,
    valueType,
    enumValues,
    isSearchable: capabilityValue('isSearchable'),
    isFilterable: capabilityValue('isFilterable'),
    isVariantAxis: capabilityValue('isVariantAxis'),
    displayAsSlider: isContent ? false : displayAsSlider,
    isComparable: capabilityValue('isComparable'),
    massEditable: capabilityValue('massEditable'),
    quickSearchable: capabilityValue('quickSearchable'),
    isPromoRule: capabilityValue('isPromoRule'),
    isPriceRule: capabilityValue('isPriceRule'),
    scopable: scopeEditable && !isContent ? scopable : null,
    adminAccess,
  });

  return (
    <form
      id={id}
      className="space-y-5"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        if (readOnly) return;
        void onSubmit(collect());
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="akey">{t('attributes.field.key')}</Label>
          <Input
            id="akey"
            value={key}
            onChange={(e): void => setKey(e.target.value.trim())}
            pattern="[a-z][a-z0-9_]*"
            required
            maxLength={64}
            disabled={isEdit || readOnly}
            className="font-mono"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="atype">{t('attributes.field.type')}</Label>
          <Select
            id="atype"
            value={valueType}
            onChange={(e): void => setValueType(e.target.value as ValueType)}
            disabled={isEdit || readOnly}
          >
            {VALUE_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(valueTypeLabelKey(v))}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="alen">{t('attributes.field.labelEn')}</Label>
          <Input id="alen" value={labelEn} disabled={readOnly} onChange={(e): void => setLabelEn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="alpl">{t('attributes.field.labelPl')}</Label>
          <Input id="alpl" value={labelPl} disabled={readOnly} onChange={(e): void => setLabelPl(e.target.value)} />
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
            aria-describedby="aenum-help"
            required
          />
          <p id="aenum-help" className="text-xs text-muted-foreground">
            {valueType === 'multiselect'
              ? t('attributes.field.enumValues.help.multiselect')
              : t('attributes.field.enumValues.help.enum')}
          </p>
        </div>
      ) : null}
      {isContent ? (
        <p className="text-sm text-muted-foreground">{t('attributes.pageBuilder.languageNote')}</p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {t('attributes.column.capabilities')}
          </legend>
          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            {ATTRIBUTE_CAPABILITIES.map((capability) => (
              <label key={capability} className="flex min-h-9 items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={capabilities[capability]}
                  disabled={readOnly}
                  onChange={(e): void => {
                    const checked = e.target.checked;
                    setCapabilities((prev) => ({ ...prev, [capability]: checked }));
                  }}
                />
                {t(CAPABILITY_FORM_LABEL_KEYS[capability])}
              </label>
            ))}
            {isNumeric ? (
              <label className="flex min-h-9 items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={displayAsSlider}
                  disabled={readOnly}
                  onChange={(e): void => setDisplayAsSlider(e.target.checked)}
                />
                {t('attributes.flag.displayAsSlider')}
              </label>
            ) : null}
          </div>
        </fieldset>
      )}
      {showScope && !isContent ? (
        <fieldset className="space-y-2" aria-describedby={scopeHelpId}>
          <legend className="text-sm font-medium">{t('attributes.scope.legend')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={scopable} disabled={!scopeEditable} onChange={(e): void => setScopable(e.target.checked)} />
            {t('attributes.scope.scopable')}
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
      <div className="space-y-2">
        <Label htmlFor={adminAccessId}>{t('attributes.adminAccess.label')}</Label>
        <Select
          id={adminAccessId}
          value={adminAccess}
          disabled={!canWrite}
          aria-describedby={`${adminAccessId}-help${accessLocked ? ` ${adminAccessId}-reason` : ''}`}
          onChange={(e): void => setAdminAccess(e.target.value as AdminAccess)}
        >
          {ADMIN_ACCESS_LEVELS.map((level) => (
            <option key={level} value={level} disabled={accessLocked && level !== 'edit' && level !== adminAccess}>
              {t(`attributes.adminAccess.${level}`)}
            </option>
          ))}
        </Select>
        <p id={`${adminAccessId}-help`} className="text-xs text-muted-foreground">
          {t('attributes.adminAccess.help')}
        </p>
        {accessLocked ? (
          <p id={`${adminAccessId}-reason`} className="text-xs text-muted-foreground">
            {t('attributes.adminAccess.requiredReason')}
          </p>
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
  readOnly: boolean;
  onError: (message: string) => void;
  onChanged: () => void;
}

/**
 * Add / rename / remove the selectable options of an enum, select or multiselect
 * attribute. Each mutation hits the per-option endpoints at once — hence the
 * *Applies immediately* badge, so the dialog's Save is not read as covering
 * them — and reloads the local list; `onChanged` lets the parent refresh the
 * attribute's options cell.
 */
function AttributeOptionsEditor({ attribute, readOnly, onError, onChanged }: OptionsEditorProps): ReactNode {
  const t = useTranslation('catalog');
  const [options, setOptions] = useState<AttributeOption[]>([]);
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const headingId = useId();
  const base = `/api/v1/admin/catalog/attributes/${attribute.id}/options`;

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: { items: AttributeOption[] } }>(base);
      setOptions(res.data.items);
    } catch (err) {
      onError(messageOf(err, t('attributes.error.load')));
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
      onError(messageOf(err, t('attributes.error.update')));
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
      onError(messageOf(err, t('attributes.error.update')));
    }
  };

  const remove = async (opt: AttributeOption): Promise<void> => {
    setBusy(true);
    try {
      await apiClient.delete(`${base}/${opt.id}`);
      await load();
      onChanged();
    } catch (err) {
      onError(messageOf(err, t('attributes.error.update')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 border-t pt-4" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold">
        {t('attributes.options.title')}
        {readOnly ? null : <ImmediateBadge />}
      </h3>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('attributes.options.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {options.map((opt) => (
            <li key={opt.id} className="flex items-center gap-2">
              <code className="w-40 shrink-0 truncate font-mono text-xs">{opt.value}</code>
              <Input
                defaultValue={opt.labelDefault}
                aria-label={t('attributes.options.labelFor', { value: opt.value })}
                disabled={readOnly}
                onBlur={(e): void => {
                  const next = e.target.value.trim();
                  if (next && next !== opt.labelDefault) void rename(opt, next);
                }}
              />
              {readOnly ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={t('attributes.options.removeFor', { value: opt.value })}
                  onClick={(): void => void remove(opt)}
                >
                  {t('attributes.options.remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="opt-value">{t('attributes.options.value')}</Label>
            <Input
              id="opt-value"
              value={newValue}
              onChange={(e): void => setNewValue(e.target.value)}
              pattern="[a-z0-9_-]+"
              placeholder={t('attributes.options.valuePlaceholder')}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="opt-label">{t('attributes.options.labelDefault')}</Label>
            <Input id="opt-label" value={newLabel} onChange={(e): void => setNewLabel(e.target.value)} />
          </div>
          {/* "Add …" inside a section is outline: the dialog's Save stays its one primary. */}
          <Button type="button" variant="outline" disabled={busy || !newValue.trim()} onClick={(): void => void add()}>
            <Plus aria-hidden="true" />
            {t('attributes.options.add')}
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default AttributesManager;
