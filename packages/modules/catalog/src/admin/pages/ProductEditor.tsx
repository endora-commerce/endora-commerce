import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  Trash2,
  ChevronLeft,
  Copy,
  Eye,
  FileText as FileTextIcon,
  Globe,
  Image as ImageIcon,
  CircleDollarSign,
  Layers,
  LayoutGrid,
  Link as LinkIcon,
  Paperclip,
  Save,
  SlidersHorizontal,
  Store as StoreIcon,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { ApiError, apiClient, useAuth, useUnsavedChangesPrompt, cn } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { ModalDialog, StickyFormActions, CategoryTreePicker, ProductPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';
import { ProductInventoryTab } from '../components/ProductInventoryTab.js';
import { PackagingUnitsEditor } from '../components/PackagingUnitsEditor.js';
import { ProductOrderRulesCard } from '../components/ProductOrderRulesCard.js';
import { ProductAttributesTab } from '../components/ProductAttributesTab.js';
import { ProductScopeOverview } from '../components/ProductScopeOverview.js';
import { ProductUrlKeysPanel } from '../components/ProductUrlKeysPanel.js';
import { GallerySection, type GallerySectionHandle } from '../components/ProductGallerySection.js';
import { AttachmentsSection } from '../components/ProductAttachmentsSection.js';
import { ArchivedPill, ProductStatusPill } from '../components/ProductStatusPills.js';
import {
  ProductScopeEditor,
  type ProductScopeEditorHandle,
} from '../components/ProductScopeEditor.js';
import { checkWindowInputs, isoToLocalInput } from '../lib/product-scope-drafts.js';
import {
  describeIncompletePair,
  getProductScopes,
  isScopeIncomplete,
  loadChannelNamer,
  scopeSaveErrorMessage,
} from '../lib/product-scopes-api.js';
import type { ScopeWarning } from '@endora-commerce/contracts';

const LOCALES = ['en-US', 'pl-PL'] as const;
type Locale = (typeof LOCALES)[number];

const PRODUCT_TYPES = [
  'simple',
  'configurable',
  'grouped',
  'bundle',
  'virtual',
] as const;
const VISIBILITIES = ['public', 'logged_in_only', 'organization_restricted'] as const;
const STATUSES = ['active', 'inactive'] as const;

/**
 * The tabs `?tab=` may open (review D3: the bulk scoped-status result links to
 * `?tab=scopes`) — those every saved product shows. A type-dependent or zone-counted
 * tab, or an unknown value, opens Details.
 */
const LINKABLE_TABS = new Set([
  'details',
  'attributes',
  'pricing',
  'media',
  'inventory',
  'attachments',
  'links',
  'scopes',
  'seo',
]);

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  type: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
  status: 'active' | 'inactive';
  /**
   * Set by Archive, cleared by Restore, and by nothing else:
   * archived state is independent of `status` at every scope.
   */
  archivedAt?: string | null;
  name: Record<string, string>;
  description: Record<string, string>;
  visibility: 'public' | 'logged_in_only' | 'organization_restricted';
  attributeValues: Record<string, unknown>;
  attributeSetId: string;
  categoryIds?: string[];
}

interface AdminAttributeSet {
  id: string;
  code: string;
  name: Record<string, string>;
  isSystem: boolean;
}

interface AdminCategory {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  slug: string;
  sortOrder: number;
}

/**
 * Order-insensitive JSON snapshot of the editable form fields, used to detect
 * unsaved changes (object keys + array members are sorted so re-ordering alone
 * never reads as a change).
 */
function stableSnapshot(values: Record<string, unknown>): string {
  return JSON.stringify(values, (_key, value) => {
    if (Array.isArray(value)) return [...value].sort();
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    }
    return value;
  });
}

export function ProductEditor(): ReactNode {
  const t = useTranslation('catalog');
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = params.id === 'new';
  const id = isNew ? null : params.id ?? null;

  // Feature 091 / P7a, Z15 — the Channels tab's button is a count of its own
  // body. Declared here rather than beside the tab table because the table is
  // built below an early return and a hook may not be.
  const channelContributions = useAdminZone('product.editor.channels', {
    productId: id ?? '',
  });

  // Archive / Restore write the catalogue (FR-019): an operator without
  // `catalog:write` is not offered either.
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');

  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Feature 163 (US6, G-2) — what the completeness check reported on the last Save.
  const [gateWarning, setGateWarning] = useState<string | null>(null);
  // The product's archived state, read with the product and
  // moved only by the Archive / Restore actions below, never by Save.
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [archiveDialog, setArchiveDialog] = useState<'archive' | 'restore' | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [sku, setSku] = useState('');
  const [type, setType] = useState<'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual'>('simple');
  const [status, setStatus] = useState<'active' | 'inactive'>('inactive');
  const [visibility, setVisibility] = useState<AdminProduct['visibility']>('public');
  const [name, setName] = useState<Record<Locale, string>>({ 'en-US': '', 'pl-PL': '' });
  const [description, setDescription] = useState<Record<Locale, string>>({
    'en-US': '',
    'pl-PL': '',
  });
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(() => {
    const linked = searchParams.get('tab');
    return !isNew && linked !== null && LINKABLE_TABS.has(linked) ? linked : 'details';
  });
  // Feature 002 (T034) — Attribute Set selector
  const [attributeSets, setAttributeSets] = useState<AdminAttributeSet[]>([]);
  const [attributeSetId, setAttributeSetId] = useState<string>('');
  // Feature 172 — the set the product is saved with: content attributes are
  // edited on their own screen against it, not against an unsaved choice.
  const [savedAttributeSetId, setSavedAttributeSetId] = useState<string | undefined>(undefined);
  // Editable attribute values keyed by attribute `key` (Attributes tab).
  const [attrValues, setAttrValues] = useState<Record<string, unknown>>({});
  // Feature 163 (FR-023) — the global publication window, as `datetime-local`
  // values in the operator's zone. `loadedWindow` is what the server holds, so
  // the page PATCH carries the window only when it changed.
  const [publishFrom, setPublishFrom] = useState('');
  const [publishUntil, setPublishUntil] = useState('');
  const [loadedWindow, setLoadedWindow] = useState({ from: '', until: '' });
  const [windowError, setWindowError] = useState<'order' | 'invalidDate' | null>(null);
  // Feature 023 — imperative handle on the scope-editor so the page Save
  // can flush every pending channel-scoped override in a single PATCH.
  const scopeEditorRef = useRef<ProductScopeEditorHandle | null>(null);
  // Media tab — page-Save flushes staged gallery label/order edits via this
  // imperative handle (mirrors the scope-editor pattern above).
  const galleryRef = useRef<GallerySectionHandle | null>(null);

  // Unsaved-changes guard — a stable snapshot of the editable fields is taken
  // on load (and re-taken after each save via refresh()); the form is "dirty"
  // whenever the live values diverge from it.
  const initialSnapshotRef = useRef<string>('');
  const currentSnapshot = stableSnapshot({
    sku,
    type,
    status,
    visibility,
    name,
    description,
    categoryIds,
    attributeSetId,
    attrValues,
    publishFrom,
    publishUntil,
  });
  // Review D4 — the gallery's staged edits are unsaved changes too. The gallery stays
  // mounted once its tab is opened (hidden on the other tabs), so its staging survives a
  // tab switch and the page Save still writes it.
  const [galleryDirty, setGalleryDirty] = useState(false);
  const [galleryOpened, setGalleryOpened] = useState(false);
  useEffect(() => {
    if (activeTab === 'media') setGalleryOpened(true);
  }, [activeTab]);
  const dirty =
    !loading &&
    ((initialSnapshotRef.current !== '' && currentSnapshot !== initialSnapshotRef.current) || galleryDirty);
  useUnsavedChangesPrompt(dirty);

  // Read through a ref so a language switch does not re-load the product (and drop edits).
  const tRef = useRef(t);
  tRef.current = t;
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [cats, sets] = await Promise.all([
        apiClient.get<{ data: AdminCategory[] }>('/api/v1/admin/catalog/categories'),
        apiClient.get<{ data: AdminAttributeSet[] }>(
          '/api/v1/admin/catalog/attribute-sets',
        ),
      ]);
      setCategories(cats.data);
      setAttributeSets(sets.data);
      // Pick the system Default as the initial selection for new Products.
      const defaultSet = sets.data.find((s) => s.code === 'default');
      if (isNew && defaultSet) setAttributeSetId(defaultSet.id);
      if (isNew) {
        // Baseline for a brand-new product matches the useState defaults.
        initialSnapshotRef.current = stableSnapshot({
          sku: '',
          type: 'simple',
          status: 'inactive',
          visibility: 'public',
          name: { 'en-US': '', 'pl-PL': '' },
          description: { 'en-US': '', 'pl-PL': '' },
          categoryIds: [],
          attributeSetId: defaultSet?.id ?? '',
          attrValues: {},
          publishFrom: '',
          publishUntil: '',
        });
      }
      if (id) {
        const res = await apiClient.get<{ data: AdminProduct }>(
          `/api/v1/admin/catalog/products/${id}`,
        );
        const p = res.data;
        setSku(p.sku);
        setType(p.type);
        setStatus(p.status);
        setArchivedAt(p.archivedAt ?? null);
        setVisibility(p.visibility);
        const loadedName = {
          'en-US': p.name['en-US'] ?? '',
          'pl-PL': p.name['pl-PL'] ?? '',
        };
        setName(loadedName);
        const loadedDescription = {
          'en-US': p.description['en-US'] ?? '',
          'pl-PL': p.description['pl-PL'] ?? '',
        };
        setDescription(loadedDescription);
        setAttrValues(p.attributeValues ?? {});
        setAttributeSetId(p.attributeSetId);
        setSavedAttributeSetId(p.attributeSetId);
        setCategoryIds(p.categoryIds ?? []);
        // Feature 163 — the global window is read from the scopes answer (the
        // product answer does not carry it). A failed read leaves the fields
        // empty and unchanged, so nothing is sent for them on save.
        let loadedFrom = '';
        let loadedUntil = '';
        try {
          const scopes = await getProductScopes(id);
          loadedFrom = isoToLocalInput(scopes?.global?.publishFrom ?? null);
          loadedUntil = isoToLocalInput(scopes?.global?.publishUntil ?? null);
        } catch {
          // Best effort — the rest of the editor stays usable.
        }
        setPublishFrom(loadedFrom);
        setPublishUntil(loadedUntil);
        setLoadedWindow({ from: loadedFrom, until: loadedUntil });
        setWindowError(null);
        // Capture the loaded state as the clean baseline for dirty-tracking.
        initialSnapshotRef.current = stableSnapshot({
          sku: p.sku,
          type: p.type,
          status: p.status,
          visibility: p.visibility,
          name: loadedName,
          description: loadedDescription,
          categoryIds: p.categoryIds ?? [],
          attributeSetId: p.attributeSetId,
          attrValues: p.attributeValues ?? {},
          publishFrom: loadedFrom,
          publishUntil: loadedUntil,
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tRef.current('productEditor.error.load'));
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault();
      setError(null);
      setInfo(null);
      setGateWarning(null);
      const trimmedName: Record<string, string> = {};
      const trimmedDescription: Record<string, string> = {};
      for (const l of LOCALES) {
        if (name[l]) trimmedName[l] = name[l];
        if (description[l]) trimmedDescription[l] = description[l];
      }
      if (Object.keys(trimmedName).length === 0) {
        setError(t('productEditor.error.nameRequired'));
        return;
      }
      // The Attributes-tab edits. A product has no price of its own: prices
      // are set in price books (feature 160), so nothing else is added here.
      const attributeValues: Record<string, unknown> = { ...attrValues };
      // Feature 163 (FR-023) — the window travels only when it changed, and
      // a window that does not start before it ends is refused here, beside
      // its fields, without a request.
      let windowPatch: { publishFrom: string | null; publishUntil: string | null } | null = null;
      if (publishFrom !== loadedWindow.from || publishUntil !== loadedWindow.until) {
        const check = checkWindowInputs(publishFrom, publishUntil);
        if (!check.ok) {
          setWindowError(check.reason);
          return;
        }
        windowPatch = { publishFrom: check.from, publishUntil: check.until };
      }
      setWindowError(null);
      try {
        if (isNew) {
          const res = await apiClient.post<{ data: AdminProduct }>(
            '/api/v1/admin/catalog/products',
            {
              sku,
              type,
              // A new product is `inactive` unless the operator chose otherwise
              // (FR-010, Q1-d); the selector's value is sent, not assumed.
              status,
              name: trimmedName,
              description: trimmedDescription,
              categoryIds,
              attributeValues,
              visibility,
              ...(attributeSetId ? { attributeSetId } : {}),
            },
          );
          navigate(`/catalog/products/${res.data.id}`);
        } else if (id) {
          // Feature 023 — page-Save commits the per-language baseline (the product
          // PATCH) and the drafts staged in the ProductScopeEditor panel and the
          // gallery. Feature 163 (US6 #3): the PATCH goes first and alone — when the
          // completeness gate refuses it (`422 SCOPE_INCOMPLETE`) nothing else is
          // written, so "not saved, still in the form" is true of the whole change.
          const saved = await apiClient.patch<{ data: AdminProduct; warnings?: ScopeWarning[] }>(
            `/api/v1/admin/catalog/products/${id}`,
            {
              sku: sku.trim(),
              status,
              name: trimmedName,
              description: trimmedDescription,
              categoryIds,
              attributeValues,
              visibility,
              ...(attributeSetId ? { attributeSetId } : {}),
              ...(windowPatch ?? {}),
            },
          );
          await Promise.all([
            scopeEditorRef.current?.flushOverrides() ?? Promise.resolve(),
            galleryRef.current?.flushGallery() ?? Promise.resolve(),
          ]);
          // The status change was saved; where it switched the product on with values
          // missing (`warn` mode) the page says what, by channel and language — instead
          // of "Saved.", which would read as "nothing left to do".
          const completeness = (saved.warnings ?? []).filter(
            (w): w is Extract<ScopeWarning, { kind: 'completeness' }> => w.kind === 'completeness',
          );
          if (completeness.length > 0) {
            const channelName = await loadChannelNamer(id);
            setGateWarning(
              t('productEditor.scopeControls.warning.incomplete', {
                details: completeness.map((w) => describeIncompletePair(w, channelName, t)).join('; '),
              }),
            );
          } else {
            setInfo(t('productEditor.saved'));
          }
          await refresh();
        }
      } catch (err) {
        if (id && isScopeIncomplete(err)) {
          // `refuse` mode: nothing in this request was saved; the edits stay in the form.
          const channelName = await loadChannelNamer(id);
          setError(
            scopeSaveErrorMessage(
              err,
              channelName,
              t,
              'productEditor.scopeControls.error.generic',
              'productEditor.statusGate.refused',
            ),
          );
          return;
        }
        const windowRefused =
          err instanceof ApiError &&
          (err.envelope.error as { details?: { field?: unknown } }).details?.field === 'window';
        setError(
          windowRefused
            ? t('productEditor.error.publishWindow')
            : err instanceof ApiError
              ? err.envelope.error.message
              : t('productEditor.error.save'),
        );
      }
    },
    [isNew, id, sku, status, type, name, description, categoryIds, attrValues, attributeSetId, visibility, navigate, refresh, publishFrom, publishUntil, loadedWindow, t],
  );

  const handleAttrChange = useCallback((key: string, value: unknown): void => {
    setAttrValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Swapping the Attribute Set drops the values whose keys are not in the
  // newly-selected set, so the save payload doesn't carry orphan keys left
  // over from the previous set.
  const handleAttributeSetChange = useCallback(
    async (newSetId: string): Promise<void> => {
      setAttributeSetId(newSetId);
      if (!newSetId) return;
      try {
        const res = await apiClient.get<{ data: { attributes: { key: string }[] } }>(
          `/api/v1/admin/catalog/attribute-sets/${newSetId}`,
        );
        const allowed = new Set(res.data.attributes.map((a) => a.key));
        setAttrValues((prev) => {
          const next: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(prev)) {
            if (allowed.has(k)) {
              next[k] = v;
            }
          }
          return next;
        });
      } catch {
        // Non-fatal — the backend tolerates round-tripped keys, so leaving
        // the values untouched on a fetch failure still saves correctly.
      }
    },
    [],
  );

  const handleDeleteProduct = useCallback(async (): Promise<void> => {
    if (!id) return;
    if (!confirm(t('productEditor.deleteConfirm'))) return;
    try {
      await apiClient.delete<void>(`/api/v1/admin/catalog/products/${id}`);
      navigate('/catalog/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.error.delete'));
    }
  }, [id, navigate, t]);

  const [duplicating, setDuplicating] = useState(false);
  const handleDuplicate = useCallback(async (): Promise<void> => {
    if (!id || duplicating) return;
    if (!confirm(t('productEditor.duplicateConfirm'))) return;
    setDuplicating(true);
    setError(null);
    try {
      const res = await apiClient.post<{ data: AdminProduct }>(
        `/api/v1/admin/catalog/products/${id}/duplicate`,
        {},
      );
      navigate(`/catalog/products/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.error.duplicate'));
    } finally {
      setDuplicating(false);
    }
  }, [id, duplicating, navigate, t]);

  // Archive / Restore take effect at once, through their own
  // routes; they touch `archivedAt` only, so the form's unsaved edits (status
  // included) are neither sent nor lost.
  const handleArchiveAction = useCallback(async (): Promise<void> => {
    if (!id || archiveDialog === null || archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const res = await apiClient.post<{ data: AdminProduct }>(
        `/api/v1/admin/catalog/products/${id}/${archiveDialog}`,
        {},
      );
      setArchivedAt(res.data.archivedAt ?? null);
      setInfo(t(archiveDialog === 'archive' ? 'productEditor.archive.done' : 'productEditor.restore.done'));
      setError(null);
      setArchiveDialog(null);
    } catch (err) {
      setArchiveError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t(archiveDialog === 'archive' ? 'productEditor.archive.failed' : 'productEditor.restore.failed'),
      );
    } finally {
      setArchiving(false);
    }
  }, [id, archiveDialog, archiving, t]);

  if (loading)
    return (
      <div className="b2b-page b2b-page--wide">
        <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('productEditor.loading')}</div>
      </div>
    );

  const tabs: Array<{ id: string; label: string; icon: ReactNode; show: boolean }> = [
    { id: 'details', label: 'Details', icon: <FileTextIcon size={14} />, show: true },
    { id: 'attributes', label: 'Attributes', icon: <SlidersHorizontal size={14} />, show: !isNew },
    { id: 'pricing', label: t('productEditor.tab.pricing'), icon: <CircleDollarSign size={14} />, show: !isNew },
    {
      id: 'variants',
      label: 'Variants',
      icon: <Layers size={14} />,
      show: !isNew && type === 'configurable',
    },
    {
      id: 'composite',
      label: type === 'grouped' ? 'Grouped items' : 'Bundle slots',
      icon: <Layers size={14} />,
      show: !isNew && (type === 'grouped' || type === 'bundle'),
    },
    { id: 'media', label: 'Media', icon: <ImageIcon size={14} />, show: !isNew },
    { id: 'inventory', label: 'Inventory', icon: <WarehouseIcon size={14} />, show: !isNew },
    { id: 'attachments', label: 'Attachments', icon: <Paperclip size={14} />, show: !isNew },
    { id: 'links', label: 'Related', icon: <LinkIcon size={14} />, show: !isNew },
    // Feature 091 / P7a, Z15 — the tab body is a zone, so the button is shown
    // by counting it. `useAdminZone` has already applied both presence axes and
    // each contributor's permission, so its length is the honest answer to "is
    // there anything behind this tab" — and a tab that opens on an empty panel
    // is worse than no tab. The label stays this screen's own word for the
    // place (Z14); what it stops knowing is which module fills it.
    {
      id: 'channels',
      label: 'Channels',
      icon: <StoreIcon size={14} />,
      show: !isNew && channelContributions.length > 0,
    },
    // Feature 163 (US4) — channels × languages for this product, beside the channels it is in.
    { id: 'scopes', label: t('productEditor.tab.scopes'), icon: <LayoutGrid size={14} />, show: !isNew },
    { id: 'seo', label: 'SEO', icon: <Globe size={14} />, show: !isNew },
  ];
  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <button
            type="button"
            className="b2b-page-head__back"
            onClick={(): void => { navigate('/catalog/products'); }}
          >
            <ChevronLeft size={14} /> Products
          </button>
          <div className="b2b-page-head__title">
            <span>{isNew ? 'New product' : pickName(name) || sku}</span>
            {!isNew ? <ProductStatusPill status={status} archived={Boolean(archivedAt)} /> : null}
            {!isNew && archivedAt ? <ArchivedPill /> : null}
          </div>
          {!isNew ? (
            <div className="b2b-page-head__sub">
              <span className="b2b-mono">{sku}</span> · <span style={{ textTransform: 'capitalize' }}>{type}</span>
            </div>
          ) : null}
        </div>
        <StickyFormActions className="b2b-page-head__actions">
          {!isNew ? (
            <>
              <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
                <Eye size={13} /> Preview
              </button>
              <button
                type="button"
                className="b2b-btn b2b-btn--default b2b-btn--sm"
                onClick={(): void => void handleDuplicate()}
                disabled={duplicating}
              >
                <Copy size={13} /> {duplicating ? 'Duplicating…' : 'Duplicate'}
              </button>
              {/* Reversible, so not styled as danger. Restore lives in the archived
                  notice, beside the sentence that explains it. */}
              {canWrite && !archivedAt ? (
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default b2b-btn--sm"
                  onClick={(): void => {
                    setArchiveError(null);
                    setArchiveDialog('archive');
                  }}
                >
                  <Archive size={13} aria-hidden="true" /> {t('productEditor.action.archive')}
                </button>
              ) : null}
              <button
                type="button"
                className="b2b-btn b2b-btn--danger b2b-btn--sm"
                onClick={(): void => void handleDeleteProduct()}
              >
                <Trash2 size={13} /> {t('productEditor.action.delete')}
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            onClick={(e): void => {
              void handleSave(e as unknown as FormEvent);
            }}
          >
            <Save size={14} /> Save
          </button>
        </StickyFormActions>
      </div>

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
      {/* Mounted before it has text, so the gate's warning is announced when it arrives. */}
      <div role="status">
        {gateWarning ? (
          <Alert variant="warning" role="none" className="mb-4" data-testid="product-gate-warning">
            <AlertDescription>{gateWarning}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      {/* Said where the operator looks first: archived
          means unavailable everywhere, whatever the status, and only Restore
          brings the product back. A standing state, so `status`, not `alert`. */}
      {!isNew && archivedAt ? (
        <Alert variant="warning" role="status" className="mb-4" data-testid="product-archived-notice">
          <AlertDescription>
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1">
                <strong>{t('productEditor.archived.title')}</strong>{' '}
                {t('productEditor.archived.body')}
              </span>
              {canWrite ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(): void => {
                    setArchiveError(null);
                    setArchiveDialog('restore');
                  }}
                >
                  <ArchiveRestore size={13} aria-hidden="true" /> {t('productEditor.action.restore')}
                </Button>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {archiveDialog !== null ? (
        <ModalDialog
          title={t(archiveDialog === 'archive' ? 'productEditor.archive.confirmTitle' : 'productEditor.restore.confirmTitle')}
          onClose={(): void => setArchiveDialog(null)}
          busy={archiving}
          aria-describedby="product-archive-confirm-body"
          footer={
            <>
              <Button type="button" variant="outline" disabled={archiving} onClick={(): void => setArchiveDialog(null)}>
                {t('productEditor.archive.cancel')}
              </Button>
              <Button
                type="button"
                disabled={archiving}
                aria-busy={archiving || undefined}
                onClick={(): void => {
                  void handleArchiveAction();
                }}
              >
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

      <div className="b2b-card">
        <div style={{ padding: '4px 4px 0', overflow: 'hidden' }}>
          <div className="b2b-tabs-scroll">
          <div className="b2b-tabs" role="tablist">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={cn('b2b-tab', activeTab === t.id && 'is-active')}
                onClick={(): void => setActiveTab(t.id)}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
          </div>
        </div>

        <div className="b2b-card__body">
          {activeTab === 'details' ? (
            <form id="product-details-form" onSubmit={handleSave}>
              <div className="b2b-col" style={{ gap: 18 }}>
                {/* Feature 023 — per-Sales-Channel + per-Language scope
                    editor. Sole editor for system Name + Description on
                    existing products: at Channel = Global it writes the
                    per-language baseline on `products`; at a specific
                    channel it writes a `product_value_overrides` row. */}
                {/* Feature 091 / P4b — the product editor's own zone mounts,
                    now with contributors. The zone names a **place**; nothing
                    here refers to a module, and the two PIM connectors each
                    render one control out of their own packages.

                    One mount per field, not one per field and locale: the
                    zone's props carry `languageCodes` and the fan-out is the
                    contributor's decision, which is what the two
                    `LOCALES.map(...)` loops this replaced were doing on a
                    foreign module's behalf. */}
                {id ? (
                  <AdminZone name="product.editor.details.before" props={{ productId: id }} />
                ) : null}
                {id ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <AdminZone
                      name="product.editor.field.after"
                      props={{ productId: id, fieldPath: 'name', languageCodes: LOCALES }}
                    />
                    <AdminZone
                      name="product.editor.field.after"
                      props={{ productId: id, fieldPath: 'description', languageCodes: LOCALES }}
                    />
                  </div>
                ) : null}

                {id ? (
                  <ProductScopeEditor
                    ref={scopeEditorRef}
                    productId={id}
                    baselineName={name}
                    baselineDescription={description}
                    globalStatus={status}
                    onBaselineNameChange={(next): void =>
                      setName({
                        'en-US': next['en-US'] ?? '',
                        'pl-PL': next['pl-PL'] ?? '',
                      })
                    }
                    onBaselineDescriptionChange={(next): void =>
                      setDescription({
                        'en-US': next['en-US'] ?? '',
                        'pl-PL': next['pl-PL'] ?? '',
                      })
                    }
                  />
                ) : null}

                <div>
                  <div className="b2b-label">{t('productEditor.section.identity')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <Label htmlFor="sku">{t('productEditor.field.sku')}</Label>
                      <Input
                        id="sku"
                        value={sku}
                        onChange={(e): void => setSku(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="ptype">{t('productEditor.field.type')}</Label>
                      <Select
                        id="ptype"
                        value={type}
                        onChange={(e): void =>
                          setType(
                            e.target.value as
                              | 'simple'
                              | 'configurable'
                              | 'grouped'
                              | 'bundle'
                              | 'virtual',
                          )
                        }
                        disabled={!isNew}
                      >
                        {PRODUCT_TYPES.map((pt) => (
                          <option key={pt} value={pt}>
                            {pt}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="pvis">{t('productEditor.field.visibility')}</Label>
                      <Select
                        id="pvis"
                        value={visibility}
                        onChange={(e): void =>
                          setVisibility(e.target.value as AdminProduct['visibility'])
                        }
                      >
                        {VISIBILITIES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="pattrset">{t('productEditor.field.attributeSet')}</Label>
                      <Select
                        id="pattrset"
                        value={attributeSetId}
                        onChange={(e): void => void handleAttributeSetChange(e.target.value)}
                      >
                        {attributeSets.length === 0 ? (
                          <option value="">{t('productEditor.attributeSet.loading')}</option>
                        ) : (
                          attributeSets.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.code}
                              {s.isSystem ? t('productEditor.attributeSet.systemSuffix') : ''}
                            </option>
                          ))
                        )}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="pstatus">{t('productEditor.field.status')}</Label>
                      <Select
                        id="pstatus"
                        value={status}
                        aria-describedby={
                          !isNew && archivedAt ? 'pstatus-help pstatus-archived' : 'pstatus-help'
                        }
                        onChange={(e): void =>
                          setStatus(e.target.value as AdminProduct['status'])
                        }
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {t(`productEditor.statusValue.${s}`)}
                          </option>
                        ))}
                      </Select>
                      <p id="pstatus-help" className="b2b-help">{t('productEditor.field.status.help')}</p>
                      {/* O-5 — setting Active does not restore an archived product. */}
                      {!isNew && archivedAt ? (
                        <p id="pstatus-archived" className="b2b-help">
                          {t('productEditor.field.status.archivedNote')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Feature 163 (FR-023) — the global publication window. A channel
                    may set its own in the scope controls above. No constraint
                    attributes: the check is ours and translated, never a
                    browser bubble. */}
                {id ? (
                  <div>
                    <div className="b2b-label">{t('productEditor.field.publishWindow')}</div>
                    <div className="b2b-row" style={{ gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <Label htmlFor="ppublish-from">{t('productEditor.field.publishFrom')}</Label>
                        <Input
                          id="ppublish-from"
                          type="datetime-local"
                          value={publishFrom}
                          aria-describedby={windowError ? 'ppublish-help ppublish-error' : 'ppublish-help'}
                          aria-invalid={windowError === 'invalidDate' ? true : undefined}
                          onKeyDown={(e): void => {
                            if (e.key === 'Enter') e.preventDefault();
                          }}
                          onChange={(e): void => {
                            setPublishFrom(e.target.value);
                            setWindowError(null);
                          }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="ppublish-until">{t('productEditor.field.publishUntil')}</Label>
                        <Input
                          id="ppublish-until"
                          type="datetime-local"
                          value={publishUntil}
                          aria-describedby={windowError ? 'ppublish-help ppublish-error' : 'ppublish-help'}
                          aria-invalid={windowError ? true : undefined}
                          onKeyDown={(e): void => {
                            if (e.key === 'Enter') e.preventDefault();
                          }}
                          onChange={(e): void => {
                            setPublishUntil(e.target.value);
                            setWindowError(null);
                          }}
                        />
                      </div>
                    </div>
                    <p id="ppublish-help" className="b2b-help">
                      {t('productEditor.field.publishWindow.help')}
                    </p>
                    {windowError ? (
                      <p id="ppublish-error" role="alert" className="text-sm text-destructive" style={{ margin: 0 }}>
                        {windowError === 'order'
                          ? t('productEditor.scopeControls.window.invalidOrder')
                          : t('productEditor.scopeControls.window.invalidDate')}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* Feature 023 — on existing products the
                    ProductScopeEditor panel above is the sole editor for
                    Name + Description. On NEW products the panel cannot
                    render yet (it needs a productId), so we keep the
                    per-locale inputs here as the create-time entry
                    surface; switch them off as soon as the product
                    exists. */}
                {isNew ? (
                  <>
                    <hr className="b2b-hr" />
                    <div>
                      <div className="b2b-label">{t('productEditor.section.localizedContent')}</div>
                      <p className="b2b-help" style={{ marginTop: 0, marginBottom: 12 }}>
                        {t('productEditor.section.localizedContent.help')}
                      </p>
                      <div className="b2b-col" style={{ gap: 18 }}>
                        {LOCALES.map((l) => (
                          <div key={l} className="b2b-col" style={{ gap: 8 }}>
                            <div>
                              <Label htmlFor={`name-${l}`}>{t('productEditor.field.localizedName', { locale: l })}</Label>
                              <Input
                                id={`name-${l}`}
                                value={name[l]}
                                onChange={(e): void =>
                                  setName((prev) => ({ ...prev, [l]: e.target.value }))
                                }
                              />
                            </div>
                            <div>
                              <Label htmlFor={`desc-${l}`}>{t('productEditor.field.localizedDescription', { locale: l })}</Label>
                              <textarea
                                id={`desc-${l}`}
                                rows={3}
                                className="b2b-field"
                                value={description[l]}
                                onChange={(e): void =>
                                  setDescription((prev) => ({ ...prev, [l]: e.target.value }))
                                }
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}

                <hr className="b2b-hr" />

                <div>
                  <div className="b2b-label">
                    {t('productEditor.section.categories')}
                    {id ? (
                      <AdminZone
                        name="product.editor.field.after"
                        props={{ productId: id, fieldPath: 'categories', languageCodes: null }}
                      />
                    ) : null}
                  </div>
                  <CategoryTreePicker
                    categories={categories}
                    selectedIds={categoryIds}
                    onChange={setCategoryIds}
                    loading={loading}
                  />
                  <p className="b2b-help">{t('productEditor.section.categories.help')}</p>
                </div>
              </div>
            </form>
          ) : null}

          {activeTab === 'attributes' && id ? (
            <ProductAttributesTab
              productId={id}
              attributeSetId={attributeSetId}
              savedAttributeSetId={savedAttributeSetId}
              values={attrValues}
              onChange={handleAttrChange}
            />
          ) : null}

          {activeTab === 'pricing' && id ? (
            <div className="b2b-col" style={{ gap: 16 }}>
              {/* Feature 091 / P4b — each connected PIM contributes one panel
                  here, listing the prices its import could write on this
                  product. A contributor with no binding over the product
                  renders nothing, which is every product until one is bound. */}
              <AdminZone name="product.editor.pricing.before" props={{ productId: id }} />
              {/* Feature 091 / P7a — the end of the Pricing tab. Feature 160
                  removed `price_lists`' linked-lists panel with the old model;
                  P2's base-price zone contributes here. */}
              <AdminZone name="product.editor.pricing.after" props={{ productId: id }} />
            </div>
          ) : null}

          {activeTab === 'variants' && id ? <VariantsSection productId={id} /> : null}

          {activeTab === 'composite' && id ? (
            type === 'grouped' ? (
              <GroupedItemsSection productId={id} />
            ) : (
              <BundleSlotsSection productId={id} />
            )
          ) : null}

          {activeTab === 'media' && id ? (
            <AdminZone
              name="product.editor.field.after"
              props={{ productId: id, fieldPath: 'gallery', languageCodes: null }}
            />
          ) : null}
          {(activeTab === 'media' || galleryOpened) && id ? (
            <div hidden={activeTab !== 'media'}>
              <GallerySection ref={galleryRef} productId={id} onDirtyChange={setGalleryDirty} />
            </div>
          ) : null}

          {activeTab === 'inventory' && id ? (
            <div className="b2b-col" style={{ gap: 16 }}>
              <ProductInventoryTab productId={id} />
              {/* Feature 155 — returnable for every type; the minimum gates itself (D5). */}
              <ProductOrderRulesCard productId={id} productType={type} />
              {type === 'simple' || type === 'configurable' ? (
                <PackagingUnitsEditor productId={id} canWrite={canWrite} />
              ) : null}
            </div>
          ) : null}

          {activeTab === 'attachments' && id ? (
            <>
              <AdminZone
                name="product.editor.field.after"
                props={{ productId: id, fieldPath: 'attachments', languageCodes: null }}
              />
              <AttachmentsSection productId={id} />
            </>
          ) : null}

          {activeTab === 'links' && id ? <ProductLinksSection productId={id} /> : null}

          {activeTab === 'channels' && id ? (
            <AdminZone name="product.editor.channels" props={{ productId: id }} />
          ) : null}

          {activeTab === 'scopes' && id ? <ProductScopeOverview productId={id} /> : null}

          {activeTab === 'seo' && id ? <ProductUrlKeysPanel productId={id} /> : null}
          {activeTab === 'seo' && id ? (
            <AdminZone name="product.editor.seo.after" props={{ productId: id }} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function pickName(name: Record<string, string>): string {
  return name['en-US'] ?? Object.values(name)[0] ?? '';
}

// ---------------------------------------------------------------------------
// Variants section (T054) — admin CRUD for ProductVariants under a
// configurable Product. Lives outside the Product editor's <form> so its
// own buttons don't submit the parent.
// ---------------------------------------------------------------------------

interface AdminVariant {
  id: string;
  parentProductId: string;
  sku: string;
  variantAttributeValues: Record<string, unknown>;
  stockLevel: number | null;
  createdAt: string;
  updatedAt: string;
}

function VariantsSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [variants, setVariants] = useState<AdminVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // The PDP returns variants nested in productDetail; admin needs a
      // standalone read to keep the forms quick. Foundation didn't ship
      // a GET /admin/.../variants, but the public productDetail under
      // /api/v1/catalog/products/<idOrSlug> includes them — use that.
      const res = await apiClient.get<{ data: { variants: AdminVariant[] } }>(
        `/api/v1/catalog/products/${productId}`,
      );
      setVariants(res.data.variants ?? []);
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
    async (input: {
      sku: string;
      attrs: string;
      stockLevel: string;
    }): Promise<void> => {
      // attrs is a comma-separated list of `key=value` pairs.
      const variantAttributeValues: Record<string, string> = {};
      for (const pair of input.attrs.split(',')) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const [k, v] = trimmed.split('=');
        if (k && v !== undefined) variantAttributeValues[k.trim()] = v.trim();
      }
      try {
        const payload: Record<string, unknown> = {
          sku: input.sku,
          variantAttributeValues,
        };
        if (input.stockLevel.trim()) {
          payload['stockLevel'] = Number(input.stockLevel);
        }
        await apiClient.post<{ data: AdminVariant }>(
          `/api/v1/admin/catalog/products/${productId}/variants`,
          payload,
        );
        setInfo(t('productEditor.variants.success.create', { sku: input.sku }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.variants.error.create'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (variantId: string, sku: string): Promise<void> => {
      if (!confirm(t('productEditor.variants.deleteConfirm', { sku }))) return;
      try {
        await apiClient.delete<void>(
          `/api/v1/admin/catalog/products/${productId}/variants/${variantId}`,
        );
        setInfo(t('productEditor.variants.success.delete', { sku }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.variants.error.delete'));
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.variants.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.variants.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('productEditor.variants.column.sku')}</TableHead>
                <TableHead>{t('productEditor.variants.column.attributes')}</TableHead>
                <TableHead>{t('productEditor.variants.column.stock')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.variants.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono">{v.sku}</TableCell>
                  <TableCell>
                    {Object.entries(v.variantAttributeValues)
                      .map(([k, val]) => `${k}=${String(val)}`)
                      .join(', ') || '—'}
                  </TableCell>
                  <TableCell>{v.stockLevel ?? '—'}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleDelete(v.id, v.sku)}
                    >
                      {t('productEditor.variants.action.delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <CreateVariantInline onCreate={handleCreate} />
      </CardContent>
    </Card>
  );
}

function CreateVariantInline({
  onCreate,
}: {
  onCreate: (input: {
    sku: string;
    attrs: string;
    stockLevel: string;
  }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [sku, setSku] = useState('');
  const [attrs, setAttrs] = useState('');
  const [stockLevel, setStockLevel] = useState('');

  return (
    <div
      className="grid gap-3 md:grid-cols-4 border-t pt-4"
      role="group"
      aria-label={t('productEditor.variants.createTitle')}
    >
      <div className="space-y-1">
        <Label htmlFor="vsku">{t('productEditor.variants.field.sku')}</Label>
        <Input id="vsku" value={sku} onChange={(e): void => setSku(e.target.value)} required />
      </div>
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="vattrs">{t('productEditor.variants.field.attributes')}</Label>
        <Input
          id="vattrs"
          value={attrs}
          onChange={(e): void => setAttrs(e.target.value)}
          placeholder={t('productEditor.variants.field.attributesPlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="vstock">{t('productEditor.variants.field.stock')}</Label>
        <Input
          id="vstock"
          type="number"
          min="0"
          value={stockLevel}
          onChange={(e): void => setStockLevel(e.target.value)}
        />
      </div>
      <div className="md:col-span-4">
        <Button
          type="button"
          onClick={() => {
            void onCreate({ sku, attrs, stockLevel }).then(() => {
              setSku('');
              setAttrs('');
              setStockLevel('');
            });
          }}
        >
          {t('productEditor.variants.action.add')}
        </Button>
      </div>
    </div>
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
  name: Record<string, string>;
}

function pickProductName(
  name: Record<string, string> | undefined | null,
  fallback: string,
): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

const TARGETS_BATCH_PAGE_SIZE = 200;

function ProductLinksSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [links, setLinks] = useState<AdminProductLink[]>([]);
  const [targetsById, setTargetsById] = useState<Map<string, AdminProductSummary>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
      try {
        await apiClient.post(`/api/v1/admin/catalog/products/${productId}/links`, {
          links: [{ targetProductId: input.targetProductId, kind: input.kind }],
        });
        setInfo(t('productEditor.links.success.add', { kind: input.kind }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.links.error.add'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (linkId: string): Promise<void> => {
      if (!confirm(t('productEditor.links.removeConfirm'))) return;
      try {
        await apiClient.delete(`/api/v1/admin/catalog/products/${productId}/links/${linkId}`);
        setInfo(t('productEditor.links.success.remove'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.links.error.delete'));
      }
    },
    [productId, refresh, t],
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
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.links.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : (
          <div className="space-y-6">
            {LINK_KINDS.map((kind) => (
              <div key={kind} className="space-y-2">
                <h3 className="text-sm font-medium uppercase tracking-wide">
                  {t(`productEditor.links.kind.${kind}`)} ({byKind[kind].length})
                </h3>
                {byKind[kind].length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('productEditor.links.empty')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('productEditor.links.column.target')}</TableHead>
                        <TableHead>{t('productEditor.links.column.sku')}</TableHead>
                        <TableHead>{t('productEditor.links.column.position')}</TableHead>
                        <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.links.column.actions')}</TableHead>
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
                            <TableCell>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => void handleDelete(link.id)}
                              >
                                {t('productEditor.links.action.remove')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            ))}
          </div>
        )}

        <CreateProductLinkInline onCreate={handleCreate} sourceProductId={productId} />
      </CardContent>
    </Card>
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
          disabled={targetProductId === null}
          onClick={() => {
            if (targetProductId === null) return;
            void onCreate({ targetProductId, kind }).then(() => {
              setTargetProductId(null);
            });
          }}
        >
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

function GroupedItemsSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [items, setItems] = useState<AdminGroupedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
        setInfo(t('productEditor.grouped.success.add'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.grouped.error.add'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (itemId: string): Promise<void> => {
      if (!confirm(t('productEditor.grouped.removeConfirm'))) return;
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/grouped-items/${itemId}`,
        );
        setInfo(t('productEditor.grouped.success.remove'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.grouped.error.delete'));
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.grouped.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
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
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.grouped.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.childProductId}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{item.position}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete(item.id)}
                    >
                      {t('productEditor.grouped.action.remove')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <CreateGroupedItemInline onCreate={handleCreate} />
      </CardContent>
    </Card>
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
          onClick={() => {
            if (!childProductId) return;
            void onCreate({ childProductId, quantity }).then(() => {
              setChildProductId('');
              setQuantity('1');
            });
          }}
        >
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

function BundleSlotsSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [slots, setSlots] = useState<AdminBundleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
        setInfo(t('productEditor.bundle.success.addSlot', { name: input.name }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.addSlot'));
      }
    },
    [productId, refresh, t],
  );

  const handleDeleteSlot = useCallback(
    async (slotId: string): Promise<void> => {
      if (!confirm(t('productEditor.bundle.removeSlotConfirm'))) return;
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots/${slotId}`,
        );
        setInfo(t('productEditor.bundle.success.removeSlot'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.deleteSlot'));
      }
    },
    [productId, refresh, t],
  );

  const handleAddOption = useCallback(
    async (slotId: string, optionProductId: string): Promise<void> => {
      if (!optionProductId) return;
      try {
        await apiClient.post(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots/${slotId}/options`,
          { optionProductId },
        );
        setInfo(t('productEditor.bundle.success.addOption'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.addOption'));
      }
    },
    [productId, refresh, t],
  );

  const handleRemoveOption = useCallback(
    async (slotId: string, optionId: string): Promise<void> => {
      if (!confirm(t('productEditor.bundle.removeOptionConfirm'))) return;
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots/${slotId}/options/${optionId}`,
        );
        setInfo(t('productEditor.bundle.success.removeOption'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.deleteOption'));
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.bundle.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.bundle.empty')}</p>
        ) : (
          <div className="space-y-4">
            {slots.map((slot) => (
              <BundleSlotCard
                key={slot.id}
                slot={slot}
                onAddOption={handleAddOption}
                onRemoveOption={handleRemoveOption}
                onDeleteSlot={handleDeleteSlot}
              />
            ))}
          </div>
        )}

        <CreateBundleSlotInline onCreate={handleCreateSlot} />
      </CardContent>
    </Card>
  );
}

function BundleSlotCard({
  slot,
  onAddOption,
  onRemoveOption,
  onDeleteSlot,
}: {
  slot: AdminBundleSlot;
  onAddOption: (slotId: string, optionProductId: string) => Promise<void>;
  onRemoveOption: (slotId: string, optionId: string) => Promise<void>;
  onDeleteSlot: (slotId: string) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [optionId, setOptionId] = useState('');

  return (
    <div className="rounded border p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">
          {slot.name['en-US'] ?? Object.values(slot.name)[0] ?? '—'}{' '}
          <span className="text-xs text-muted-foreground">
            {t('productEditor.bundle.slotMeta', {
              min: slot.minQuantity,
              max: slot.maxQuantity,
              position: slot.position,
            })}
          </span>
        </h3>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => void onDeleteSlot(slot.id)}
        >
          {t('productEditor.bundle.action.deleteSlot')}
        </Button>
      </div>
      <div className="mt-2">
        {slot.options.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('productEditor.bundle.optionsEmpty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('productEditor.bundle.column.optionProductId')}</TableHead>
                <TableHead>{t('productEditor.bundle.column.defaultQuantity')}</TableHead>
                <TableHead>{t('productEditor.bundle.column.position')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.bundle.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slot.options.map((opt) => (
                <TableRow key={opt.id}>
                  <TableCell className="font-mono text-xs">{opt.optionProductId}</TableCell>
                  <TableCell>{opt.defaultQuantity}</TableCell>
                  <TableCell>{opt.position}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void onRemoveOption(slot.id, opt.id)}
                    >
                      {t('productEditor.bundle.action.removeOption')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="mt-3 flex items-end gap-2">
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
          onClick={() => {
            void onAddOption(slot.id, optionId).then(() => {
              setOptionId('');
            });
          }}
        >
          {t('productEditor.bundle.action.addOption')}
        </Button>
      </div>
    </div>
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
          onClick={() => {
            if (!name) return;
            void onCreate({ name, minQuantity, maxQuantity }).then(() => {
              setName('');
              setMinQuantity('0');
              setMaxQuantity('1');
            });
          }}
        >
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
