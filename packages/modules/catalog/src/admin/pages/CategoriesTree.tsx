import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, Eye, EyeOff, FileText } from 'lucide-react';
import {
  ApiError,
  SaveSessionProvider,
  apiClient,
  cn,
  useAuth,
  useSaveSession,
  useUnsavedChangesPrompt,
  type ParticipantIssues,
  type SaveOutcome,
  type SavePart,
} from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, InlineStatus, Input, Label, PageHeader, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { AssetPicker, CustomFieldValuesPanel, ModalDialog, SaveSessionSummary, adminLanguageToLocale, customFieldErrorsOf, buildCategoryTree, flattenCategoryTree, pickCategoryDisplayName, useConfirmDialog } from '@endora-commerce/admin-kit/components';
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
  const { hasPermission } = useAuth();
  const canSeeCustomFields = hasPermission('custom_fields:read');
  // Feature 175 — the refusals of the last create / edit attempt, by field key.
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
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
  const [guard, setGuard] = useState<{ target: string } | null>(null);
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
  // Leaving the page — an in-app link, a reload, closing the tab — asks once for every part.
  useUnsavedChangesPrompt(totalUnsaved > 0);

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
      setGuard(null);
      setEditing(id);
    },
    [setEditing],
  );

  /** **Edit** on a row: through the guard when the open category has unsaved changes (FR-051). */
  const requestEdit = (id: string): void => {
    if (editing !== null && editing !== id && totalUnsaved > 0) {
      setGuard({ target: id });
      return;
    }
    clearStatus();
    openEditor(id);
  };

  /** Opening a create form starts a new action: the last result no longer applies. */
  const startCreate = (parentId: string): void => {
    clearStatus();
    setCreateUnderId(parentId);
  };

  /** Cancel is *Discard* without a dialog, as it has always been for the form's own fields. */
  const cancelEdit = (): void => {
    session.discardAll();
    openEditor(null);
  };

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
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('categories.error.delete'));
      }
    },
    [refresh, t, tc, confirm, showStatus, clearStatus],
  );

  return (
    <>
      <PageHeader
        title={t('categories.page.title')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <InlineStatus {...statusProps} />
            <Button type="button" onClick={(): void => startCreate('__root__')}>
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

      {createUnderId === '__root__' ? (
        <CreateForm
          parentLabel="(root)"
          customFields={canSeeCustomFields ? { errors: customFieldErrors } : null}
          onCancel={(): void => setCreateUnderId(null)}
          onSubmit={(input): void => void handleCreate({ parentCategoryId: null, ...input })}
        />
      ) : null}

      <Card>
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
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {flattenCategoryTree(tree).map(({ category: c, depth }) => {
                  const record = categoryById.get(c.id);
                  const isActive = record?.isActive ?? true;
                  return (
                  <Fragment key={c.id}>
                    <TableRow
                      className={cn(
                        isActive ? undefined : 'opacity-60',
                        focusId === c.id && 'bg-muted ring-2 ring-inset ring-ring focus-visible:outline-none',
                      )}
                      {...(focusId === c.id
                        ? { 'aria-current': 'true' as const, tabIndex: -1, ref: focusRow }
                        : {})}
                    >
                      <TableCell style={{ paddingLeft: depth * 24 + 8 }}>
                        {editing === c.id && draft !== null ? (
                          <EditForm
                            category={c}
                            categories={categories}
                            draft={draft}
                            onDraft={changeDraft}
                            values={record?.customFieldValues ?? EMPTY_VALUES}
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
                            onCancel={cancelEdit}
                            onSubmit={(): void => void saveEdit()}
                          />
                        ) : (
                          <span
                            className={
                              isActive
                                ? 'font-medium'
                                : 'font-medium text-muted-foreground line-through'
                            }
                          >
                            {label(c.name, c.slug)}
                          </span>
                        )}
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
                        <CategoryMainImage
                          mainImageAssetId={categoryById.get(c.id)?.mainImageAssetId ?? null}
                          onChange={(assetId): void => {
                            void apiClient
                              .patch<{ data: AdminCategory }>(
                                `/api/v1/admin/catalog/categories/${c.id}`,
                                { mainImageAssetId: assetId },
                              )
                              .then(() => void refresh())
                              .catch((err: unknown) => {
                                setError(
                                  err instanceof ApiError
                                    ? err.envelope.error.message
                                    : 'Update failed.',
                                );
                              });
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        {editing === c.id ? null : (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={(): void => requestEdit(c.id)}
                            >
                              <Pencil />
                              {t('categories.action.edit')}
                            </Button>
                            {hasContentEditor ? (
                              <Button asChild variant="outline" size="sm">
                                <Link to={`/catalog/categories/${c.id}/content`}>
                                  <FileText />
                                  {t('categories.action.content')}
                                </Link>
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={(): void => startCreate(c.id)}
                            >
                              <Plus />
                              {t('categories.action.newChild')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              aria-pressed={!isActive}
                              onClick={(): void => void handleToggleActive(c.id, !isActive)}
                            >
                              {isActive ? <EyeOff /> : <Eye />}
                              {isActive
                                ? t('categories.action.deactivate')
                                : t('categories.action.activate')}
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              type="button"
                              onClick={(): void => void handleDelete(c)}
                            >
                              <Trash2 />
                              {t('categories.action.delete')}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {createUnderId === c.id ? (
                      <TableRow>
                        <TableCell colSpan={6} style={{ paddingLeft: depth * 24 + 32 }}>
                          <CreateForm
                            parentLabel={label(c.name, c.slug)}
                            customFields={canSeeCustomFields ? { errors: customFieldErrors } : null}
                            onCancel={(): void => setCreateUnderId(null)}
                            onSubmit={(input): void =>
                              void handleCreate({ parentCategoryId: c.id, ...input })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
      {guard !== null && editingRecord !== undefined ? (
        <ModalDialog
          title={t('categories.guard.title', { name: label(editingRecord.name, editingRecord.slug) })}
          onClose={(): void => setGuard(null)}
          busy={saving}
          dismissOnScrim={false}
          aria-describedby="category-guard-body"
          footer={
            <>
              <Button type="button" variant="outline" disabled={saving} onClick={(): void => setGuard(null)}>
                {t('categories.guard.stay')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={(): void => {
                  session.discardAll();
                  openEditor(guard.target);
                }}
              >
                {t('categories.guard.discard')}
              </Button>
              <Button
                type="button"
                disabled={saving}
                aria-busy={saving || undefined}
                onClick={(): void => {
                  const target = guard.target;
                  void saveEdit().then((ok) => {
                    if (ok) openEditor(target);
                    else setGuard(null);
                  });
                }}
              >
                {t('categories.guard.save')}
              </Button>
            </>
          }
        >
          <p id="category-guard-body" className="text-sm">
            {t(`categories.guard.body.${new Intl.PluralRules(language).select(totalUnsaved)}`, { count: String(totalUnsaved) })}
          </p>
        </ModalDialog>
      ) : null}
    </>
  );
}

function CreateForm({
  parentLabel,
  customFields,
  onSubmit,
  onCancel,
}: {
  parentLabel: string;
  customFields: CustomFieldsSlot | null;
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
  const [slug, setSlug] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [namePl, setNamePl] = useState('');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  return (
    <Card className="mb-4">
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent): void => {
            e.preventDefault();
            onSubmit({ slug, nameEn, namePl, ...(customFields ? { customFieldValues } : {}) });
          }}
        >
          <p className="text-sm">
            {t('categories.create.under')} <strong>{parentLabel}</strong>
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cslug">{t('categories.field.slug')}</Label>
              <Input
                id="cslug"
                value={slug}
                onChange={(e): void => setSlug(e.target.value.toLowerCase())}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                title="kebab-case"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cen">{t('categories.field.nameEn')}</Label>
              <Input id="cen" value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cpl">{t('categories.field.namePl')}</Label>
              <Input id="cpl" value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
            </div>
          </div>
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
      </CardContent>
    </Card>
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
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-slug`}>{t('categories.field.slug')}</Label>
          <Input
            id={`${fieldId}-slug`}
            name="slug"
            value={draft.slug}
            onChange={(e): void => onDraft({ slug: e.target.value.toLowerCase() })}
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </div>
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
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-name-en`}>{t('categories.field.nameEn')}</Label>
          <Input id={`${fieldId}-name-en`} value={draft.nameEn} onChange={(e): void => onDraft({ nameEn: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${fieldId}-name-pl`}>{t('categories.field.namePl')}</Label>
          <Input id={`${fieldId}-name-pl`} value={draft.namePl} onChange={(e): void => onDraft({ namePl: e.target.value })} />
        </div>
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
          size="sm"
          // aria-disabled, not disabled: focus stays on Save after it has saved (WCAG 2.4.3).
          aria-disabled={inert}
          aria-busy={saving || undefined}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {saveLabel}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onCancel}>
          {t('categories.action.cancel')}
        </Button>
      </div>
    </form>
  );
}

// — Feature 013 / US5 — inline Library picker for the Category main image.

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
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {mainImageAssetId ? `${mainImageAssetId.slice(0, 8)}…` : t('categories.mainImage.none')}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(): void => setPickerOpen((v) => !v)}
        >
          {pickerOpen
            ? t('categories.action.cancel')
            : mainImageAssetId
              ? t('categories.mainImage.change')
              : t('categories.mainImage.pick')}
        </Button>
        {mainImageAssetId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(): void => onChange(null)}
            title={t('categories.mainImage.clear')}
          >
            ✕
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
    </div>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default CategoriesTree;
