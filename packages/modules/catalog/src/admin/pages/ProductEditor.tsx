import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ChevronDown, Copy, Lock, Plus, RotateCw, Trash2 } from 'lucide-react';
import {
  ERROR_CODES,
  type ScopeMissingValue,
  type ScopeRef,
  type ScopeWarning,
  type ScopedWriteOp,
  type UrlKeyRedirectTakeoverRequiredDetails,
} from '@endora-commerce/contracts';
import {
  ApiError,
  apiClient,
  useAuth,
  useUnsavedChangesPrompt,
  INERT_SAVE_SESSION,
  SaveSessionProvider,
  useSaveSession,
  type SaveOutcome,
  type SavePart,
} from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EditorSection,
  InlineStatus,
  Input,
  Label,
  PageHeader,
  RecordTabs,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { ModalDialog, ProductPicker, SaveSessionSummary } from '@endora-commerce/admin-kit/components';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';
import { ProductInventoryTab } from '../components/ProductInventoryTab.js';
import { ProductVariantsSection } from '../components/ProductVariantsSection.js';
import { PackagingUnitsEditor } from '../components/PackagingUnitsEditor.js';
import { ProductOrderRulesCard } from '../components/ProductOrderRulesCard.js';
import { ProductAttributesTab } from '../components/ProductAttributesTab.js';
import { ProductScopeOverview } from '../components/ProductScopeOverview.js';
import { GallerySection } from '../components/ProductGallerySection.js';
import { AttachmentsSection } from '../components/ProductAttachmentsSection.js';
import { ArchivedPill, ProductStatusPill } from '../components/ProductStatusPills.js';
import { ProductScopeBar } from '../components/ProductScopeBar.js';
import { ProductEditorSaveAction } from '../components/ProductEditorSaveAction.js';
import { DetailsTab } from '../components/editor/DetailsTab.js';
import { EditorField, ProductEditorContextProvider, fieldDomId, type ProductEditorContextValue } from '../components/editor/editor-context.js';
import { sectionTitle } from '../components/editor/SectionBadge.js';
import { TextControl } from '../components/editor/scoped-controls.js';
import { useConfirmRemoval } from '../components/editor/confirm-removal.js';
import { RowRemoveButton } from '../components/editor/RowRemoveButton.js';
import { ProductCreateForm } from './ProductCreateForm.js';
import { describeIncompletePair } from '../lib/product-scopes-api.js';
import { takeoverDetails, urlKeyErrorMessage, describeKeyInLanguage } from '../lib/product-url-keys-api.js';
import {
  initialEditorState,
  fieldViewAt,
  scopeToRequest,
  scopedEditorReducer,
  stagedToChanges,
  type ImmediateFamily,
  type ScopedEditorState,
} from '../lib/scoped-editor-store.js';
import { getEditorPreference, getScopedValues, putEditorPreference, saveScopedValues } from '../lib/scoped-values-api.js';
import {
  channelName,
  languageName,
  parentScope,
  sameScope,
  scopeFromSearch,
  scopeInWords,
  scopeKey,
  scopeShortWords,
  searchWithScope,
  widerScope,
  type ValidScopes,
} from '../lib/editor-scope.js';

/**
 * The product editor (feature 174, US5–US7; `contracts/editor-ui.md`).
 *
 * One scope switcher sets the scope of the whole editor; the scope lives in the URL
 * (`?scope=global|channel|cl&channel=…&language=…&tab=…&field=…`). The editor reads the scope in
 * one request (`GET …/scoped-values`), stages every change of that scope in one store and writes
 * them with one Save (`PUT …/scoped-values`) — the product row's global-only fields at Global
 * included. Structural operations (variants, images, attachments, packaging units, links, prices,
 * membership, stock) run at once as their own audited Commands, carry an "Applies immediately"
 * badge, and neither stage nor clear the staged changes.
 *
 * Switching scope (the switcher, an "Edit at …" jump, browser Back) with staged changes asks
 * Save / Discard / Stay first.
 */

const TAB_IDS = [
  'details',
  'attributes',
  'pricing',
  'variants',
  'composite',
  'media',
  'inventory',
  'attachments',
  'links',
  'channels',
  'scopes',
  'seo',
] as const;
type TabId = (typeof TAB_IDS)[number];

/** Tabs whose content is the same at every scope (§6): outside Global they show a notice. */
const GLOBAL_ONLY_TABS = new Set<TabId>(['pricing', 'variants', 'composite', 'links', 'channels']);

const GLOBAL: ScopeRef = { level: 'global' };
const PRODUCT_PATH = (id: string): string => `/api/v1/admin/catalog/products/${encodeURIComponent(id)}`;

type Translate = (key: string, params?: Record<string, string>) => string;

type FormError =
  | { kind: 'validation'; count: number }
  | { kind: 'conflict' }
  | { kind: 'seo' }
  | { kind: 'message'; text: string };

type Guard = { kind: 'switch' | 'url'; target: ScopeRef; note?: string; field?: string; tab?: string } | { kind: 'leave' };

export function ProductEditor(): ReactNode {
  const params = useParams<{ id: string }>();
  if (params.id === 'new') return <ProductCreateForm />;
  if (!params.id) return null;
  return <ProductEditorSession key={params.id} productId={params.id} />;
}

/**
 * Feature 180 (`specs/180-one-save-zone-editors/contracts/product-editor-save-ui.md` §1) — the
 * editor's one Save covers its zone panels through a save session. The session belongs to the
 * scope it was made at (OQ-4 = A): its key is the scope the editor last opened, so a scope switch
 * — which the guard lets through only once every part is saved or discarded — starts an empty
 * session.
 */
function ProductEditorSession({ productId }: { productId: string }): ReactNode {
  const [openedScope, setOpenedScope] = useState('');
  return (
    <SaveSessionProvider resetKey={`${productId}|${openedScope}`} hostModule="catalog">
      <ScopedProductEditor productId={productId} onScopeOpened={setOpenedScope} />
    </SaveSessionProvider>
  );
}

/** Zone → tab, for the summary's "Show" (`product-editor-save-ui.md` §2). */
function tabOfZone(zone: string | null): TabId {
  if (zone === 'product.editor.pricing.before' || zone === 'product.editor.pricing.after') return 'pricing';
  if (zone === 'product.editor.channels') return 'channels';
  return 'details';
}

/** A field whose `empty` the server refuses outside `view.required` (data-model §9, R21). */
function refusesEmpty(path: string, state: ScopedEditorState): boolean {
  if (path.startsWith('product:')) return true;
  if (path === 'status' || path === 'returnable' || path === 'audience') return true;
  if (/^(gallery|attachment):[^:]+:hidden$/.test(path)) return true;
  if (state.scope.level === 'global' && (/^attachment:[^:]+:name$/.test(path) || /^packagingUnit:[^:]+:name$/.test(path))) return true;
  if (path.startsWith('attribute:') && state.data) {
    const attr = state.data.attributes.find((a) => `attribute:${a.key}` === path);
    if (attr && ['enum', 'select', 'boolean'].includes(attr.valueType)) return true;
  }
  return false;
}

function errorOf(err: unknown): { status: number; code: string; message: string; details?: Record<string, unknown> } | null {
  if (!(err instanceof ApiError)) return null;
  const e = err.envelope.error as { code: string; message: string; details?: Record<string, unknown> };
  return { status: err.status, code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) };
}

/** The tab a field lives on; a scope-map link without a field opens Details. */
/**
 * A translated lead, then the server's sentence as detail (final design review): the envelope's
 * message is in the request language only when the backend has that code's translation, so it is
 * never the whole of what the operator reads.
 */
function withServerDetail(lead: string, err: unknown): string {
  const detail = errorOf(err)?.message;
  return detail && detail !== lead ? `${lead} ${detail}` : lead;
}

function tabOfField(field: string | undefined): TabId {
  return field?.startsWith('attribute:') ? 'attributes' : 'details';
}

function familyOfPath(path: string): ImmediateFamily | null {
  if (path.startsWith('gallery')) return 'gallery';
  if (path.startsWith('attachment:')) return 'attachments';
  if (path.startsWith('packagingUnit:')) return 'packagingUnits';
  return null;
}

function ScopedProductEditor({
  productId,
  onScopeOpened,
}: {
  productId: string;
  onScopeOpened(key: string): void;
}): ReactNode {
  const t = useTranslation('catalog') as Translate;
  // The admin's language names languages (`Intl.DisplayNames`); a screen mounted without the
  // shell's provider (a test) falls back to English.
  const adminLanguage = useContext(AppLanguageContext)?.language ?? 'en';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const readOnly = !canWrite;
  const session = useSaveSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // The probe only counts contributions; it renders none, so it carries the inert handle.
  const channelContributions = useAdminZone('product.editor.channels', { productId, saveSession: INERT_SAVE_SESSION });
  const seoContributions = useAdminZone('product.editor.seo', {
    productId,
    scope: GLOBAL,
    scopeLabel: '',
    parentScopeLabel: null,
    view: null,
    staged: new Map(),
    onStage: () => undefined,
    readOnly: true,
    errors: {},
    version: null,
  });

  const urlScope = scopeFromSearch(searchParams);
  const urlKey = urlScope ? scopeKey(urlScope) : '';
  const [state, dispatch] = useReducer(scopedEditorReducer, urlScope ?? GLOBAL, initialEditorState);
  const stateRef = useRef(state);
  stateRef.current = state;

  /** The scope the last load was started for; the URL effect compares against it. */
  const loadedKeyRef = useRef<string | null>(null);
  const requestRef = useRef(0);
  /** Set when the editor itself moves the URL after the guard has been passed. */
  const skipGuardRef = useRef(false);
  const pendingNoteRef = useRef<string | null>(null);
  const prefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last valid-scope list, kept while a scope loads so the switcher stays usable. */
  const validRef = useRef<ValidScopes | null>(null);

  const [announcement, setAnnouncement] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [gateWarning, setGateWarning] = useState<string | null>(null);
  // Issue #1499 (UX audit SALES-17, DEC-12 a; CAT-09) — "Saved N changes" is said beside Save,
  // and "Archived" / "Restored" beside the Product menu, each in a region mounted before it has
  // text, not as a success banner between the header and the tabs that pushes the form down.
  const saveStatus = useInlineStatus();
  const wholeStatus = useInlineStatus();
  const [guard, setGuard] = useState<Guard | null>(null);
  const [saving, setSaving] = useState(false);
  const [takeovers, setTakeovers] = useState<UrlKeyRedirectTakeoverRequiredDetails['takeovers'] | null>(null);
  const [archivedOverride, setArchivedOverride] = useState<string | null | undefined>(undefined);
  const [archiveDialog, setArchiveDialog] = useState<'archive' | 'restore' | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const productMenuRef = useRef<HTMLButtonElement | null>(null);
  /** Where focus goes when the archive dialog closes: the Product menu once Restore has gone. */
  const archiveDialogFinalFocus = useRef<HTMLElement | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [wholeProductDialog, setWholeProductDialog] = useState<'duplicate' | 'delete' | null>(null);
  const [wholeProductError, setWholeProductError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [categories, setCategories] = useState<Array<{ id: string; parentCategoryId: string | null; name: Record<string, string>; slug: string; sortOrder: number }>>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [attributeSets, setAttributeSets] = useState<Array<{ id: string; code: string; isSystem: boolean }>>([]);

  if (state.data) validRef.current = state.data.validScopes;
  const valid: ValidScopes = state.data?.validScopes ?? validRef.current ?? { channels: [] };
  const words = (scope: ScopeRef, v: ValidScopes = valid): string => scopeInWords(scope, v, t, adminLanguage);
  const scopeLabel = scopeShortWords(state.scope, valid, t, adminLanguage);
  const parentLabel = scopeShortWords(parentScope(state.scope), valid, t, adminLanguage);
  /** `key.one|few|many|other` by the admin language's plural rules (PL needs few / many). */
  const plural = (key: string, count: number, params: Record<string, string> = {}): string =>
    t(`${key}.${new Intl.PluralRules(adminLanguage).select(count)}`, { count: String(count), ...params });

  // The live region is cleared first, so the same sentence twice is announced twice (WCAG 4.1.3).
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((text: string): void => {
    setAnnouncement('');
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    announceTimerRef.current = setTimeout(() => setAnnouncement(text), 50);
  }, []);
  useEffect(
    () => (): void => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    },
    [],
  );
  /** The scope the last successful read opened; a different one is announced once its data is in. */
  const announcedScopeRef = useRef<string | null>(null);

  // The reference lists the Details tab picks from (global, read once). A failed read is an
  // error with a retry, never an empty list (final design review): "No categories" would be a lie.
  const [referenceError, setReferenceError] = useState(false);
  const referenceRequest = useRef(0);
  const loadReference = useCallback((): void => {
    const request = ++referenceRequest.current;
    setCategoriesLoading(true);
    setReferenceError(false);
    void Promise.allSettled([
      apiClient.get<{ data: typeof categories }>('/api/v1/admin/catalog/categories'),
      apiClient.get<{ data: typeof attributeSets }>('/api/v1/admin/catalog/attribute-sets'),
    ]).then(([cats, sets]) => {
      if (request !== referenceRequest.current) return;
      if (cats.status === 'fulfilled') setCategories(cats.value.data ?? []);
      if (sets.status === 'fulfilled') setAttributeSets(sets.value.data ?? []);
      setReferenceError(cats.status === 'rejected' || sets.status === 'rejected');
      setCategoriesLoading(false);
    });
  }, []);
  useEffect(() => {
    loadReference();
    return (): void => {
      referenceRequest.current += 1;
    };
  }, [loadReference]);

  // --- Loading a scope --------------------------------------------------------------------
  const load = useCallback(
    async (requested: ScopeRef, options: { note?: string | null; field?: string | null } = {}): Promise<void> => {
      const request = ++requestRef.current;
      loadedKeyRef.current = scopeKey(requested);
      dispatch({ type: 'switching', scope: requested });
      setLoadError(null);
      setFormError(null);
      setGateWarning(null);
      let target = requested;
      let reason: string | null = null;
      for (;;) {
        try {
          const res = await getScopedValues(productId, target);
          if (request !== requestRef.current) return;
          dispatch({ type: 'loaded', data: res.data });
          const opened = res.data.scope;
          onScopeOpened(scopeKey(opened));
          if (!sameScope(opened, requested)) {
            loadedKeyRef.current = scopeKey(opened);
            setSearchParams((prev) => searchWithScope(prev, opened), { replace: true });
          }
          const openedWords = scopeInWords(opened, res.data.validScopes, t, adminLanguage);
          const note = reason ? t('productEditor.scope.openedAt', { scope: openedWords, reason }) : (options.note ?? null);
          // After the data is in (not when the switch starts): the scope, Global included.
          const previous = announcedScopeRef.current;
          announcedScopeRef.current = scopeKey(opened);
          const switched = previous !== null && previous !== scopeKey(opened);
          const where = switched
            ? opened.level === 'global'
              ? t('productEditor.scope.loadedAt', { scope: openedWords })
              : t('productEditor.scope.banner', { scope: openedWords })
            : null;
          const spoken = [note, where].filter(Boolean).join(' ');
          if (spoken) announce(spoken);
          if (prefTimerRef.current) clearTimeout(prefTimerRef.current);
          prefTimerRef.current = setTimeout(() => void putEditorPreference(productId, opened), 500);
          if (options.field) {
            const field = options.field;
            setTimeout(() => document.getElementById(fieldDomId(field))?.focus(), 0);
          }
          return;
        } catch (err) {
          if (request !== requestRef.current) return;
          const e = errorOf(err);
          const wider = widerScope(target);
          if (e?.code === ERROR_CODES.SCOPE_INVALID && wider) {
            reason ??=
              e.details?.['reason'] === 'language_not_offered'
                ? t('productEditor.scope.reason.languageNotOffered')
                : t('productEditor.scope.reason.notMember');
            target = wider;
            continue;
          }
          setLoadError(e?.message ?? t('productEditor.error.load'));
          return;
        }
      }
    },
    [productId, setSearchParams, t, adminLanguage, announce, onScopeOpened],
  );

  /** The host's staged cells plus every participant's changes (FR-010, FR-030). */
  const hasUnsaved = useCallback((): boolean => stateRef.current.staged.size + sessionRef.current.dirtyCount > 0, []);

  // No scope in the URL: the preference seeds it (Global when there is none), replacing the entry.
  useEffect(() => {
    if (urlScope) return undefined;
    let cancelled = false;
    void getEditorPreference(productId)
      .catch(() => null)
      .then((pref) => {
        if (!cancelled) setSearchParams((prev) => searchWithScope(prev, pref ?? GLOBAL), { replace: true });
      });
    return (): void => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey, productId]);

  // The URL is the truth: a scope it names that is not the loaded one is loaded — through the
  // switch guard when there are staged changes (browser Back / Forward).
  useEffect(() => {
    if (!urlScope) return;
    if (scopeKey(urlScope) === loadedKeyRef.current) return;
    if (!skipGuardRef.current && loadedKeyRef.current !== null && hasUnsaved()) {
      setGuard({ kind: 'url', target: urlScope });
      return;
    }
    skipGuardRef.current = false;
    const note = pendingNoteRef.current;
    pendingNoteRef.current = null;
    void load(urlScope, { note, field: searchParams.get('field') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);

  useEffect(
    () => (): void => {
      if (prefTimerRef.current) clearTimeout(prefTimerRef.current);
    },
    [],
  );

  // A staged change of a subject an immediate action removed is dropped and said (§3).
  useEffect(() => {
    if (state.dropped.length === 0) return;
    const family = familyOfPath(state.dropped[0]!);
    announce(
      t(
        family === 'attachments'
          ? 'productEditor.immediate.droppedAttachment'
          : family === 'packagingUnits'
            ? 'productEditor.immediate.droppedPackagingUnit'
            : 'productEditor.immediate.droppedImage',
      ),
    );
  }, [state.dropped, t, announce]);

  const totalUnsaved = state.staged.size + session.dirtyCount;
  const { show: showSaveStatus, clear: clearSaveStatus } = saveStatus;
  useUnsavedChangesPrompt(totalUnsaved > 0);

  // "Saved N changes" belongs to the last save: a new staged edit clears it, and the summary of
  // the last save with it (FR-016; a participant's edit clears the summary itself).
  useEffect(() => {
    if (state.staged.size > 0) {
      clearSaveStatus();
      sessionRef.current.clearOutcome();
    }
  }, [state.staged, clearSaveStatus]);
  useEffect(() => {
    if (session.dirtyCount > 0) clearSaveStatus();
  }, [session.dirtyCount, clearSaveStatus]);

  const go = useCallback(
    (next: ScopeRef, note?: string, field?: string, tab?: string): void => {
      pendingNoteRef.current = note ?? null;
      skipGuardRef.current = true;
      setSearchParams((prev) => {
        const sp = searchWithScope(prev, next);
        sp.delete('field');
        if (field) sp.set('field', field);
        if (tab) sp.set('tab', tab);
        return sp;
      });
    },
    [setSearchParams],
  );

  const requestScope = useCallback(
    (next: ScopeRef, note?: string, field?: string, tab?: string): void => {
      if (sameScope(next, stateRef.current.scope)) {
        if (tab) {
          setSearchParams((prev) => {
            const sp = new URLSearchParams(prev);
            sp.set('tab', tab);
            sp.delete('field');
            return sp;
          });
        }
        if (field) setTimeout(() => document.getElementById(fieldDomId(field))?.focus(), 0);
        return;
      }
      if (hasUnsaved()) {
        setGuard({ kind: 'switch', target: next, ...(note ? { note } : {}), ...(field ? { field } : {}), ...(tab ? { tab } : {}) });
        return;
      }
      go(next, note, field, tab);
    },
    [go, setSearchParams, hasUnsaved],
  );

  const refreshFamily = useCallback(
    async (family: ImmediateFamily): Promise<void> => {
      const scope = stateRef.current.scope;
      try {
        const res = await getScopedValues(productId, scope);
        if (sameScope(stateRef.current.scope, scope)) dispatch({ type: 'refreshFamily', family, data: res.data });
      } catch {
        // The structural change is done; the list refreshes on the next read.
      }
    },
    [productId],
  );

  // The copy (§8) bumped the version: the next Save sends it; staged cells stay (R7).
  const afterCopy = useCallback(
    (version: string, fieldLabel: string, count: number): void => {
      dispatch({ type: 'version', version });
      announce(plural('productEditor.copy.done', count, { field: fieldLabel }));
    },
    // `plural` reads `t` and the admin language only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [announce, t, adminLanguage],
  );

  // --- Save --------------------------------------------------------------------------------
  /**
   * Feature 180 — the editor's own write, as the first and blocking part of the one Save
   * (`product-editor-save-ui.md` §1, OQ-2 = A): the required-empty checks are its `validate`, the
   * `PUT …/scoped-values` its `save`, and the error handling is 174's, unchanged. `null` when no
   * scoped change is staged or the operator may not write the product (OQ-6 = A).
   */
  const hostPart = (s: ScopedEditorState, confirmTakeover?: string[]): SavePart | null => {
    if (!s.data || s.version === null || s.staged.size === 0 || readOnly) return null;
    const data = s.data;
    const version = s.version;
    return {
      id: 'host',
      label: t('productEditor.save.hostPartLabel'),
      blocking: true,
      count: s.staged.size,
      validate: async () => {
        const parent = scopeShortWords(parentScope(s.scope), data.validScopes, t, adminLanguage);
        const errors: Record<string, string> = {};
        for (const [path, op] of s.staged) {
          if (op.op !== 'empty') continue;
          if (fieldViewAt(data, path)?.required || refusesEmpty(path, s)) {
            errors[path] =
              s.scope.level === 'global'
                ? t('productEditor.save.error.requiredEmpty')
                : t('productEditor.save.error.requiredEmptyScoped', { scope: parent });
          }
        }
        if (Object.keys(errors).length > 0) {
          dispatch({ type: 'errors', errors });
          setFormError({ kind: 'validation', count: Object.keys(errors).length });
          const first = Object.keys(errors)[0]!;
          setTimeout(() => document.getElementById(fieldDomId(first))?.focus(), 0);
        }
        return { fields: errors };
      },
      save: async () => {
        try {
          const changes = stagedToChanges(s.staged);
          const res = await saveScopedValues(productId, {
            scope: scopeToRequest(s.scope),
            version,
            changes: confirmTakeover ? { ...changes, confirmTakeover } : changes,
          });
          dispatch({ type: 'loaded', data: res.data });
          setTakeovers(null);
          const completeness = (res.warnings ?? []).filter(
            (w): w is Extract<ScopeWarning, { kind: 'completeness' }> => w.kind === 'completeness',
          );
          if (completeness.length > 0) {
            gateWarnedRef.current = true;
            const name = (id: string): string => channelName(res.data.validScopes, id);
            setGateWarning(
              t('productEditor.scopeControls.warning.incomplete', {
                details: completeness.map((w) => describeIncompletePair(w, name, t)).join('; '),
              }),
            );
          }
        } catch (err) {
          handleSaveError(err, s);
          throw err;
        }
      },
    };
  };

  /** Set by the host part when the write answered a completeness warning (no success sentence then). */
  const gateWarnedRef = useRef(false);

  /**
   * The one Save (FR-010…FR-016): the host part first, then every participant in zone order,
   * through the session. True when every part was saved.
   */
  const save = useCallback(
    async (confirmTakeover?: string[]): Promise<boolean> => {
      const s = stateRef.current;
      const current = sessionRef.current;
      if (!s.data) return false;
      const host = hostPart(s, confirmTakeover);
      if (host === null && current.dirtyCount === 0) return false;
      const total = (host?.count ?? 0) + current.dirtyCount;
      gateWarnedRef.current = false;
      setSaving(true);
      setFormError(null);
      setGateWarning(null);
      clearSaveStatus();
      wholeStatus.clear();
      try {
        const outcome: SaveOutcome = await current.run(host);
        if (outcome.result === 'saved') {
          if (!gateWarnedRef.current) showSaveStatus(plural('productEditor.save.saved', total, { scope: scopeInWords(s.scope, s.data.validScopes, t, adminLanguage) }));
          return true;
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    // `hostPart` and `plural` read `t`, the admin language, `productId` and `readOnly` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [productId, readOnly, t, adminLanguage],
  );

  function handleSaveError(err: unknown, s: ScopedEditorState): void {
    const e = errorOf(err);
    if (!e) {
      setFormError({ kind: 'message', text: t('productEditor.error.save') });
      return;
    }
    const takeover = takeoverDetails(err);
    if (takeover) {
      setTakeovers(takeover.takeovers);
      return;
    }
    if (e.code === ERROR_CODES.VERSION_CONFLICT) {
      setFormError({ kind: 'conflict' });
      return;
    }
    if (e.code === 'MODULE_DISABLED') {
      setFormError({ kind: 'seo' });
      return;
    }
    if (e.code === ERROR_CODES.SKU_ALREADY_EXISTS) {
      dispatch({ type: 'errors', errors: { 'product:sku': t('errors.SKU_ALREADY_EXISTS') } });
      setFormError({ kind: 'validation', count: 1 });
      setTimeout(() => document.getElementById(fieldDomId('product:sku'))?.focus(), 0);
      return;
    }
    if (e.code === ERROR_CODES.URL_KEY_TAKEN) {
      dispatch({ type: 'errors', errors: { urlKey: urlKeyErrorMessage(err, t) ?? t('errors.URL_KEY_TAKEN') } });
      setFormError({ kind: 'validation', count: 1 });
      setTimeout(() => document.getElementById(fieldDomId('urlKey'))?.focus(), 0);
      return;
    }
    if (e.code === ERROR_CODES.SCOPE_INCOMPLETE && Array.isArray(e.details?.['pairs'])) {
      const pairs = e.details['pairs'] as Array<{ channelId: string; languageCode: string; missing: ScopeMissingValue[] }>;
      const name = (id: string): string => channelName(s.data?.validScopes ?? { channels: [] }, id);
      setFormError({
        kind: 'message',
        text: t('productEditor.statusGate.refused', { details: pairs.map((p) => describeIncompletePair(p, name, t)).join('; ') }),
      });
      return;
    }
    const fields = e.details?.['fields'];
    if (Array.isArray(fields) && fields.length > 0) {
      const errors: Record<string, string> = {};
      const gone: string[] = [];
      let download = false;
      for (const entry of fields as Array<string | { field: string; reason?: string }>) {
        // The Global-only family answers `product.<key>`; the editor's path is `product:<key>`.
        const raw = typeof entry === 'string' ? `product:${entry}` : entry.field;
        const field = raw.startsWith('product.') ? `product:${raw.slice('product.'.length)}` : raw;
        const reason =
          typeof entry === 'string'
            ? 'global_only'
            : (entry.reason ?? (e.code === ERROR_CODES.FIELD_NOT_AT_SCOPE ? 'not_at_scope' : 'invalid'));
        if (field === 'product:downloadAssetId' || field === 'product:downloadUrl') download = true;
        else if (field === 'product:attributeSetId' || field === 'product:categoryIds') {
          // A Global-only reference that names nothing: the field's own words, the change kept.
          errors[field] = reason === 'subject_not_found' ? t(`productEditor.save.reason.${field.replace(':', '.')}`) : t(`productEditor.save.reason.${reason}`);
        } else if (reason === 'subject_not_found') gone.push(field);
        else errors[field] = t(`productEditor.save.reason.${reason}`);
      }
      if (gone.length > 0) dispatch({ type: 'dropPaths', paths: gone });
      if (download && Object.keys(errors).length === 0) {
        // The download rules have no field in the editor (virtual products, feature 002).
        setFormError({ kind: 'message', text: t('productEditor.save.error.download') });
        return;
      }
      if (Object.keys(errors).length > 0) {
        dispatch({ type: 'errors', errors });
        setFormError({ kind: 'validation', count: Object.keys(errors).length });
        const first = Object.keys(errors)[0]!;
        setTimeout(() => document.getElementById(fieldDomId(first))?.focus(), 0);
      } else {
        setFormError({ kind: 'message', text: t('productEditor.save.error.subjectGone') });
      }
      return;
    }
    setFormError({ kind: 'message', text: e.message });
  }

  const reloadDiscarding = (): void => {
    dispatch({ type: 'discard' });
    // The reload discards every change on the page, the panels' too (spec § Edge cases).
    sessionRef.current.discardAll();
    setFormError(null);
    // The Reload button goes with the alert: focus the panel the fresh values are in.
    void load(stateRef.current.scope, { note: t('productEditor.save.reloaded') }).then(() =>
      document.getElementById('product-tabpanel')?.focus(),
    );
  };

  // The copy dialog's conflict reloads through the same path as Save's (a stable handle for the context).
  const reloadDiscardingRef = useRef(reloadDiscarding);
  reloadDiscardingRef.current = reloadDiscarding;

  const dropSeoChanges = (): void => {
    dispatch({ type: 'dropPaths', paths: [...stateRef.current.staged.keys()].filter((p) => p.startsWith('seo:')) });
    setFormError(null);
    announce(t('productEditor.save.seoDropped'));
  };

  // --- Guard -------------------------------------------------------------------------------
  const proceed = (g: Guard): void => {
    setGuard(null);
    if (g.kind === 'leave') {
      navigate('/catalog/products');
      return;
    }
    if (g.kind === 'url') {
      skipGuardRef.current = false;
      void load(g.target, { field: searchParams.get('field') });
      return;
    }
    go(g.target, g.note, g.field, g.tab);
  };
  const stay = (g: Guard): void => {
    setGuard(null);
    // Back / Forward moved the URL: put the current scope back (§11, Stay re-pushes the URL).
    if (g.kind === 'url') setSearchParams((prev) => searchWithScope(prev, stateRef.current.scope));
  };

  // --- Whole-product actions (each applies at once, at every scope) -------------------------
  const handleDelete = async (): Promise<void> => {
    if (deleting) return;
    setDeleting(true);
    setWholeProductError(null);
    try {
      await apiClient.delete<void>(PRODUCT_PATH(productId));
      navigate('/catalog/products');
    } catch (err) {
      setWholeProductError(withServerDetail(t('productEditor.error.delete'), err));
    } finally {
      setDeleting(false);
    }
  };
  /** FR-119: the copy takes every scope except status and URL keys; the dialog says so. */
  const handleDuplicate = async (): Promise<void> => {
    if (duplicating) return;
    setDuplicating(true);
    setWholeProductError(null);
    try {
      const res = await apiClient.post<{ data: { id: string } }>(`${PRODUCT_PATH(productId)}/duplicate`, {});
      navigate(`/catalog/products/${res.data.id}`);
    } catch (err) {
      setWholeProductError(withServerDetail(t('productEditor.error.duplicate'), err));
    } finally {
      setDuplicating(false);
    }
  };
  // The dialog a Product menu item asked for, opened once the menu has handed focus back to its
  // trigger (`onCloseAutoFocus`), so the dialog's focus trap starts from the trigger and returns
  // there. A bare `setTimeout` raced the menu's own focus return on a slow machine.
  const pendingWholeProductDialog = useRef<'duplicate' | 'delete' | 'archive' | null>(null);
  const openWholeProductDialog = (kind: 'duplicate' | 'delete' | 'archive'): void => {
    setWholeProductError(null);
    setArchiveError(null);
    pendingWholeProductDialog.current = kind;
  };
  const afterProductMenuClosed = (): void => {
    const kind = pendingWholeProductDialog.current;
    pendingWholeProductDialog.current = null;
    if (kind === null) return;
    // The menu focuses its trigger right after this handler returns.
    setTimeout(() => {
      if (kind === 'archive') setArchiveDialog('archive');
      else setWholeProductDialog(kind);
    }, 0);
  };
  const handleArchiveAction = async (): Promise<void> => {
    if (archiveDialog === null || archiving) return;
    setArchiving(true);
    setArchiveError(null);
    archiveDialogFinalFocus.current = null;
    wholeStatus.clear();
    try {
      const res = await apiClient.post<{ data: { archivedAt?: string | null } }>(`${PRODUCT_PATH(productId)}/${archiveDialog}`, {});
      // Restore unmounts its own button with the archived state; focus lands on the Product menu,
      // beside which the result is said.
      archiveDialogFinalFocus.current = archiveDialog === 'restore' ? productMenuRef.current : null;
      setArchivedOverride(res.data.archivedAt ?? null);
      wholeStatus.show(t(archiveDialog === 'archive' ? 'productEditor.archive.done' : 'productEditor.restore.done'));
      setArchiveDialog(null);
    } catch (err) {
      setArchiveError(
        withServerDetail(t(archiveDialog === 'archive' ? 'productEditor.archive.failed' : 'productEditor.restore.failed'), err),
      );
    } finally {
      setArchiving(false);
    }
  };

  // --- Tabs ------------------------------------------------------------------------------------
  const data = state.data;
  const type = data?.product.type ?? null;
  const tabLabel = (id: TabId): string =>
    id === 'composite' ? t(type === 'grouped' ? 'productEditor.tab.grouped' : 'productEditor.tab.bundle') : t(`productEditor.tab.${id}`);
  const visibleTabs = TAB_IDS.filter((id) => {
    if (id === 'variants') return type === 'configurable';
    if (id === 'composite') return type === 'grouped' || type === 'bundle';
    if (id === 'channels') return channelContributions.length > 0;
    if (id === 'seo') return seoContributions.length > 0;
    return true;
  });
  const requestedTab = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    requestedTab && (TAB_IDS as readonly string[]).includes(requestedTab) && (visibleTabs.includes(requestedTab) || type === null)
      ? requestedTab
      : 'details';
  // The kit's `RecordTabs` owns the keyboard model and moves focus (issue #1445).
  const selectTab = (id: TabId): void => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.set('tab', id);
        sp.delete('field');
        return sp;
      },
      { replace: true },
    );
  };

  const missingText = useCallback(
    (fieldPath: string): string | undefined => {
      const c = state.data?.completeness;
      if (!c || c.level !== 'channel_language') return undefined;
      return (c.missing as string[]).includes(fieldPath)
        ? t('productEditor.completeness.missingHere', { scope: scopeInWords(state.scope, state.data!.validScopes, t, adminLanguage) })
        : undefined;
    },
    [state.data, state.scope, t, adminLanguage],
  );

  // --- Completeness summary (§9, FR-097), from saved values -------------------------------
  const fieldLabel = (path: string): string => {
    if (path === 'name') return t('productEditor.field.name');
    if (path === 'urlKey') return t('productEditor.field.urlKey');
    const key = path.replace(/^attribute:/, '');
    const attr = state.data?.attributes.find((a) => a.key === key);
    const label = attr ? (Object.entries(attr.label).find(([code]) => code.split('-')[0] === adminLanguage)?.[1] ?? Object.values(attr.label)[0]) : undefined;
    return label ?? key;
  };
  const fieldHref = (path: string): string => {
    const sp = new URLSearchParams(searchParams);
    sp.set('tab', path.startsWith('attribute:') ? 'attributes' : 'details');
    sp.set('field', path);
    return `?${sp.toString()}`;
  };
  const openField = (path: string): void => {
    const tab: TabId = path.startsWith('attribute:') ? 'attributes' : 'details';
    selectTab(tab);
    setTimeout(() => document.getElementById(fieldDomId(path))?.focus(), 0);
  };
  const completenessNode = ((): ReactNode => {
    const c = state.data?.completeness;
    if (!c || !state.data) return null;
    const linkClass = 'text-primary underline underline-offset-2 max-lg:inline-flex max-lg:min-h-11 max-lg:items-center';
    const fieldLink = (path: string, text: string): ReactNode => (
      <a
        key={path}
        href={fieldHref(path)}
        data-own-unsaved-guard=""
        className={linkClass}
        onClick={(e): void => {
          e.preventDefault();
          openField(path);
        }}
      >
        {text}
      </a>
    );
    const joined = (items: ReactNode[]): ReactNode[] => items.flatMap((item, i) => (i === 0 ? [item] : [', ', item]));
    let body: ReactNode = null;
    if (c.level === 'channel_language' && c.missing.length > 0) {
      body = (
        <>
          {t('productEditor.completeness.here')} {joined(c.missing.map((m) => fieldLink(m, fieldLabel(m))))}
        </>
      );
    } else if (c.level === 'channel' && c.missing.length > 0) {
      const channelId = state.scope.level === 'global' ? null : state.scope.channelId;
      body = (
        <>
          {t('productEditor.completeness.channel')}{' '}
          {joined(
            c.missing.map((m) =>
              fieldLink(
                m.field,
                t('productEditor.completeness.fieldLanguages', {
                  field: fieldLabel(m.field),
                  languages: m.languages.map((code) => languageName(state.data!.validScopes, channelId, code, adminLanguage)).join(', '),
                }),
              ),
            ),
          )}
        </>
      );
    } else if (c.level === 'global' && c.incompleteScopes > 0) {
      body = (
        <>
          {plural('productEditor.completeness.global', c.incompleteScopes)} —{' '}
          <a
            href={`?${(() => {
              const sp = new URLSearchParams(searchParams);
              sp.set('tab', 'scopes');
              return sp.toString();
            })()}`}
            className={linkClass}
            data-own-unsaved-guard=""
            onClick={(e): void => {
              e.preventDefault();
              selectTab('scopes');
            }}
          >
            {t('productEditor.scope.scopeMap')}
          </a>
        </>
      );
    }
    if (!body) return null;
    return (
      <p className="m-0 inline-flex flex-wrap items-center gap-x-1 text-destructive" data-testid="completeness-summary">
        <span className="sr-only">{t('productEditor.completeness.region')}: </span>
        {body}
      </p>
    );
  })();

  const contextValue = useMemo<ProductEditorContextValue>(
    () => ({
      productId,
      state,
      dispatch,
      readOnly,
      scopeLabel,
      parentScopeLabel: parentLabel,
      jumpTo: (scope, field) => requestScope(scope, undefined, field),
      refreshFamily,
      missingText,
      afterCopy,
      reloadDiscarding: () => reloadDiscardingRef.current(),
      saveSession: session.handle,
    }),
    [productId, state, readOnly, scopeLabel, parentLabel, requestScope, refreshFamily, missingText, afterCopy, session.handle],
  );

  const archivedAt = archivedOverride !== undefined ? archivedOverride : (data?.product.archivedAt ?? null);
  const status = data?.fields.status;
  const statusValue = (status?.value ?? 'inactive') as 'active' | 'inactive';
  const statusSource =
    !status || state.scope.level === 'global' || status.source === 'set' || status.source === 'set_empty'
      ? null
      : status.source === 'inherited_channel'
        ? t('productEditor.statusSource.from', { scope: parentLabel })
        : t('productEditor.statusSource.from', { scope: t('productEditor.scope.global') });
  const title = data?.fields.name.value || data?.product.sku || '';
  const stagedCount = totalUnsaved;
  const atGlobal = state.scope.level === 'global';

  const globalOnlyNotice = (
    <Alert className="mb-4" data-testid="global-only-tab-notice">
      <Lock className="size-4" aria-hidden="true" />
      <AlertDescription>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-1">{t('productEditor.globalOnlyTab.body', { scope: words(state.scope) })}</span>
          {!readOnly ? (
            <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={(): void => requestScope(GLOBAL)}>
              {t('productEditor.globalOnlyTab.editAtGlobal')}
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );

  const seoStaged = new Map<string, ScopedWriteOp<string>>();
  for (const [path, op] of state.staged) if (path.startsWith('seo:')) seoStaged.set(path.slice(4), op as ScopedWriteOp<string>);
  const seoErrors: Record<string, string> = {};
  for (const [path, message] of Object.entries(state.errors)) if (path.startsWith('seo:')) seoErrors[path.slice(4)] = message;

  const panel = (): ReactNode => {
    if (!data && loadError) {
      return (
        <div className="flex flex-col items-start gap-3 py-6" data-testid="editor-load-error">
          <p role="alert" className="m-0 text-sm text-destructive">
            {loadError}
          </p>
          <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={(): void => void load(state.scope)}>
            <RotateCw size={14} aria-hidden="true" /> {t('productEditor.error.retry')}
          </Button>
        </div>
      );
    }
    if (!data) {
      return (
        <div className="space-y-3" data-testid="editor-skeleton">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
          ))}
        </div>
      );
    }
    // Global-only tabs outside Global: the notice, then the content read-only (FR-081). The
    // zone-backed tabs (Pricing, Channels) belong to their contributors, which take no read-only
    // flag, so they show the notice alone.
    const structuralReadOnly = readOnly || !atGlobal;
    if (GLOBAL_ONLY_TABS.has(activeTab) && !atGlobal && (activeTab === 'pricing' || activeTab === 'channels')) return globalOnlyNotice;
    const notice = GLOBAL_ONLY_TABS.has(activeTab) && !atGlobal ? globalOnlyNotice : null;
    switch (activeTab) {
      case 'details':
        return (
          <DetailsTab
            attributeSets={attributeSets}
            categories={categories}
            categoriesLoading={categoriesLoading}
            referenceError={referenceError}
            onRetryReference={loadReference}
          />
        );
      case 'attributes':
        return <ProductAttributesTab />;
      case 'pricing':
        return (
          // FR-024: the Pricing tab saves with the one Save; a contributor that still applies
          // immediately labels its own section. No heading of the editor's own: it repeated the
          // tab's name above the contributors' `h2` sections (#1488, and CAT-11's duplicate).
          <div className="space-y-(--section-gap)">
            <AdminZone name="product.editor.pricing.before" props={{ productId, saveSession: session.handle }} />
            <AdminZone name="product.editor.pricing.after" props={{ productId, saveSession: session.handle }} />
          </div>
        );
      case 'variants':
        return (
          <>
            {notice}
            <ProductVariantsSection productId={productId} readOnly={structuralReadOnly} />
          </>
        );
      case 'composite':
        return (
          <>
            {notice}
            {type === 'grouped' ? (
              <GroupedItemsSection productId={productId} readOnly={structuralReadOnly} />
            ) : (
              <BundleSlotsSection productId={productId} readOnly={structuralReadOnly} />
            )}
          </>
        );
      case 'media':
        return (
          <>
            <AdminZone name="product.editor.field.after" props={{ productId, fieldPath: 'gallery', scope: state.scope, languageCodes: null, saveSession: session.handle }} />
            <GallerySection />
          </>
        );
      case 'inventory':
        return (
          // Issue #1488 (CAT-06): one card per tab, its sections inside it, a rule between them.
          // Feature 180 (FR-025): the product-row settings save with the one Save; only the
          // per-warehouse table applies immediately, and its section carries the badge.
          <div className="space-y-(--section-gap)">
            {atGlobal ? null : globalOnlyNotice}
            {structuralReadOnly ? (
              // Stock outside Global (or without catalog:write) is shown, not edited: the panel
              // has no read-only mode of its own, so its controls are disabled as a group.
              <fieldset disabled className="m-0 min-w-0 space-y-(--section-gap) border-0 p-0" data-testid="stock-read-only">
                <ProductInventoryTab productId={productId} editable={false} />
              </fieldset>
            ) : (
              <ProductInventoryTab productId={productId} />
            )}
            <ProductOrderRulesCard productType={type ?? 'simple'} />
            {type === 'simple' || type === 'configurable' ? (
              <PackagingUnitsEditor
                productId={productId}
                canWrite={canWrite}
                atGlobal={atGlobal}
                onChanged={(): Promise<void> => refreshFamily('packagingUnits')}
                renderName={(unit): ReactNode => (
                  <EditorField<string>
                    fieldPath={`packagingUnit:${unit.id}:name`}
                    label={t('packagingUnits.nameFor', { quantity: String(unit.baseQuantity) })}
                    textField
                    render={(p): ReactNode => <TextControl {...p} maxLength={160} />}
                  />
                )}
              />
            ) : null}
          </div>
        );
      case 'attachments':
        return (
          <>
            <AdminZone name="product.editor.field.after" props={{ productId, fieldPath: 'attachments', scope: state.scope, languageCodes: null, saveSession: session.handle }} />
            <AttachmentsSection />
          </>
        );
      case 'links':
        return (
          <>
            {notice}
            <ProductLinksSection productId={productId} readOnly={structuralReadOnly} />
          </>
        );
      case 'channels':
        return (
          // The contribution is the tab's section, with its own heading and "Applies immediately"
          // badge (#1488): a heading here repeated the tab's name above it.
          <AdminZone name="product.editor.channels" props={{ productId, saveSession: session.handle }} />
        );
      case 'scopes':
        return (
          <ProductScopeOverview
            productId={productId}
            links={{
              href: (scope, field): string => {
                const sp = searchWithScope(searchParams, scope);
                sp.set('tab', tabOfField(field));
                sp.delete('field');
                if (field) sp.set('field', field);
                return `?${sp.toString()}`;
              },
              open: (scope, field): void => requestScope(scope, undefined, field, tabOfField(field)),
              words: (scope): string => scopeShortWords(scope, valid, t, adminLanguage),
            }}
          />
        );
      case 'seo':
        return (
          <AdminZone
            name="product.editor.seo"
            props={{
              productId,
              scope: state.scope,
              scopeLabel,
              parentScopeLabel: atGlobal ? null : parentLabel,
              view: data.seo,
              staged: seoStaged,
              onStage: (field: string, op: ScopedWriteOp<string> | undefined): void =>
                dispatch({ type: 'stage', path: `seo:${field}`, op }),
              readOnly,
              errors: seoErrors,
              version: state.version,
            }}
          />
        );
    }
  };

  /**
   * The summary speaks for the parts the editor's own alert does not (`product-editor-save-ui.md`
   * §2): a refusal or failure of the host part alone keeps 174's messages; a part of a panel, or a
   * partial save, is listed part by part.
   */
  function showSummary(outcome: SaveOutcome | null): boolean {
    if (outcome === null || outcome.result === 'saved') return false;
    return outcome.result === 'partial' || outcome.parts.some((part) => part.id !== 'host' && part.result !== 'saved' && part.result !== 'not-attempted');
  }
  /** "Show": the part's tab, then its first marked field. */
  const showPart = (partId: string): void => {
    const tab = partId === 'host' ? activeTab : tabOfZone(session.zoneOf(partId));
    selectTab(tab);
    setTimeout(() => {
      const panel = document.getElementById('product-tabpanel');
      const first = panel?.querySelector<HTMLElement>('[aria-invalid="true"]');
      (first ?? panel)?.focus();
    }, 0);
  };

  const guardOpen = guard !== null;
  return (
    <ProductEditorContextProvider value={contextValue}>
      <div className="b2b-page b2b-page--wide">
        <PageHeader
          back={{
            label: t('productEditor.back'),
            to: '/catalog/products',
            onClick: (event): void => {
              // Unsaved edits: ask first (Save / Discard / Stay) instead of leaving.
              if (hasUnsaved()) {
                event.preventDefault();
                setGuard({ kind: 'leave' });
              }
            },
          }}
          title={title}
          titleActions={
            data || statusSource || archivedAt ? (
              <span className="flex flex-wrap items-center gap-2">
                {data ? <ProductStatusPill status={statusValue} archived={Boolean(archivedAt)} /> : null}
                {statusSource ? <span className="text-xs text-muted-foreground">{statusSource}</span> : null}
                {archivedAt ? <ArchivedPill /> : null}
              </span>
            ) : undefined
          }
          description={
            data ? (
              <>
                <span className="font-mono">{data.product.sku}</span> · <span>{t(`productEditor.type.${data.product.type}`)}</span>
              </>
            ) : undefined
          }
          actions={
            canWrite ? (
            <div className="flex items-start gap-2">
              {/* "Archived" / "Restored" — the dialog that asked is gone. */}
              <InlineStatus {...wholeStatus.props} className="self-center" data-testid="product-whole-status" />
              {/* Issue #1509 (CAT-09): an archived product says so in the header — the Archived
                  pill beside the title, and Restore here, the one way back — instead of a warning
                  banner between the header and the tabs. The banner's sentence describes it. */}
              {archivedAt ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="max-lg:min-h-11"
                    aria-describedby="product-archived-hint"
                    onClick={(): void => {
                      setArchiveError(null);
                      setArchiveDialog('restore');
                    }}
                  >
                    <ArchiveRestore aria-hidden="true" /> {t('productEditor.action.restore')}
                  </Button>
                  <span id="product-archived-hint" className="sr-only">
                    {t('productEditor.archived.title')} {t('productEditor.archived.body')}
                  </span>
                </>
              ) : null}
              {/* The whole-product actions (FR-084, §11): one menu, captioned; each applies at once. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/* Issue #1492 (CAT-17): the kit button, one look with the tabs' Save below it. */}
                  <Button
                    ref={productMenuRef}
                    type="button"
                    variant="outline"
                    className="max-lg:min-h-11"
                    aria-describedby="product-whole-caption"
                    disabled={!data}
                  >
                    {t('productEditor.wholeProduct.menu')} <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" aria-labelledby="product-whole-caption" onCloseAutoFocus={afterProductMenuClosed}>
                  <p aria-hidden="true" className="m-0 px-2 py-1.5 text-xs text-muted-foreground">
                    {t('productEditor.wholeProduct.caption')}
                  </p>
                  <DropdownMenuItem className="max-lg:min-h-11" onSelect={(): void => openWholeProductDialog('duplicate')}>
                    <Copy size={14} aria-hidden="true" /> {t('productEditor.action.duplicate')}
                  </DropdownMenuItem>
                  {!archivedAt ? (
                    <DropdownMenuItem className="max-lg:min-h-11" onSelect={(): void => openWholeProductDialog('archive')}>
                      <Archive size={14} aria-hidden="true" /> {t('productEditor.action.archive')}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="max-lg:min-h-11" destructive onSelect={(): void => openWholeProductDialog('delete')}>
                    <Trash2 size={14} aria-hidden="true" /> {t('productEditor.action.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span id="product-whole-caption" className="sr-only">
                {t('productEditor.wholeProduct.caption')}
              </span>
            </div>
          ) : null
          }
        />

        <ProductScopeBar
          scope={state.scope}
          validScopes={state.data?.validScopes ?? validRef.current}
          scopeWords={words(state.scope)}
          readOnly={readOnly}
          adminLanguage={adminLanguage}
          onRequestScope={(next, note): void => requestScope(next, note)}
          onOpenScopeMap={(): void => selectTab('scopes')}
          completeness={completenessNode}
          action={
            // OQ-6 = A (FR-035): shown when the operator may write the product or any panel.
            canWrite || session.hasWritableParticipant ? (
              <ProductEditorSaveAction
                stagedCount={stagedCount}
                saving={saving || session.saving}
                ready={Boolean(data)}
                scopeWords={words(state.scope)}
                status={saveStatus.props}
                onSave={(): void => void save()}
              />
            ) : null
          }
        />

        <p role="status" className="sr-only" data-testid="editor-announcer">
          {announcement}
        </p>

        {formError ? (
            <Alert variant="destructive" className="mb-4" data-testid="product-save-error" id="product-save-error" tabIndex={-1}>
              <AlertDescription>
                {formError.kind === 'validation' ? (
                  plural('productEditor.save.error.fields', formError.count)
                ) : formError.kind === 'conflict' ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex-1">{t('productEditor.save.error.conflict')}</span>
                    <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={reloadDiscarding}>
                      {t('productEditor.save.reloadDiscarding')}
                    </Button>
                  </div>
                ) : formError.kind === 'seo' ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex-1">{t('productEditor.save.error.seoOff')}</span>
                    <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={dropSeoChanges}>
                      {t('productEditor.save.removeSeoChanges')}
                    </Button>
                  </div>
                ) : (
                  formError.text
                )}
              </AlertDescription>
            </Alert>
          ) : null}
        {showSummary(session.lastOutcome) || session.notices.length > 0 ? (
          <div className="mb-4" data-testid="product-save-summary">
            <SaveSessionSummary
              outcome={showSummary(session.lastOutcome) ? session.lastOutcome : null}
              notices={session.notices}
              onShow={showPart}
            />
          </div>
        ) : null}
        <div role="status">
          {gateWarning ? (
            <Alert variant="warning" role="none" className="mb-4" data-testid="product-gate-warning">
              <AlertDescription>{gateWarning}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <RecordTabs
          items={visibleTabs.map((id) => ({ value: id, label: tabLabel(id) }))}
          value={activeTab}
          onValueChange={selectTab}
          idBase="product"
          aria-label={t('productEditor.tabs.label')}
          // `-1`: Reload and "Show" focus the panel programmatically; the tabs are the stop.
          panelProps={{ 'aria-busy': state.busy && !loadError, tabIndex: -1 }}
        >
          {panel()}
        </RecordTabs>

        {guardOpen && guard ? (
          <ModalDialog
            title={t('productEditor.guard.title', { scope: words(state.scope) })}
            onClose={(): void => stay(guard)}
            busy={saving}
            dismissOnScrim={false}
            aria-describedby="product-guard-body"
            footer={
              <>
                <Button type="button" variant="outline" disabled={saving} onClick={(): void => stay(guard)}>
                  {t('productEditor.guard.stay')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={(): void => {
                    dispatch({ type: 'discard' });
                    session.discardAll();
                    proceed(guard);
                  }}
                >
                  {t('productEditor.guard.discard')}
                </Button>
                <Button
                  type="button"
                  disabled={saving}
                  aria-busy={saving || undefined}
                  onClick={(): void => {
                    void save().then((ok) => {
                      if (ok) {
                        proceed(guard);
                        return;
                      }
                      setGuard(null);
                      // The summary focuses itself when it has something to say; else the form error.
                      setTimeout(() => {
                        if (!document.querySelector('[data-testid="product-save-summary"]')) document.getElementById('product-save-error')?.focus();
                      }, 0);
                    });
                  }}
                >
                  {t('productEditor.guard.save')}
                </Button>
              </>
            }
          >
            <p id="product-guard-body" className="text-sm">
              {plural(guard.kind === 'leave' ? 'productEditor.guard.bodyLeave' : 'productEditor.guard.body', stagedCount)}
            </p>
          </ModalDialog>
        ) : null}

        {takeovers ? (
          <ModalDialog
            title={t('productEditor.urlKeys.takeover.title')}
            busy={saving}
            onClose={(): void => setTakeovers(null)}
            footer={
              <>
                <Button type="button" variant="outline" disabled={saving} onClick={(): void => setTakeovers(null)}>
                  {t('productEditor.urlKeys.cancel')}
                </Button>
                <Button type="button" disabled={saving} onClick={(): void => void save(takeovers.map((k) => k.key))}>
                  {t('productEditor.urlKeys.takeover.confirm')}
                </Button>
              </>
            }
          >
            <p className="text-sm">{t('productEditor.urlKeys.takeover.body')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {takeovers.map((k) => (
                <li key={`${k.languageCode ?? ''}|${k.key}`}>
                  {t('productEditor.urlKeys.takeover.item', {
                    product: k.losingProductName,
                    key: describeKeyInLanguage(k.key, k.languageCode, t),
                  })}
                </li>
              ))}
            </ul>
          </ModalDialog>
        ) : null}

        {wholeProductDialog !== null ? (
          <ModalDialog
            title={t(wholeProductDialog === 'duplicate' ? 'productEditor.duplicateTitle' : 'productEditor.deleteTitle', { product: title })}
            onClose={(): void => setWholeProductDialog(null)}
            busy={duplicating || deleting}
            aria-describedby="product-whole-confirm-body"
            footer={
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={duplicating || deleting}
                  onClick={(): void => setWholeProductDialog(null)}
                >
                  {t('productEditor.archive.cancel')}
                </Button>
                <Button
                  type="button"
                  variant={wholeProductDialog === 'delete' ? 'destructive' : 'default'}
                  disabled={duplicating || deleting}
                  aria-busy={duplicating || deleting || undefined}
                  onClick={(): void => void (wholeProductDialog === 'duplicate' ? handleDuplicate() : handleDelete())}
                >
                  {wholeProductDialog === 'duplicate'
                    ? duplicating
                      ? t('productEditor.action.duplicating')
                      : t('productEditor.duplicateAction')
                    : t('productEditor.deleteAction')}
                </Button>
              </>
            }
          >
            <p id="product-whole-confirm-body" className="text-sm">
              {t(wholeProductDialog === 'duplicate' ? 'productEditor.duplicateConfirm' : 'productEditor.deleteConfirm')}
              {stagedCount > 0
                ? ` ${t(wholeProductDialog === 'duplicate' ? 'productEditor.duplicateUnsaved' : 'productEditor.deleteUnsaved')}`
                : null}
            </p>
            {wholeProductError ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {wholeProductError}
              </p>
            ) : null}
          </ModalDialog>
        ) : null}

        {archiveDialog !== null ? (
          <ModalDialog
            title={t(archiveDialog === 'archive' ? 'productEditor.archive.confirmTitle' : 'productEditor.restore.confirmTitle')}
            onClose={(): void => setArchiveDialog(null)}
            busy={archiving}
            finalFocusRef={archiveDialogFinalFocus}
            aria-describedby="product-archive-confirm-body"
            footer={
              <>
                <Button type="button" variant="outline" disabled={archiving} onClick={(): void => setArchiveDialog(null)}>
                  {t('productEditor.archive.cancel')}
                </Button>
                <Button type="button" disabled={archiving} aria-busy={archiving || undefined} onClick={(): void => void handleArchiveAction()}>
                  {t(archiveDialog === 'archive' ? 'productEditor.archive.confirm' : 'productEditor.restore.confirm')}
                </Button>
              </>
            }
          >
            <p id="product-archive-confirm-body" className="text-sm">
              {t(archiveDialog === 'archive' ? 'productEditor.archive.confirmBody' : 'productEditor.restore.confirmBody')}
            </p>
            {archiveError ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {archiveError}
              </p>
            ) : null}
          </ModalDialog>
        ) : null}
      </div>
    </ProductEditorContextProvider>
  );
}


// ---------------------------------------------------------------------------
// Product Links section (T109, US4) — Related / Up-sell / Cross-sell.
// Three sub-lists, one product picker (paste id) + kind selector +
// "Add" button per kind. Backend bulkCreate is all-or-nothing and
// surfaces SELF_LINK_NOT_ALLOWED / LINK_ALREADY_EXISTS / TARGET_NOT_FOUND.
// ---------------------------------------------------------------------------

const LINK_KINDS = ['related', 'up_sell', 'cross_sell'] as const;
type LinkKind = (typeof LINK_KINDS)[number];

interface AdminProductLink {
  id: string;
  sourceProductId: string;
  targetProductId: string;
  kind: LinkKind;
  position: number;
}

interface AdminProductSummary {
  id: string;
  sku: string;
  slug: string;
  status: 'active' | 'inactive';
  archivedAt?: string | null;
  /** Feature 174 — the Global name, one string (`contracts/readers.md` §2). */
  name: string;
}

function pickProductName(name: string | undefined | null, fallback: string): string {
  return typeof name === 'string' && name !== '' ? name : fallback;
}

const TARGETS_BATCH_PAGE_SIZE = 200;

function ProductLinksSection({ productId, readOnly = false }: { productId: string; readOnly?: boolean }): ReactNode {
  const t = useTranslation('catalog');
  const { ask, dialog: removalDialog } = useConfirmRemoval();
  const [links, setLinks] = useState<AdminProductLink[]>([]);
  const [targetsById, setTargetsById] = useState<Map<string, AdminProductSummary>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Issue #1509 (CAT-09): an add/remove result is said in the panel header's polite region,
  // mounted before it has text, not as an Alert above the panel's content.
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  /** Each action starts clean: the last result and the last refusal both go. */
  const begin = useCallback((): void => {
    setError(null);
    clearStatus();
  }, [clearStatus]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminProductLink[] }>(
        `/api/v1/admin/catalog/products/${productId}/links`,
      );
      setLinks(res.data);

      // Fetch target product details across all three kinds in one shot.
      // Paginates with TARGETS_BATCH_PAGE_SIZE so a product with hundreds
      // of links streams across multiple requests without ballooning the
      // body. In practice a single page is enough.
      const uniqueTargetIds = Array.from(new Set(res.data.map((l) => l.targetProductId)));
      const nextById = new Map<string, AdminProductSummary>();
      if (uniqueTargetIds.length > 0) {
        let page = 0;
        // Bounded loop guards against an unexpected backend response that
        // never sets `hasMore: false`.
        for (;;) {
          const batch = await apiClient.post<{
            data: AdminProductSummary[];
            pagination: { hasMore: boolean };
          }>('/api/v1/admin/catalog/products/batch-by-id', {
            ids: uniqueTargetIds,
            page,
            pageSize: TARGETS_BATCH_PAGE_SIZE,
          });
          for (const p of batch.data) nextById.set(p.id, p);
          if (!batch.pagination.hasMore) break;
          page += 1;
          if (page > 50) break;
        }
      }
      setTargetsById(nextById);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.links.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: { targetProductId: string; kind: LinkKind }): Promise<void> => {
      begin();
      try {
        await apiClient.post(`/api/v1/admin/catalog/products/${productId}/links`, {
          links: [{ targetProductId: input.targetProductId, kind: input.kind }],
        });
        showStatus(t('productEditor.links.success.add', { kind: t(`productEditor.links.kind.${input.kind}`) }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.links.error.add'));
      }
    },
    [productId, refresh, begin, showStatus, t],
  );

  const handleDelete = useCallback(
    async (linkId: string): Promise<void> => {
      if (!(await ask(t('productEditor.links.removeConfirm')))) return;
      begin();
      try {
        await apiClient.delete(`/api/v1/admin/catalog/products/${productId}/links/${linkId}`);
        showStatus(t('productEditor.links.success.remove'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.links.error.delete'));
      }
    },
    [productId, refresh, ask, begin, showStatus, t],
  );

  const byKind = useMemo(() => {
    const result: Record<LinkKind, AdminProductLink[]> = {
      related: [],
      up_sell: [],
      cross_sell: [],
    };
    for (const link of links) result[link.kind].push(link);
    for (const kind of LINK_KINDS) {
      result[kind].sort((a, b) => a.position - b.position);
    }
    return result;
  }, [links]);

  return (
    <EditorSection
      title={sectionTitle(t('productEditor.links.title'), !readOnly)}
      action={<InlineStatus {...statusProps} data-testid="links-panel-status" />}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
      ) : (
        <div className="space-y-(--section-gap)">
          {LINK_KINDS.map((kind) => (
            <EditorSection key={kind} as="h3" title={`${t(`productEditor.links.kind.${kind}`)} (${byKind[kind].length})`}>
              {byKind[kind].length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('productEditor.links.empty')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('productEditor.links.column.target')}</TableHead>
                      <TableHead>{t('productEditor.links.column.sku')}</TableHead>
                      <TableHead>{t('productEditor.links.column.position')}</TableHead>
                      {readOnly ? null : <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.links.column.actions')}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byKind[kind].map((link) => {
                      const target = targetsById.get(link.targetProductId);
                      const isMissing = !target;
                      // `inactive` is plain off; archived is its own fact.
                      const isInactive = target?.status === 'inactive';
                      const isArchived = target?.archivedAt != null;
                      return (
                        <TableRow key={link.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span
                                className={
                                  isMissing || isInactive || isArchived ? 'text-muted-foreground' : ''
                                }
                              >
                                {target
                                  ? pickProductName(target.name, target.slug)
                                  : `${link.targetProductId.slice(0, 8)}…`}
                              </span>
                              {isMissing ? (
                                <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                  {t('productEditor.links.badge.missing')}
                                </span>
                              ) : null}
                              {isInactive ? (
                                <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                  {t('productEditor.links.badge.inactive')}
                                </span>
                              ) : null}
                              {isArchived ? (
                                <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                  {t('productEditor.links.badge.archived')}
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {target?.sku ?? '—'}
                          </TableCell>
                          <TableCell>{link.position}</TableCell>
                          {readOnly ? null : (
                            <TableCell>
                              <RowRemoveButton
                                label={t('productEditor.links.action.removeFor', {
                                  product: target ? pickProductName(target.name, target.slug) : `${link.targetProductId.slice(0, 8)}…`,
                                })}
                                onClick={() => void handleDelete(link.id)}
                              />
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </EditorSection>
          ))}
        </div>
      )}

      {readOnly ? null : <CreateProductLinkInline onCreate={handleCreate} sourceProductId={productId} />}
      {removalDialog}
    </EditorSection>
  );
}

function CreateProductLinkInline({
  onCreate,
  sourceProductId,
}: {
  onCreate: (input: { targetProductId: string; kind: LinkKind }) => Promise<void>;
  sourceProductId: string;
}): ReactNode {
  const t = useTranslation('catalog');
  const [targetProductId, setTargetProductId] = useState<string | null>(null);
  const [kind, setKind] = useState<LinkKind>('related');

  return (
    <div
      className="grid gap-3 md:grid-cols-3 border-t pt-4"
      role="group"
      aria-label={t('productEditor.links.addTitle')}
    >
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="ltarget">{t('productEditor.links.column.target')}</Label>
        <ProductPicker
          id="ltarget"
          mode="select"
          value={targetProductId}
          onChange={setTargetProductId}
          excludeIds={[sourceProductId]}
          placeholder={t('productEditor.links.field.targetPlaceholder')}
          ariaLabel={t('productEditor.links.column.target')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lkind">{t('productEditor.links.field.kind')}</Label>
        <Select id="lkind" value={kind} onChange={(e): void => setKind(e.target.value as LinkKind)}>
          {LINK_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`productEditor.links.kind.${k}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="md:col-span-3">
        <Button
          type="button"
          variant="outline"
          className="max-lg:min-h-11"
          disabled={targetProductId === null}
          onClick={() => {
            if (targetProductId === null) return;
            void onCreate({ targetProductId, kind }).then(() => {
              setTargetProductId(null);
            });
          }}
        >
          <Plus aria-hidden="true" />
          {t('productEditor.links.action.add')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped items section (T136, US5) — admin CRUD for a grouped product's
// children. Service-side enforces parent.type='grouped' (PRODUCT_TYPE_MISMATCH)
// + child.type∉{grouped,bundle} (NESTED_COMPOSITE_NOT_ALLOWED), so the form
// surfaces those errors directly when an admin pastes a bad child id.
// ---------------------------------------------------------------------------

interface AdminGroupedItem {
  id: string;
  parentProductId: string;
  childProductId: string;
  quantity: number;
  position: number;
}

function GroupedItemsSection({ productId, readOnly = false }: { productId: string; readOnly?: boolean }): ReactNode {
  const t = useTranslation('catalog');
  const { ask, dialog: removalDialog } = useConfirmRemoval();
  const [items, setItems] = useState<AdminGroupedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Issue #1509 (CAT-09): an add/remove result is said in the panel header's polite region,
  // mounted before it has text, not as an Alert above the panel's content.
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  /** Each action starts clean: the last result and the last refusal both go. */
  const begin = useCallback((): void => {
    setError(null);
    clearStatus();
  }, [clearStatus]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminGroupedItem[] }>(
        `/api/v1/admin/catalog/products/${productId}/grouped-items`,
      );
      setItems(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.grouped.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: { childProductId: string; quantity: string }): Promise<void> => {
      begin();
      const qty = Number(input.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(t('productEditor.grouped.error.invalidQuantity'));
        return;
      }
      try {
        await apiClient.post(
          `/api/v1/admin/catalog/products/${productId}/grouped-items`,
          { childProductId: input.childProductId, quantity: qty },
        );
        showStatus(t('productEditor.grouped.success.add'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.grouped.error.add'));
      }
    },
    [productId, refresh, begin, showStatus, t],
  );

  const handleDelete = useCallback(
    async (itemId: string): Promise<void> => {
      if (!(await ask(t('productEditor.grouped.removeConfirm')))) return;
      begin();
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/grouped-items/${itemId}`,
        );
        showStatus(t('productEditor.grouped.success.remove'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.grouped.error.delete'));
      }
    },
    [productId, refresh, ask, begin, showStatus, t],
  );

  return (
    <EditorSection
      title={sectionTitle(t('productEditor.grouped.title'), !readOnly)}
      action={<InlineStatus {...statusProps} data-testid="grouped-panel-status" />}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('productEditor.grouped.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('productEditor.grouped.column.child')}</TableHead>
              <TableHead>{t('productEditor.grouped.column.quantity')}</TableHead>
              <TableHead>{t('productEditor.grouped.column.position')}</TableHead>
              {readOnly ? null : <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.grouped.column.actions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-xs">{item.childProductId}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{item.position}</TableCell>
                {readOnly ? null : (
                  <TableCell>
                    <RowRemoveButton
                      label={t('productEditor.grouped.action.removeFor', { product: item.childProductId })}
                      onClick={() => void handleDelete(item.id)}
                    />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {readOnly ? null : <CreateGroupedItemInline onCreate={handleCreate} />}
      {removalDialog}
    </EditorSection>
  );
}

function CreateGroupedItemInline({
  onCreate,
}: {
  onCreate: (input: { childProductId: string; quantity: string }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [childProductId, setChildProductId] = useState('');
  const [quantity, setQuantity] = useState('1');

  return (
    <div
      className="grid gap-3 md:grid-cols-3 border-t pt-4"
      role="group"
      aria-label={t('productEditor.grouped.addTitle')}
    >
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="gchild">{t('productEditor.grouped.column.child')}</Label>
        <ProductPicker
          id="gchild"
          mode="select"
          value={childProductId || null}
          onChange={(v): void => setChildProductId(v ?? '')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="gquantity">{t('productEditor.grouped.column.quantity')}</Label>
        <Input
          id="gquantity"
          type="number"
          min="1"
          value={quantity}
          onChange={(e): void => setQuantity(e.target.value)}
        />
      </div>
      <div className="md:col-span-3">
        <Button
          type="button"
          variant="outline"
          className="max-lg:min-h-11"
          onClick={() => {
            if (!childProductId) return;
            void onCreate({ childProductId, quantity }).then(() => {
              setChildProductId('');
              setQuantity('1');
            });
          }}
        >
          <Plus aria-hidden="true" />
          {t('productEditor.grouped.action.add')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bundle slots section (T137, US5) — admin CRUD for bundle slots and
// their options. Service enforces parent.type='bundle', INVALID_QUANTITY_RANGE
// on min>max, OPTION_ALREADY_EXISTS on duplicate option in a slot,
// NESTED_COMPOSITE_NOT_ALLOWED on grouped/bundle option product.
// ---------------------------------------------------------------------------

interface AdminBundleSlot {
  id: string;
  parentProductId: string;
  name: Record<string, string>;
  minQuantity: number;
  maxQuantity: number;
  position: number;
  options: Array<{
    id: string;
    slotId: string;
    optionProductId: string;
    defaultQuantity: number;
    position: number;
  }>;
}

function BundleSlotsSection({ productId, readOnly = false }: { productId: string; readOnly?: boolean }): ReactNode {
  const t = useTranslation('catalog');
  const { ask, dialog: removalDialog } = useConfirmRemoval();
  const [slots, setSlots] = useState<AdminBundleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Issue #1509 (CAT-09): an add/remove result is said in the panel header's polite region,
  // mounted before it has text, not as an Alert above the panel's content.
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  /** Each action starts clean: the last result and the last refusal both go. */
  const begin = useCallback((): void => {
    setError(null);
    clearStatus();
  }, [clearStatus]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminBundleSlot[] }>(
        `/api/v1/admin/catalog/products/${productId}/bundle-slots`,
      );
      setSlots(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreateSlot = useCallback(
    async (input: { name: string; minQuantity: string; maxQuantity: string }): Promise<void> => {
      begin();
      const min = Number(input.minQuantity);
      const max = Number(input.maxQuantity);
      if (!Number.isFinite(max) || max <= 0) {
        setError(t('productEditor.bundle.error.invalidMax'));
        return;
      }
      try {
        await apiClient.post(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots`,
          {
            name: { 'en-US': input.name },
            ...(Number.isFinite(min) ? { minQuantity: min } : {}),
            maxQuantity: max,
          },
        );
        showStatus(t('productEditor.bundle.success.addSlot', { name: input.name }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.addSlot'));
      }
    },
    [productId, refresh, begin, showStatus, t],
  );

  const handleDeleteSlot = useCallback(
    async (slotId: string): Promise<void> => {
      if (!(await ask(t('productEditor.bundle.removeSlotConfirm')))) return;
      begin();
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots/${slotId}`,
        );
        showStatus(t('productEditor.bundle.success.removeSlot'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.deleteSlot'));
      }
    },
    [productId, refresh, ask, begin, showStatus, t],
  );

  const handleAddOption = useCallback(
    async (slotId: string, optionProductId: string): Promise<void> => {
      if (!optionProductId) return;
      begin();
      try {
        await apiClient.post(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots/${slotId}/options`,
          { optionProductId },
        );
        showStatus(t('productEditor.bundle.success.addOption'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.addOption'));
      }
    },
    [productId, refresh, begin, showStatus, t],
  );

  const handleRemoveOption = useCallback(
    async (slotId: string, optionId: string): Promise<void> => {
      if (!(await ask(t('productEditor.bundle.removeOptionConfirm')))) return;
      begin();
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots/${slotId}/options/${optionId}`,
        );
        showStatus(t('productEditor.bundle.success.removeOption'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.deleteOption'));
      }
    },
    [productId, refresh, ask, begin, showStatus, t],
  );

  return (
    <EditorSection
      title={sectionTitle(t('productEditor.bundle.title'), !readOnly)}
      action={<InlineStatus {...statusProps} data-testid="bundle-panel-status" />}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('productEditor.bundle.empty')}</p>
      ) : (
        // Issue #1488 (CAT-06): the slots are rows divided by a rule, not a box per slot.
        <ul className="divide-y divide-border">
          {slots.map((slot) => (
            <BundleSlotRow
              key={slot.id}
              slot={slot}
              onAddOption={handleAddOption}
              onRemoveOption={handleRemoveOption}
              onDeleteSlot={handleDeleteSlot}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}

      {readOnly ? null : <CreateBundleSlotInline onCreate={handleCreateSlot} />}
      {removalDialog}
    </EditorSection>
  );
}

function BundleSlotRow({
  slot,
  onAddOption,
  onRemoveOption,
  onDeleteSlot,
  readOnly = false,
}: {
  readOnly?: boolean;
  slot: AdminBundleSlot;
  onAddOption: (slotId: string, optionProductId: string) => Promise<void>;
  onRemoveOption: (slotId: string, optionId: string) => Promise<void>;
  onDeleteSlot: (slotId: string) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [optionId, setOptionId] = useState('');
  const slotName = slot.name['en-US'] ?? Object.values(slot.name)[0] ?? '—';

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      {/* Issue #1490 (UX audit CAT-11): a slot is a sub-section of Bundle slots — the kit's
          `EditorSection` at `h3`, the editor's one heading style, not a hand-styled `h3`. The
          list's `divide-y` separates the slots, so the section draws no rule of its own. */}
      <EditorSection
        as="h3"
        divider={false}
        title={
          <>
            {slotName}{' '}
            <span className="text-xs font-normal text-muted-foreground">
              {t('productEditor.bundle.slotMeta', {
                min: slot.minQuantity,
                max: slot.maxQuantity,
                position: slot.position,
              })}
            </span>
          </>
        }
        action={
          readOnly ? null : (
            <RowRemoveButton
              label={t('productEditor.bundle.action.deleteSlotFor', { slot: slotName })}
              onClick={() => void onDeleteSlot(slot.id)}
            />
          )
        }
      >
        <div>
          {slot.options.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('productEditor.bundle.optionsEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('productEditor.bundle.column.optionProductId')}</TableHead>
                  <TableHead>{t('productEditor.bundle.column.defaultQuantity')}</TableHead>
                  <TableHead>{t('productEditor.bundle.column.position')}</TableHead>
                  {readOnly ? null : <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.bundle.column.actions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {slot.options.map((opt) => (
                  <TableRow key={opt.id}>
                    <TableCell className="font-mono text-xs">{opt.optionProductId}</TableCell>
                    <TableCell>{opt.defaultQuantity}</TableCell>
                    <TableCell>{opt.position}</TableCell>
                    {readOnly ? null : (
                      <TableCell>
                        <RowRemoveButton
                          label={t('productEditor.bundle.action.removeOptionFor', { product: opt.optionProductId })}
                          onClick={() => void onRemoveOption(slot.id, opt.id)}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        {readOnly ? null : (
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor={`opt-${slot.id}`}>{t('productEditor.bundle.column.optionProductId')}</Label>
              <ProductPicker
                id={`opt-${slot.id}`}
                mode="select"
                value={optionId || null}
                onChange={(v): void => setOptionId(v ?? '')}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="max-lg:min-h-11"
              onClick={() => {
                void onAddOption(slot.id, optionId).then(() => {
                  setOptionId('');
                });
              }}
            >
              <Plus aria-hidden="true" />
              {t('productEditor.bundle.action.addOption')}
            </Button>
          </div>
        )}
      </EditorSection>
    </li>
  );
}

function CreateBundleSlotInline({
  onCreate,
}: {
  onCreate: (input: { name: string; minQuantity: string; maxQuantity: string }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [name, setName] = useState('');
  const [minQuantity, setMinQuantity] = useState('0');
  const [maxQuantity, setMaxQuantity] = useState('1');

  return (
    <div
      className="grid gap-3 md:grid-cols-4 border-t pt-4"
      role="group"
      aria-label={t('productEditor.bundle.addTitle')}
    >
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="bsname">{t('productEditor.bundle.field.slotName')}</Label>
        <Input
          id="bsname"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder={t('productEditor.bundle.field.slotNamePlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bsmin">{t('productEditor.bundle.field.min')}</Label>
        <Input
          id="bsmin"
          type="number"
          min="0"
          value={minQuantity}
          onChange={(e): void => setMinQuantity(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bsmax">{t('productEditor.bundle.field.max')}</Label>
        <Input
          id="bsmax"
          type="number"
          min="1"
          value={maxQuantity}
          onChange={(e): void => setMaxQuantity(e.target.value)}
        />
      </div>
      <div className="md:col-span-4">
        <Button
          type="button"
          variant="outline"
          className="max-lg:min-h-11"
          onClick={() => {
            if (!name) return;
            void onCreate({ name, minQuantity, maxQuantity }).then(() => {
              setName('');
              setMinQuantity('0');
              setMaxQuantity('1');
            });
          }}
        >
          <Plus aria-hidden="true" />
          {t('productEditor.bundle.action.add')}
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
export default ProductEditor;
