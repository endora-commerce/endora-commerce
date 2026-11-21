import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Eye, EyeOff, FileText, ImageIcon, ImageOff, X } from 'lucide-react';
import {
  ApiError,
  SaveSessionProvider,
  apiClient,
  cn,
  toAbsoluteAssetUrl,
  useAuth,
  useDerivedKey,
  useSaveSession,
  type ParticipantIssues,
  type SaveOutcome,
  type SavePart,
} from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, EditorSection, InlineStatus, Input, Label, PageHeader, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { AssetPicker, CustomFieldValuesPanel, ImmediateBadge, RowActionMenu, RowActionMenuItem, RowActionMenuSeparator, SaveSessionSummary, adminLanguageToLocale, customFieldErrorsOf, buildCategoryTree, flattenCategoryTree, pickCategoryDisplayName, useConfirmDialog, useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
import type { CategoryTreePickerCategory } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';
import type { EditorSaveSessionHandle } from '@endora-commerce/contracts';

interface AdminCategory {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  slug: string;
  sortOrder: number;
  mainImageAssetId?: string | null;
  /** Feature 068 — false hides the category (and its branch) from the storefront. */
  isActive: boolean;
  /** Feature 055 — the category's custom-field bag (feature 175 edits it here). */
  customFieldValues?: Record<string, unknown>;
}

/**
 * Feature 175 (FR-016, FR-039) — the embedded custom-field panel's state in the
 * create and edit forms: its bag, sent with the form's own request, and the
 * refusals a `422 CUSTOM_FIELD_VALUE_INVALID` named. `null` when the operator
 * lacks `custom_fields:read`: no panel, and the request carries no values.
 */
interface CustomFieldsSlot {
  errors: Record<string, string>;
}

/** The panel's starting bag on a create: a new category has none. */
const EMPTY_VALUES: Record<string, unknown> = {};

/**
 * Feature 180, WP-6 — the open edit form's fields. Held by the tree, not the form, so the
 * category editor's one Save can count them and its guard can ask about them from a row the
 * form is not part of (another category's **Edit**). `customFieldValues` is `undefined` until
 * the operator edits a custom field, so a save that touched none sends no bag (feature 175).
 */
interface EditDraft {
  slug: string;
  nameEn: string;
  namePl: string;
  parentId: string;
  customFieldValues?: Record<string, unknown>;
}

function draftOf(category: AdminCategory): EditDraft {
  return {
    slug: category.slug,
    nameEn: category.name['en-US'] ?? '',
    namePl: category.name['pl-PL'] ?? '',
    parentId: category.parentCategoryId ?? '',
  };
}

/** The host part's unsaved changes: one per changed field, one per changed custom field. */
function hostChangeCount(draft: EditDraft, category: AdminCategory): number {
  const stored = draftOf(category);
  let count = 0;
  if (draft.slug !== stored.slug) count += 1;
  if (draft.nameEn !== stored.nameEn) count += 1;
  if (draft.namePl !== stored.namePl) count += 1;
  if (draft.parentId !== stored.parentId) count += 1;
  if (draft.customFieldValues !== undefined) {
    const before = category.customFieldValues ?? {};
    for (const [key, value] of Object.entries(draft.customFieldValues)) {
      if (JSON.stringify(value ?? null) !== JSON.stringify(before[key] ?? null)) count += 1;
    }
  }
  return count;
}

/**
 * A summary worth showing: a refusal or failure that names a participant, or a partial save.
 * A refusal of the category write alone is said by the screen's own error, as before.
 */
function showSummary(outcome: SaveOutcome | null): boolean {
  if (outcome === null || outcome.result === 'saved') return false;
  return (
    outcome.result === 'partial' ||
    outcome.parts.some((part) => part.id !== 'host' && part.result !== 'saved' && part.result !== 'not-attempted')
  );
}

/**
 * The props the tree counts `category.content.editor` contributors with.
 *
 * The tree mounts no editor — the content screen does — so it has no document
 * to hand over; it asks only whether anybody would contribute one (Z15). A
 * module-level constant, so the zone's memo holds across renders.
 */
const CONTENT_EDITOR_PROBE = {
  categoryId: '',
  language: '',
  data: null,
  onChange: (): void => {},
} as const;

/**
 * Feature 180, WP-6 (`specs/180-one-save-zone-editors/contracts/other-editors-save-ui.md` §1) —
 * the category editor's Save covers its zone panels through a save session, one per open
 * category: opening another category (through the guard) starts an empty session.
 */
export function CategoriesTree(): ReactNode {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <SaveSessionProvider resetKey={editing ?? ''} hostModule="catalog">
      <CategoriesTreeScreen editing={editing} setEditing={setEditing} />
    </SaveSessionProvider>
  );
}

/** The create form's parent when it creates a root category. */
const ROOT_PARENT = '__root__';

/** The asset file route the Assets Library serves; `toAbsoluteAssetUrl` points it at the API. */
function assetFileUrl(assetId: string): string {
  return toAbsoluteAssetUrl(`/assets/file/${encodeURIComponent(assetId)}`);
}

/**
 * Issue #1507 (UX audit CAT-05, owner decision DEC-10) — a master-detail screen: the tree on
 * the left, one panel on the right holding either the open category's editor or the create
 * form. A row carries three controls — the name (opens the editor), a ghost "+" (a new
 * subcategory) and one actions menu — instead of five buttons and a red Delete beside the
 * frequent ones (Hick, Fitts). Every switch of the panel goes through the kit's unsaved-changes
 * guard (#1606); Cancel stays the explicit discard it has always been.
 */
function CategoriesTreeScreen({
  editing,
  setEditing,
}: {
  editing: string | null;
  setEditing: (id: string | null) => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const tc = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  // Whether a row offers **Content**: only while something contributes an
  // editor to the content screen. Without one the screen can show nothing but
  // the sentence saying so, and a link to that is a dead end.
  const hasContentEditor = useAdminZone('category.content.editor', CONTENT_EDITOR_PROBE).length > 0;
  const { language } = useTranslationContext();
  const locale = adminLanguageToLocale(language);
  const label = (name: Record<string, string>, slug: string): string =>
    pickCategoryDisplayName(name, slug, locale);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Issue #1499 (UX audit SALES-17, DEC-12 a) — a create, save, (de)activation
  // or delete is said in the page header, in a region mounted before it has
  // text, not as a success banner above the tree: the form or the row that did
  // it is gone (or changed) by then, and the header stays.
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  const [createUnderId, setCreateUnderId] = useState<string | null>(null);
  // Whether the open create form holds anything a switch would lose.
  const [createDirty, setCreateDirty] = useState(false);
  const { hasPermission } = useAuth();
  const canSeeCustomFields = hasPermission('custom_fields:read');
  // Feature 175 — the refusals of the last create / edit attempt, by field key.
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  const panelId = useId();
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);
  // The control that opened the panel; focus goes back to it when the panel closes.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // `?focus=<id>` — where a global-search Category result lands
  // (`specs/150-admin-global-search/` research R-15). The tree has no collapsed
  // state, so the category's ancestors are always shown; the row is marked
  // `aria-current`, scrolled into view and focused **once**, after the list
  // has loaded. An id the tree does not hold is ignored.
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const focusedOnce = useRef<string | null>(null);
  const focusRow = useCallback(
    (row: HTMLTableRowElement | null): void => {
      if (row === null || focusId === null || focusedOnce.current === focusId) return;
      focusedOnce.current = focusId;
      row.scrollIntoView({ block: 'center' });
      row.focus({ preventScroll: true });
    },
    [focusId],
  );

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminCategory[] }>(
        '/api/v1/admin/catalog/categories',
      );
      setCategories(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('categories.error.load'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  // Tree nodes carry the picker's minimal category shape, which drops the
  // admin-only fields (e.g. mainImageAssetId). Look the full record up by id.
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const handleCreate = useCallback(
    async (input: {
      parentCategoryId: string | null;
      slug: string;
      nameEn: string;
      namePl: string;
      customFieldValues?: Record<string, unknown>;
    }): Promise<void> => {
      setCustomFieldErrors({});
      clearStatus();
      setError(null);
      try {
        const name: Record<string, string> = {};
        if (input.nameEn) name['en-US'] = input.nameEn;
        if (input.namePl) name['pl-PL'] = input.namePl;
        await apiClient.post<{ data: AdminCategory }>('/api/v1/admin/catalog/categories', {
          parentCategoryId: input.parentCategoryId,
          slug: input.slug,
          name,
          ...(input.customFieldValues && Object.keys(input.customFieldValues).length > 0
            ? { customFieldValues: input.customFieldValues }
            : {}),
        });
        showStatus(t('categories.success.create'));
        setCreateUnderId(null);
        setCreateDirty(false);
        await refresh();
      } catch (err) {
        setCustomFieldErrors(customFieldErrorsOf(err) ?? {});
        setError(err instanceof ApiError ? err.envelope.error.message : t('categories.error.create'));
      }
    },
    [refresh, t, showStatus, clearStatus],
  );

  /**
   * The category write — the host part of the editor's one Save. The payload is the one this
   * form has always sent; a refusal is said where it was said before (the field it names, the
   * screen's error) and rethrown, so the session writes no panel after it (FR-015).
   */
  const writeCategory = useCallback(
    async (id: string, draft: EditDraft): Promise<void> => {
      setCustomFieldErrors({});
      const payload: Record<string, unknown> = {};
      if (draft.customFieldValues !== undefined && Object.keys(draft.customFieldValues).length > 0) {
        payload['customFieldValues'] = draft.customFieldValues;
      }
      payload['slug'] = draft.slug;
      payload['parentCategoryId'] = draft.parentId === '' ? null : draft.parentId;
      const existing = categories.find((c) => c.id === id);
      payload['name'] = { ...(existing?.name ?? {}), 'en-US': draft.nameEn, 'pl-PL': draft.namePl };
      try {
        await apiClient.patch<{ data: AdminCategory }>(`/api/v1/admin/catalog/categories/${id}`, payload);
      } catch (err) {
        setCustomFieldErrors(customFieldErrorsOf(err) ?? {});
        setError(err instanceof ApiError ? err.envelope.error.message : t('categories.error.update'));
        throw err;
      }
      await refresh();
    },
    [refresh, categories, t],
  );

  // --- The one Save (feature 180, WP-6) ---------------------------------------------------
  const session = useSaveSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // The open form's fields, tagged with the category they belong to.
  const [draftState, setDraftState] = useState<{ id: string; draft: EditDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const editingRecord = editing === null ? undefined : categoryById.get(editing);
  const draft: EditDraft | null =
    editing === null || editingRecord === undefined
      ? null
      : draftState?.id === editing
        ? draftState.draft
        : draftOf(editingRecord);
  const hostCount = draft !== null && editingRecord !== undefined ? hostChangeCount(draft, editingRecord) : 0;
  const totalUnsaved = hostCount + session.dirtyCount;

  const changeDraft = useCallback(
    (patch: Partial<EditDraft>): void => {
      if (editing === null || draft === null) return;
      setDraftState({ id: editing, draft: { ...draft, ...patch } });
      // The last save's summary belongs to it: an edit clears it (FR-016).
      sessionRef.current.clearOutcome();
      clearStatus();
    },
    [editing, draft, clearStatus],
  );

  const openEditor = useCallback(
    (id: string | null): void => {
      setDraftState(null);
      setCustomFieldErrors({});
      setEditing(id);
    },
    [setEditing],
  );

  /** The form's own checks (slug required and kebab-case), as the browser reports them. */
  const validateForm = (): ParticipantIssues => {
    const element = formRef.current;
    if (element === null || element.checkValidity()) return { fields: {} };
    element.reportValidity();
    const fields: Record<string, string> = {};
    for (const control of Array.from(element.elements)) {
      if (control instanceof HTMLInputElement && !control.validity.valid) {
        fields[control.name || control.id] = control.validationMessage || t('categories.error.update');
      }
    }
    return { fields };
  };

  /**
   * The one Save: the category write first (blocking), then every participant in zone order
   * (OQ-2 = A). True when every part saved; the editor then closes, as it did after a save.
   */
  const saveEdit = async (): Promise<boolean> => {
    if (editing === null || draft === null) return false;
    const id = editing;
    const toWrite = draft;
    const host: SavePart | null =
      hostCount > 0
        ? {
            id: 'host',
            label: t('categories.save.hostPartLabel'),
            blocking: true,
            count: hostCount,
            validate: async () => validateForm(),
            save: async () => writeCategory(id, toWrite),
          }
        : null;
    if (host === null && sessionRef.current.dirtyCount === 0) return false;
    setSaving(true);
    setError(null);
    clearStatus();
    try {
      const outcome = await sessionRef.current.run(host);
      if (outcome.result !== 'saved') return false;
      showStatus(t('categories.success.save'));
      openEditor(null);
      return true;
    } finally {
      setSaving(false);
    }
  };

  // --- The panel and its guard (#1507, #1606) ----------------------------------------------
  const panelKey = editing !== null ? `edit:${editing}` : createUnderId !== null ? `create:${createUnderId}` : null;
  const editDirty = totalUnsaved > 0;
  // Leaving the page or switching the panel asks once for every part: the kit's one guard
  // (Save and continue / Discard changes / Stay here). Save is offered for the editor's
  // changes; a half-filled create form can only be kept or discarded.
  const guard = useUnsavedChangesGuard({
    dirty: editDirty || createDirty,
    onSave: editDirty ? saveEdit : undefined,
    onDiscard: (): void => {
      session.discardAll();
      setDraftState(null);
      setCreateDirty(false);
    },
    title:
      editDirty && editingRecord !== undefined
        ? t('categories.guard.title', { name: label(editingRecord.name, editingRecord.slug) })
        : undefined,
    message: editDirty
      ? t(`categories.guard.body.${new Intl.PluralRules(language).select(totalUnsaved)}`, { count: String(totalUnsaved) })
      : undefined,
  });

  /** Remembers the control a panel switch came from, so closing the panel can return to it. */
  const rememberOpener = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) returnFocusRef.current = active;
  };

  /** The name, or **Edit** in the menu: opens that category in the panel. */
  const requestEdit = (id: string): void => {
    if (editing === id) {
      panelHeadingRef.current?.focus();
      return;
    }
    rememberOpener();
    guard.confirm(() => {
      clearStatus();
      setCreateUnderId(null);
      setCreateDirty(false);
      openEditor(id);
    });
  };

  /** "New root category" or a row's "+": the create form in the panel. */
  const startCreate = (parentId: string): void => {
    if (editing === null && createUnderId === parentId) {
      panelHeadingRef.current?.focus();
      return;
    }
    rememberOpener();
    guard.confirm(() => {
      clearStatus();
      if (editing !== null) {
        session.discardAll();
        openEditor(null);
      }
      setCreateDirty(false);
      setCreateUnderId(parentId);
    });
  };

  /** Closes the panel without asking — Cancel is *Discard*, as it has always been. */
  const closePanel = (): void => {
    if (editing !== null) {
      session.discardAll();
      openEditor(null);
    }
    setCreateUnderId(null);
    setCreateDirty(false);
  };

  // Opening the panel (or switching what it holds) moves focus to its heading, so a keyboard
  // or screen-reader user lands where the form starts — below the tree on a narrow screen.
  // Closing it returns focus to the control that opened it, if that control is still there.
  const previousPanelKey = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousPanelKey.current;
    previousPanelKey.current = panelKey;
    if (panelKey !== null && panelKey !== previous) {
      const heading = panelHeadingRef.current;
      if (heading !== null) {
        heading.scrollIntoView?.({ block: 'nearest' });
        heading.focus({ preventScroll: true });
      }
    } else if (panelKey === null && previous !== null) {
      const opener = returnFocusRef.current;
      returnFocusRef.current = null;
      if (opener?.isConnected) opener.focus();
    }
  }, [panelKey]);

  /** The summary's "Show": the form's first marked field, else the form. */
  const showPart = (): void => {
    setTimeout(() => {
      const element = formRef.current;
      (element?.querySelector<HTMLElement>('[aria-invalid="true"], :invalid') ?? element)?.focus();
    }, 0);
  };

  // Feature 068 — activation toggle. Deactivating hides the category and its
  // whole branch from the storefront; the admin tree keeps showing it.
  const handleToggleActive = useCallback(
    async (id: string, next: boolean): Promise<void> => {
      clearStatus();
      setError(null);
      try {
        await apiClient.patch<{ data: AdminCategory }>(
          `/api/v1/admin/catalog/categories/${id}`,
          { isActive: next },
        );
        showStatus(next ? t('categories.success.activated') : t('categories.success.deactivated'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('categories.error.update'));
      }
    },
    [refresh, t, showStatus, clearStatus],
  );

  /** Feature 013 / US5 — the main image applies at once, outside the editor's Save. */
  const handleMainImage = useCallback(
    async (id: string, assetId: string | null): Promise<void> => {
      setError(null);
      try {
        await apiClient.patch<{ data: AdminCategory }>(`/api/v1/admin/catalog/categories/${id}`, {
          mainImageAssetId: assetId,
        });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('categories.error.update'));
      }
    },
    [refresh, t],
  );

  const handleDelete = useCallback(
    async (cat: CategoryTreePickerCategory): Promise<void> => {
      const ok = await confirm({
        message: t('categories.deleteConfirm', { name: label(cat.name, cat.slug) }),
        confirmLabel: tc('common.action.delete'),
        destructive: true,
      });
      if (!ok) return;
      clearStatus();
      setError(null);
      try {
        await apiClient.delete<void>(`/api/v1/admin/catalog/categories/${cat.id}`);
        showStatus(t('categories.success.delete'));
        // The deleted category's editor, or a create form under it, has nothing left to edit.
        if (editing === cat.id) {
          session.discardAll();
          openEditor(null);
        }
        if (createUnderId === cat.id) setCreateUnderId(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('categories.error.delete'));
      }
    },
    [refresh, t, tc, confirm, showStatus, clearStatus, editing, createUnderId, session, openEditor],
  );

  const createParent = createUnderId !== null && createUnderId !== ROOT_PARENT ? categoryById.get(createUnderId) : undefined;
  const panelTitle =
    editingRecord !== undefined
      ? t('categories.panel.editTitle', { name: label(editingRecord.name, editingRecord.slug) })
      : createParent !== undefined
        ? t('categories.panel.createChildTitle', { name: label(createParent.name, createParent.slug) })
        : t('categories.action.newRoot');
  const panelOpen = (editing !== null && draft !== null) || createUnderId !== null;

  return (
    <>
      <PageHeader
        title={t('categories.page.title')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <InlineStatus {...statusProps} />
            <Button type="button" onClick={(): void => startCreate(ROOT_PARENT)}>
              <Plus />
              {t('categories.action.newRoot')}
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div
        className={cn(
          'grid items-start gap-4',
          panelOpen && 'xl:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)]',
        )}
      >
        <Card className="min-w-0">
          <CardContent>
            {/* Only the first read replaces the tree: a refresh after a write keeps the open
                editor mounted, its fields and its panels with it. */}
            {loading && categories.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('categories.loading')}</p>
            ) : tree.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('categories.empty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('categories.column.category')}</TableHead>
                    <TableHead>{t('categories.column.slug')}</TableHead>
                    <TableHead>{t('categories.column.sort')}</TableHead>
                    <TableHead>{t('categories.column.status')}</TableHead>
                    <TableHead>{t('categories.column.mainImage')}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t('categories.column.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flattenCategoryTree(tree).map(({ category: c, depth }) => {
                    const record = categoryById.get(c.id);
                    const isActive = record?.isActive ?? true;
                    const name = label(c.name, c.slug);
                    const open = editing === c.id;
                    return (
                      <TableRow
                        key={c.id}
                        data-state={open ? 'selected' : undefined}
                        className={cn(
                          isActive ? undefined : 'opacity-60',
                          focusId === c.id && 'bg-muted ring-2 ring-inset ring-ring focus-visible:outline-none',
                        )}
                        {...(focusId === c.id
                          ? { 'aria-current': 'true' as const, tabIndex: -1, ref: focusRow }
                          : {})}
                      >
                        <TableCell style={{ paddingLeft: depth * 24 + 8 }}>
                          {/* The name is the way in (the issue's "name click = Edit"): the row's
                              most frequent action is its largest target (Fitts). */}
                          <button
                            type="button"
                            className={cn(
                              'rounded-sm text-left font-medium underline-offset-4 hover:underline',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              !isActive && 'text-muted-foreground line-through',
                            )}
                            aria-expanded={open}
                            {...(open ? { 'aria-controls': panelId } : {})}
                            onClick={(): void => requestEdit(c.id)}
                          >
                            {name}
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.slug}</TableCell>
                        <TableCell>{c.sortOrder}</TableCell>
                        <TableCell>
                          <Badge variant={isActive ? 'success' : 'secondary'}>
                            {isActive
                              ? t('categories.status.active')
                              : t('categories.status.inactive')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <CategoryThumbnail assetId={record?.mainImageAssetId ?? null} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={t('categories.action.newChildOf', { name })}
                              title={t('categories.action.newChildOf', { name })}
                              onClick={(): void => startCreate(c.id)}
                            >
                              <Plus aria-hidden="true" />
                            </Button>
                            <RowActionMenu label={t('categories.action.menu', { name })}>
                              <RowActionMenuItem onSelect={(): void => requestEdit(c.id)}>
                                <Pencil aria-hidden="true" />
                                {t('categories.action.edit')}
                              </RowActionMenuItem>
                              {hasContentEditor ? (
                                <RowActionMenuItem asChild>
                                  <Link to={`/catalog/categories/${c.id}/content`}>
                                    <FileText aria-hidden="true" />
                                    {t('categories.action.content')}
                                  </Link>
                                </RowActionMenuItem>
                              ) : null}
                              <RowActionMenuItem onSelect={(): void => void handleToggleActive(c.id, !isActive)}>
                                {isActive ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                                {isActive
                                  ? t('categories.action.deactivate')
                                  : t('categories.action.activate')}
                              </RowActionMenuItem>
                              <RowActionMenuSeparator />
                              <RowActionMenuItem destructive onSelect={(): void => void handleDelete(c)}>
                                <Trash2 aria-hidden="true" />
                                {t('categories.action.delete')}
                              </RowActionMenuItem>
                            </RowActionMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {panelOpen ? (
          <Card
            id={panelId}
            role="region"
            aria-labelledby={`${panelId}-title`}
            className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto"
          >
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle id={`${panelId}-title`} ref={panelHeadingRef} tabIndex={-1} className="focus:outline-none">
                  {panelTitle}
                </CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={t('categories.panel.close')}
                  title={t('categories.panel.close')}
                  disabled={saving}
                  onClick={(): void => guard.confirm(closePanel)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {editing !== null && draft !== null && editingRecord !== undefined ? (
                <>
                  <EditForm
                    category={editingRecord}
                    categories={categories}
                    draft={draft}
                    onDraft={changeDraft}
                    values={editingRecord.customFieldValues ?? EMPTY_VALUES}
                    customFields={canSeeCustomFields ? { errors: customFieldErrors } : null}
                    saveSession={session.handle}
                    changeCount={totalUnsaved}
                    saving={saving || session.saving}
                    formRef={formRef}
                    summary={
                      showSummary(session.lastOutcome) || session.notices.length > 0 ? (
                        <SaveSessionSummary
                          outcome={showSummary(session.lastOutcome) ? session.lastOutcome : null}
                          notices={session.notices}
                          onShow={showPart}
                        />
                      ) : null
                    }
                    onCancel={closePanel}
                    onSubmit={(): void => void saveEdit()}
                  />
                  {/* After the Save row on purpose: the main image applies at once and is
                      not one of the changes Save counts (feature 180, FR-052). */}
                  <CategoryMainImage
                    mainImageAssetId={editingRecord.mainImageAssetId ?? null}
                    onChange={(assetId): void => void handleMainImage(editingRecord.id, assetId)}
                  />
                </>
              ) : createUnderId !== null ? (
                <CreateForm
                  key={createUnderId}
                  customFields={canSeeCustomFields ? { errors: customFieldErrors } : null}
                  onDirtyChange={setCreateDirty}
                  onCancel={closePanel}
                  onSubmit={(input): void =>
                    void handleCreate({
                      parentCategoryId: createUnderId === ROOT_PARENT ? null : createUnderId,
                      ...input,
                    })
                  }
                />
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
      {confirmDialog}
      {guard.dialog}
    </>
  );
}

function CreateForm({
  customFields,
  onDirtyChange,
  onSubmit,
  onCancel,
}: {
  customFields: CustomFieldsSlot | null;
  /** Whether the form holds anything a switch of the panel would lose. */
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (input: {
    slug: string;
    nameEn: string;
    namePl: string;
    customFieldValues?: Record<string, unknown>;
  }) => void;
  onCancel: () => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const { language } = useTranslationContext();
  const fieldId = useId();
  const [slug, setSlug] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [namePl, setNamePl] = useState('');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  // The slug follows the first name until the operator edits it (Tesler; DS-22, #1450).
  const slugField = useDerivedKey({ source: nameEn || namePl, value: slug, onChange: setSlug });
  const dirty =
    nameEn !== '' ||
    namePl !== '' ||
    slug !== '' ||
    Object.values(customFieldValues).some((value) => value !== undefined && value !== null && value !== '');
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        const sentSlug = slugField.commit();
        onSubmit({ slug: sentSlug, nameEn, namePl, ...(customFields ? { customFieldValues } : {}) });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-name-en`}>{t('categories.field.nameEn')}</Label>
          <Input id={`${fieldId}-name-en`} value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-name-pl`}>{t('categories.field.namePl')}</Label>
          <Input id={`${fieldId}-name-pl`} value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
        </div>
      </div>
      <SlugField
        id={`${fieldId}-slug`}
        value={slug}
        onChange={slugField.onChange}
        onBlur={slugField.onBlur}
        hint={t('categories.field.slugHint')}
      />
      {customFields ? (
        <CustomFieldValuesPanel
          entityType="category"
          values={EMPTY_VALUES}
          onChange={setCustomFieldValues}
          fieldErrors={customFields.errors}
          language={language}
        />
      ) : null}
      <div className="flex gap-2">
        <Button type="submit">{t('categories.action.create')}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('categories.action.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** The slug input both forms share: lower-case kebab-case, required, its rule said in a hint. */
function SlugField({
  id,
  value,
  onChange,
  onBlur,
  hint,
}: {
  id: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  hint: string;
}): ReactNode {
  const t = useTranslation('catalog');
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('categories.field.slug')}</Label>
      <Input
        id={id}
        name="slug"
        className="font-mono"
        value={value}
        onChange={onChange}
        {...(onBlur ? { onBlur } : {})}
        required
        pattern="[a-z0-9]+(-[a-z0-9]+)*"
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function EditForm({
  category,
  categories,
  draft,
  onDraft,
  values,
  customFields,
  saveSession,
  changeCount,
  saving,
  formRef,
  summary,
  onSubmit,
  onCancel,
}: {
  category: CategoryTreePickerCategory;
  categories: AdminCategory[];
  /** The form's fields, held by the tree (feature 180, WP-6). */
  draft: EditDraft;
  onDraft: (patch: Partial<EditDraft>) => void;
  /** The category's stored custom-field bag, the embedded panel's start. */
  values: Record<string, unknown>;
  customFields: CustomFieldsSlot | null;
  /** The editor's save session, handed to `category.editor.after` (FR-050). */
  saveSession: EditorSaveSessionHandle;
  /** The form's own changes plus every participant's. */
  changeCount: number;
  saving: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  /** The outcome of the last Save, at the top of the form. */
  summary: ReactNode;
  onSubmit: () => void;
  onCancel: () => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const tc = useTranslation('core');
  const { language } = useTranslationContext();
  const locale = adminLanguageToLocale(language);
  const fieldId = useId();
  const contributions = useAdminZone('category.editor.after', { categoryId: category.id, saveSession });
  const inert = changeCount === 0 || saving;
  const saveLabel = saving
    ? tc('saveSession.action.saving')
    : changeCount > 0
      ? tc(`saveSession.action.count.${new Intl.PluralRules(language).select(changeCount)}`, { count: String(changeCount) })
      : t('categories.action.save');
  return (
    <form
      ref={formRef}
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        if (!inert) onSubmit();
      }}
    >
      {summary}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-name-en`}>{t('categories.field.nameEn')}</Label>
          <Input id={`${fieldId}-name-en`} value={draft.nameEn} onChange={(e): void => onDraft({ nameEn: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-name-pl`}>{t('categories.field.namePl')}</Label>
          <Input id={`${fieldId}-name-pl`} value={draft.namePl} onChange={(e): void => onDraft({ namePl: e.target.value })} />
        </div>
      </div>
      {/* An existing slug is the category's storefront address: it is not re-derived from a
          renamed category, only lower-cased as typed. */}
      <SlugField
        id={`${fieldId}-slug`}
        value={draft.slug}
        onChange={(e): void => onDraft({ slug: e.target.value.toLowerCase() })}
        hint={t('categories.field.slugEditHint')}
      />
      <div className="space-y-2">
        <Label htmlFor={`${fieldId}-parent`}>{t('categories.field.parent')}</Label>
        <Select id={`${fieldId}-parent`} value={draft.parentId} onChange={(e): void => onDraft({ parentId: e.target.value })}>
          <option value="">{t('categories.field.parentRoot')}</option>
          {categories
            .filter((c) => c.id !== category.id)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {pickCategoryDisplayName(c.name, c.slug, locale)} ({c.slug})
              </option>
            ))}
        </Select>
      </div>
      {/* Feature 175 — embedded rather than saving on its own: the panel's own
          button would be a second submit inside this form. Its bag travels in
          the same `PATCH …/categories/:id` as the rest of the edit — the host
          part of the one Save. */}
      {customFields ? (
        <CustomFieldValuesPanel
          entityType="category"
          values={draft.customFieldValues === undefined ? values : { ...values, ...draft.customFieldValues }}
          onChange={(bag): void => onDraft({ customFieldValues: bag })}
          fieldErrors={customFields.errors}
          language={language}
        />
      ) : null}
      {/* Feature 091 / P7a — the place at the end of the category editor's form,
          before its Save row (feature 180, FR-052): what Save covers sits above
          it. `price_lists` contributes its display-mode override here, as a part
          of this form's Save; this screen used to import that control by path and
          hand it `catalog`'s own label and hint, which a host cannot do for a
          contributor it does not know.

          The separator is this form's chrome and must not render alone, so it
          is behind the count `useAdminZone` already filtered by both presence
          axes and each contributor's permission — `delivery_methods`' own
          integrations card, applied to a rule instead of a panel. */}
      {contributions.length > 0 ? (
        <div className="space-y-2 pt-3 border-t mt-2">
          <AdminZone name="category.editor.after" props={{ categoryId: category.id, saveSession }} />
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          // aria-disabled, not disabled: focus stays on Save after it has saved (WCAG 2.4.3).
          aria-disabled={inert}
          aria-busy={saving || undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {saveLabel}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          {t('categories.action.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** The row's 32 px main-image thumbnail (Picture Superiority), or a dash when there is none. */
function CategoryThumbnail({ assetId }: { assetId: string | null }): ReactNode {
  const t = useTranslation('catalog');
  const [failed, setFailed] = useState<string | null>(null);
  if (assetId === null) {
    return (
      <span className="text-xs text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('categories.mainImage.none')}</span>
      </span>
    );
  }
  if (failed === assetId) {
    return (
      <span
        className="inline-flex size-8 items-center justify-center rounded border bg-muted text-muted-foreground"
        title={t('categories.mainImage.unavailable')}
      >
        <ImageOff className="size-4" aria-hidden="true" />
        <span className="sr-only">{t('categories.mainImage.unavailable')}</span>
      </span>
    );
  }
  return (
    <img
      src={assetFileUrl(assetId)}
      alt=""
      width={32}
      height={32}
      loading="lazy"
      className="size-8 rounded border object-cover"
      onError={(): void => setFailed(assetId)}
    />
  );
}

// — Feature 013 / US5 — the Library picker for the Category main image, in the editor panel.

function CategoryMainImage({
  mainImageAssetId,
  onChange,
}: {
  mainImageAssetId: string | null;
  onChange: (id: string | null) => void;
}): ReactNode {
  const t = useTranslation('catalog');
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <EditorSection as="h3" title={t('categories.mainImage.title')} action={<ImmediateBadge />}>
      <div className="flex flex-wrap items-center gap-3">
        {mainImageAssetId ? (
          <img
            src={assetFileUrl(mainImageAssetId)}
            alt={t('categories.mainImage.title')}
            width={64}
            height={64}
            className="size-16 rounded border object-cover"
          />
        ) : (
          <span className="text-sm text-muted-foreground">{t('categories.mainImage.none')}</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={pickerOpen}
          onClick={(): void => setPickerOpen((v) => !v)}
        >
          <ImageIcon aria-hidden="true" />
          {pickerOpen
            ? t('categories.action.cancel')
            : mainImageAssetId
              ? t('categories.mainImage.change')
              : t('categories.mainImage.pick')}
        </Button>
        {mainImageAssetId ? (
          <Button type="button" variant="ghost" size="sm" onClick={(): void => onChange(null)}>
            {t('categories.mainImage.clear')}
          </Button>
        ) : null}
      </div>
      {pickerOpen ? (
        <AssetPicker
          acceptMimePrefix="image/"
          allowUpload
          onSelect={(a): void => {
            onChange(a.id);
            setPickerOpen(false);
          }}
          onClose={(): void => setPickerOpen(false)}
        />
      ) : null}
    </EditorSection>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default CategoriesTree;
