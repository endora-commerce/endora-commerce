import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { GripVertical } from 'lucide-react';
import { GALLERY_ALT_TEXT_MAX, type AssetSummary, type AssetDetail, type GalleryItem } from '@endora-commerce/contracts';
import type { GalleryChannelRoles } from '../lib/media-scopes.js';
import { ApiError, apiClient, toAbsoluteAssetUrl, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, Checkbox, CardContent, CardHeader, CardTitle, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { AssetPicker, ModalDialog, TouchReorderButtons } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { ScopeContext } from './ProductScopeEditor.js';
import { getProductScopeContext } from '../lib/product-scopes-api.js';
import {
  NO_CHANNEL_ROLES,
  ROLE_KEYS,
  channelNameIn,
  channelRolesChanges,
  languagesToOffer,
  memberChannels,
  sameSet,
  translationPatch,
  withChannelHidden,
  type ChannelRoles,
  type TranslationMap,
} from '../lib/media-scopes.js';

// ---------------------------------------------------------------------------
// Gallery section (T085) — admin CRUD for the Product's gallery items.
// Foundation lacks an admin Asset upload endpoint, so for now the form
// accepts an existing assetId; future work adds drag-and-drop on top of
// an Assets module admin upload route.
//
// Feature 163 (T141, US9, FR-076, FR-077) — the list is the admin read, so an
// image hidden in the channel the public read resolves to stays listed (the
// public read is only where the preview URLs come from). Per member channel the
// operator picks a role holder or "use inherited" and hides images there; alt
// text is edited per language. Everything is staged and written by the page Save.
// ---------------------------------------------------------------------------

const GALLERY_LABELS = ['base_image', 'small_image', 'thumbnail'] as const;
type GalleryLabel = (typeof GALLERY_LABELS)[number];

type Translate = (key: string, params?: Record<string, string>) => string;

interface AdminGalleryItem {
  id: string;
  productId: string;
  assetId: string;
  position: number;
  labels: GalleryLabel[];
  altText: TranslationMap;
  hiddenInChannels: string[];
  asset?: { url: string; kind: string };
}

interface AdminProductImage {
  id: string;
  kind: string;
  url: string;
  altText: string | null;
}

/** What the public product read carries that the admin read does not: the asset URLs. */
interface PublicMedia {
  gallery?: Array<{ id: string; asset: { id: string; kind: string; url: string } }>;
  assets?: Array<{ id: string; kind: string; url: string; altText?: string | null }>;
}

export interface GallerySectionHandle {
  /** Persist staged label, order, alt-text, hidden-channel and channel-role edits. Called by the page-Save button. */
  flushGallery: () => Promise<void>;
}

/** Immutable array move used by drag-and-drop / arrow reordering. */
function moveGalleryItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return items;
  next.splice(to, 0, moved);
  return next;
}

/** The server truth the page Save diffs against. */
interface Baseline {
  items: Map<string, { labels: string; altText: TranslationMap; hiddenInChannels: string[] }>;
  order: string;
  roles: Map<string, ChannelRoles>;
}

const EMPTY_BASELINE: Baseline = { items: new Map(), order: '', roles: new Map() };

/** The file an asset URL names, for telling images apart while their places shift (D13). */
function assetFileName(url: string | undefined): string | null {
  if (!url) return null;
  const last = url.split('?')[0]?.split('/').filter(Boolean).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Whether the staged gallery differs from the server truth the page Save diffs against. */
function hasStagedEdits(items: AdminGalleryItem[], roles: Map<string, ChannelRoles>, baseline: Baseline): boolean {
  if (items.map((it) => it.id).join(',') !== baseline.order) return true;
  for (const it of items) {
    const before = baseline.items.get(it.id);
    if (!before) continue;
    if (before.labels !== [...it.labels].sort().join(',')) return true;
    if (translationPatch(before.altText, it.altText)) return true;
    if (!sameSet(before.hiddenInChannels, it.hiddenInChannels)) return true;
  }
  for (const [forChannel, draft] of roles) {
    if (channelRolesChanges(baseline.roles.get(forChannel) ?? NO_CHANNEL_ROLES, draft)) return true;
  }
  return false;
}

export interface GallerySectionProps {
  productId: string;
  /**
   * Told whether staged (unsaved) edits exist, so the page's unsaved-changes prompt
   * covers them (review D4).
   */
  onDirtyChange?: (dirty: boolean) => void;
}

export const GallerySection = forwardRef<GallerySectionHandle, GallerySectionProps>(
  function GallerySection({ productId, onDirtyChange }, ref): ReactNode {
  const t = useTranslation('catalog') as Translate;
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const scopeSelectId = useId();
  const languageSelectId = useId();
  const stagedReasonId = useId();
  const [items, setItems] = useState<AdminGalleryItem[]>([]);
  const [images, setImages] = useState<AdminProductImage[]>([]);
  const [context, setContext] = useState<ScopeContext | null>(null);
  const [roles, setRoles] = useState<Map<string, ChannelRoles>>(() => new Map());
  const [channelId, setChannelId] = useState('');
  const [altLanguage, setAltLanguage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** The item a Remove is waiting on the operator's yes for (D4: a kit dialog, not `confirm()`). */
  const [removing, setRemoving] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  // Server-truth snapshot used to diff the staged edits that the page-Save button flushes.
  const baselineRef = useRef<Baseline>(EMPTY_BASELINE);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // The admin read is the list (every item, with its alt text and hidden channels).
      // The public read only lends the asset URLs — it resolves one channel, so an image
      // hidden there has no preview here — and the product's flat `assets` (legacy
      // product_assets), which the storefront renders when the gallery is empty.
      const [galleryRes, rolesRes, scope, publicRes] = await Promise.all([
        apiClient.get<{ data: GalleryItem[] }>(`/api/v1/admin/catalog/products/${productId}/gallery`),
        apiClient.get<{ data: GalleryChannelRoles[] }>(
          `/api/v1/admin/catalog/products/${productId}/gallery/channel-roles`,
        ),
        getProductScopeContext(productId).catch(() => null),
        apiClient
          .get<{ data: PublicMedia }>(`/api/v1/catalog/products/${productId}`)
          .catch(() => ({ data: {} as PublicMedia })),
      ]);
      const publicMedia = publicRes.data ?? {};
      const urlByItem = new Map((publicMedia.gallery ?? []).map((g) => [g.id, g.asset]));
      const urlByAsset = new Map((publicMedia.assets ?? []).map((a) => [a.id, a]));
      const mapped: AdminGalleryItem[] = (galleryRes.data ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((g) => {
          const asset = urlByItem.get(g.id) ?? urlByAsset.get(g.assetId);
          return {
            id: g.id,
            productId,
            assetId: g.assetId,
            position: g.position,
            labels: g.labels as GalleryLabel[],
            // 168-shim: the Global alt text is one string now and the channel lists are gone; S3
            // moves the gallery's scoped fields to `ScopedField` on the scoped-values save.
            altText: {},
            hiddenInChannels: [],
            ...(asset ? { asset: { url: asset.url, kind: asset.kind } } : {}),
          };
        });
      const savedRoles = new Map((rolesRes.data ?? []).map((r) => [r.channelId, { ...NO_CHANNEL_ROLES, ...r.roles }]));
      setItems(mapped);
      setRoles(new Map(savedRoles));
      setContext(scope);
      baselineRef.current = {
        items: new Map(
          mapped.map((it) => [
            it.id,
            { labels: [...it.labels].sort().join(','), altText: it.altText, hiddenInChannels: it.hiddenInChannels },
          ]),
        ),
        order: mapped.map((it) => it.id).join(','),
        roles: savedRoles,
      };
      setImages(
        (publicMedia.assets ?? [])
          .filter((a) => a.kind === 'image' || a.kind === 'video')
          .map((a) => ({
            id: a.id,
            kind: a.kind,
            url: a.url,
            altText: a.altText ?? null,
          })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const channels = memberChannels(context);
  const channel = channels.find((c) => c.id === channelId) ?? null;
  const languages = useMemo(
    () => languagesToOffer(context, ...items.map((it) => it.altText)),
    [context, items],
  );
  const language = languages.includes(altLanguage) ? altLanguage : (languages[0] ?? '');
  const itemName = useCallback(
    (itemId: string): string =>
      t('productEditor.gallery.itemName', { n: String(items.findIndex((it) => it.id === itemId) + 1) }),
    [items, t],
  );
  /** "Image N · file" — the role selects' wording, since the place alone shifts on reorder (D13). */
  const itemOptionName = useCallback(
    (itemId: string): string => {
      const file = assetFileName(items.find((it) => it.id === itemId)?.asset?.url);
      return file ? t('productEditor.gallery.itemOption', { item: itemName(itemId), file }) : itemName(itemId);
    },
    [items, itemName, t],
  );
  const channelName = useCallback(
    (id: string): string => channelNameIn(context, id, t('productEditor.mediaScopes.unknownChannel')),
    [context, t],
  );

  // --- Staged label edits: each label lives on at most one item; assigning it
  //     to one item strips it from every other (radio semantics). Persisted on
  //     page Save, so no per-row Save button and no "already taken" error. ---
  const assignLabel = useCallback((label: GalleryLabel, itemId: string): void => {
    setInfo(null);
    setItems((prev) =>
      prev.map((it) => {
        const without = it.labels.filter((l) => l !== label);
        return { ...it, labels: it.id === itemId ? [...without, label] : without };
      }),
    );
  }, []);

  const clearLabel = useCallback((label: GalleryLabel): void => {
    setInfo(null);
    setItems((prev) => prev.map((it) => ({ ...it, labels: it.labels.filter((l) => l !== label) })));
  }, []);

  // --- Staged per-channel and per-language edits (feature 163). ---
  const setChannelRole = useCallback((forChannel: string, label: GalleryLabel, itemId: string | null): void => {
    setInfo(null);
    setRoles((prev) => {
      const next = new Map(prev);
      next.set(forChannel, { ...(prev.get(forChannel) ?? NO_CHANNEL_ROLES), [ROLE_KEYS[label]]: itemId });
      return next;
    });
  }, []);

  const setHidden = useCallback((itemId: string, forChannel: string, hidden: boolean): void => {
    setInfo(null);
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, hiddenInChannels: withChannelHidden(it.hiddenInChannels, forChannel, hidden) } : it,
      ),
    );
  }, []);

  const setAltText = useCallback((itemId: string, forLanguage: string, text: string): void => {
    setInfo(null);
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, altText: { ...it.altText, [forLanguage]: text } } : it)),
    );
  }, []);

  // --- Staged reorder (array order === display order). ---
  const moveItem = useCallback((from: number, to: number): void => {
    setInfo(null);
    setItems((prev) => moveGalleryItem(prev, from, to));
  }, []);

  const handleDrop = useCallback((index: number): void => {
    const draggedId = dragIdRef.current;
    if (!draggedId) return;
    setItems((prev) => {
      const from = prev.findIndex((it) => it.id === draggedId);
      return from < 0 || from === index ? prev : moveGalleryItem(prev, from, index);
    });
  }, []);

  // --- Immediate CRUD (add / remove) — these hit the server directly and
  //     re-load, which also resets the staged baseline. ---
  const handleCreate = useCallback(
    async (assetId: string): Promise<void> => {
      setBusy(true);
      try {
        await apiClient.post(`/api/v1/admin/catalog/products/${productId}/gallery`, {
          assetId,
          labels: [],
        });
        setInfo(t('productEditor.gallery.success.add'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.add'));
      } finally {
        setBusy(false);
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (itemId: string): Promise<void> => {
      setBusy(true);
      try {
        await apiClient.delete(`/api/v1/admin/catalog/products/${productId}/gallery/${itemId}`);
        setInfo(t('productEditor.gallery.success.remove'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.delete'));
      } finally {
        setBusy(false);
        setRemoving(null);
      }
    },
    [productId, refresh, t],
  );

  // --- Page-Save hook: flush the staged edits. Labels are patched with
  //     `replace=true` so reassigning a label moves it atomically; alt text and
  //     hidden channels go in one PATCH per item (`product.media.update`); the
  //     channel roles in one PUT per changed channel, changed roles only. ---
  const flushGallery = useCallback(async (): Promise<void> => {
    const baseline = baselineRef.current;
    let wrote = false;
    for (const it of items) {
      const before = baseline.items.get(it.id);
      if (!before) continue;
      if (before.labels !== [...it.labels].sort().join(',')) {
        await apiClient.patch(
          `/api/v1/admin/catalog/products/${productId}/gallery/${it.id}?replace=true`,
          { labels: it.labels },
        );
        wrote = true;
      }
      const altText = translationPatch(before.altText, it.altText);
      const hiddenChanged = !sameSet(before.hiddenInChannels, it.hiddenInChannels);
      if (altText || hiddenChanged) {
        await apiClient.patch(`/api/v1/admin/catalog/products/${productId}/gallery/${it.id}`, {
          ...(altText ? { altText } : {}),
          ...(hiddenChanged ? { hiddenInChannels: it.hiddenInChannels } : {}),
        });
        wrote = true;
      }
    }
    const curOrder = items.map((it) => it.id).join(',');
    if (items.length > 0 && curOrder !== baseline.order) {
      await apiClient.put(`/api/v1/admin/catalog/products/${productId}/gallery/order`, {
        orderedGalleryItemIds: items.map((it) => it.id),
      });
      wrote = true;
    }
    for (const [forChannel, draft] of roles) {
      const changes = channelRolesChanges(baseline.roles.get(forChannel) ?? NO_CHANNEL_ROLES, draft);
      if (!changes) continue;
      await apiClient.put(`/api/v1/admin/catalog/products/${productId}/gallery/channel-roles`, {
        channelId: forChannel,
        roles: changes,
      });
      wrote = true;
    }
    if (wrote) {
      await refresh();
    }
  }, [items, productId, refresh, roles]);

  useImperativeHandle(ref, () => ({ flushGallery }), [flushGallery]);

  // D4 — staged edits feed the page's unsaved-changes prompt.
  const dirty = !loading && hasStagedEdits(items, roles, baselineRef.current);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const disabled = busy || loading;
  const scopeDisabled = disabled || !canWrite;
  // UX-2 = A — Add and Remove write at once and re-read the gallery, which would drop the
  // staged edits, so while there are any they wait for the page Save, and say so.
  const addRemoveBlocked = dirty;

  /**
   * The item holding a role globally (the staged labels), named for "use inherited" —
   * saying so when it is hidden in the channel being edited (C-9).
   */
  const globalHolderName = (label: GalleryLabel, forChannel: string): string => {
    const holder = items.find((it) => it.labels.includes(label));
    if (!holder) return t('productEditor.gallery.channelRole.none');
    return holder.hiddenInChannels.includes(forChannel)
      ? t('productEditor.gallery.channelRole.hiddenHere', { item: itemName(holder.id) })
      : itemOptionName(holder.id);
  };

  /** A channel's own role holders that are hidden in that very channel (D13). */
  const hiddenHolders = channel
    ? GALLERY_LABELS.flatMap((label) => {
        const holderId = roles.get(channel.id)?.[ROLE_KEYS[label]] ?? null;
        const holder = holderId ? items.find((it) => it.id === holderId) : undefined;
        return holder && holder.hiddenInChannels.includes(channel.id) ? [{ label, holder }] : [];
      })
    : [];
  const removingItem = removing ? items.find((it) => it.id === removing) ?? null : null;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.gallery.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canWrite ? <p className="text-sm text-muted-foreground">{t('productEditor.gallery.readOnly')}</p> : null}
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

        {!loading && images.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('productEditor.gallery.productImages.title')}</p>
            <p className="text-xs text-muted-foreground">
              {t('productEditor.gallery.productImages.hint')}
            </p>
            <div className="flex flex-wrap gap-2">
              {images.map((img) =>
                img.kind === 'video' ? (
                  <video
                    key={img.id}
                    src={toAbsoluteAssetUrl(img.url)}
                    className="h-20 w-20 rounded border object-cover"
                    muted
                  />
                ) : (
                  <img
                    key={img.id}
                    src={toAbsoluteAssetUrl(img.url)}
                    alt={img.altText ?? ''}
                    className="h-20 w-20 rounded border object-cover"
                  />
                ),
              )}
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.gallery.empty')}</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={scopeSelectId}>{t('productEditor.gallery.scope.label')}</Label>
                <Select
                  id={scopeSelectId}
                  aria-describedby={`${scopeSelectId}-hint`}
                  value={channel ? channel.id : ''}
                  disabled={disabled}
                  onChange={(e): void => setChannelId(e.target.value)}
                >
                  <option value="">{t('productEditor.gallery.scope.global')}</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <p id={`${scopeSelectId}-hint`} className="text-xs text-muted-foreground">
                  {channels.length === 0
                    ? t('productEditor.gallery.scope.noChannels')
                    : t('productEditor.gallery.scope.hint')}
                </p>
              </div>
              {languages.length > 0 ? (
                <div className="space-y-1">
                  <Label htmlFor={languageSelectId}>{t('productEditor.gallery.alt.language')}</Label>
                  <Select
                    id={languageSelectId}
                    aria-describedby={`${languageSelectId}-hint`}
                    value={language}
                    disabled={disabled}
                    onChange={(e): void => setAltLanguage(e.target.value)}
                  >
                    {languages.map((code) => (
                      <option key={code} value={code}>
                        {code.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                  <p id={`${languageSelectId}-hint`} className="text-xs text-muted-foreground">
                    {t('productEditor.gallery.alt.hint')}
                    {channel ? ` ${t('productEditor.gallery.alt.hintChannel')}` : ''}
                  </p>
                </div>
              ) : null}
            </div>

            {channel ? (
              <div className="grid gap-3 md:grid-cols-3" role="group" aria-label={channel.name}>
                {GALLERY_LABELS.map((label) => {
                  const key = ROLE_KEYS[label];
                  const value = roles.get(channel.id)?.[key] ?? '';
                  const selectId = `${scopeSelectId}-${label}`;
                  const options = items.filter(
                    (it) => it.id === value || !it.hiddenInChannels.includes(channel.id),
                  );
                  return (
                    <div key={label} className="space-y-1">
                      <Label htmlFor={selectId}>
                        {t('productEditor.gallery.channelRole.label', {
                          role: t(`productEditor.gallery.label.${label}`),
                          channel: channel.name,
                        })}
                      </Label>
                      <Select
                        id={selectId}
                        value={value}
                        disabled={scopeDisabled}
                        onChange={(e): void => setChannelRole(channel.id, label, e.target.value || null)}
                      >
                        <option value="">
                          {t('productEditor.gallery.channelRole.inherited', {
                            item: globalHolderName(label, channel.id),
                          })}
                        </option>
                        {options.map((it) => (
                          <option key={it.id} value={it.id}>
                            {itemOptionName(it.id)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {channel && hiddenHolders.length > 0 ? (
              <Alert variant="warning">
                <AlertDescription>
                  {hiddenHolders
                    .map(({ label, holder }) =>
                      t('productEditor.gallery.channelRole.hiddenHolder', {
                        item: itemName(holder.id),
                        role: t(`productEditor.gallery.label.${label}`).toLowerCase(),
                        channel: channel.name,
                      }),
                    )
                    .join(' ')}
                </AlertDescription>
              </Alert>
            ) : null}

            <p className="text-xs text-muted-foreground">{t('productEditor.gallery.dragHint')}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t('productEditor.gallery.column.preview')}</TableHead>
                  {channel ? (
                    <TableHead className="text-center">
                      {t('productEditor.gallery.column.hidden', { channel: channel.name })}
                    </TableHead>
                  ) : (
                    <>
                      {GALLERY_LABELS.map((label) => (
                        <TableHead key={label} className="text-center">
                          {t(`productEditor.gallery.label.${label}`)}
                        </TableHead>
                      ))}
                      <TableHead>{t('productEditor.gallery.column.hiddenIn')}</TableHead>
                    </>
                  )}
                  {language ? (
                    <TableHead>
                      {t('productEditor.gallery.column.altText', { language: language.toUpperCase() })}
                    </TableHead>
                  ) : null}
                  <TableHead>{t('productEditor.gallery.column.assetId')}</TableHead>
                  <TableHead className="w-[1%] whitespace-nowrap text-right">
                    {t('productEditor.gallery.column.actions')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <GalleryRow
                    key={item.id}
                    item={item}
                    name={itemName(item.id)}
                    index={index}
                    total={items.length}
                    disabled={disabled}
                    scopeDisabled={scopeDisabled}
                    channel={channel}
                    language={language}
                    channelName={channelName}
                    onAssignLabel={assignLabel}
                    onClearLabel={clearLabel}
                    onSetHidden={setHidden}
                    onSetAltText={setAltText}
                    onMove={moveItem}
                    onDragStart={(id) => {
                      dragIdRef.current = id;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onDragEnd={() => {
                      dragIdRef.current = null;
                    }}
                    onPreview={setPreviewUrl}
                    onDelete={setRemoving}
                    removeBlockedReasonId={canWrite && addRemoveBlocked ? stagedReasonId : null}
                  />
                ))}
              </TableBody>
            </Table>
          </>
        )}

        {canWrite && addRemoveBlocked ? (
          <p id={stagedReasonId} className="text-sm text-muted-foreground">
            {t('productEditor.gallery.stagedBlocksAddRemove')}
          </p>
        ) : null}
        <CreateGalleryItemInline
          disabled={disabled || addRemoveBlocked}
          blockedReasonId={canWrite && addRemoveBlocked ? stagedReasonId : null}
          onCreate={handleCreate}
        />
      </CardContent>

      {previewUrl ? (
        <ModalDialog
          title={t('productEditor.gallery.preview.title')}
          onClose={(): void => setPreviewUrl(null)}
          widthClassName="max-w-4xl"
          footer={
            <Button type="button" variant="outline" onClick={(): void => setPreviewUrl(null)}>
              {t('productEditor.gallery.preview.close')}
            </Button>
          }
        >
          <img
            src={previewUrl}
            alt={t('productEditor.gallery.preview.title')}
            className="mx-auto max-h-[70vh] max-w-full rounded"
          />
        </ModalDialog>
      ) : null}

      {removingItem ? (
        <ModalDialog
          title={t('productEditor.gallery.remove.title', { item: itemName(removingItem.id) })}
          busy={busy}
          onClose={(): void => setRemoving(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setRemoving(null)}>
                {t('productEditor.gallery.remove.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                aria-busy={busy}
                onClick={(): void => void handleDelete(removingItem.id)}
              >
                {t('productEditor.gallery.remove.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('productEditor.gallery.remove.body', { item: itemOptionName(removingItem.id) })}</p>
        </ModalDialog>
      ) : null}
    </Card>
  );
});

function GalleryRow({
  item,
  name,
  index,
  total,
  disabled,
  scopeDisabled,
  channel,
  language,
  channelName,
  onAssignLabel,
  onClearLabel,
  onSetHidden,
  onSetAltText,
  onMove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPreview,
  onDelete,
  removeBlockedReasonId,
}: {
  item: AdminGalleryItem;
  name: string;
  index: number;
  total: number;
  disabled: boolean;
  scopeDisabled: boolean;
  /** The channel being edited; `null` = the global roles. */
  channel: { id: string; name: string } | null;
  /** The alt-text language being edited; `''` = none to offer. */
  language: string;
  channelName: (channelId: string) => string;
  onAssignLabel: (label: GalleryLabel, itemId: string) => void;
  onClearLabel: (label: GalleryLabel) => void;
  onSetHidden: (itemId: string, channelId: string, hidden: boolean) => void;
  onSetAltText: (itemId: string, language: string, text: string) => void;
  onMove: (from: number, to: number) => void;
  onDragStart: (itemId: string) => void;
  onDragOver: (event: DragEvent<HTMLTableRowElement>) => void;
  onDrop: (index: number) => void;
  onDragEnd: () => void;
  onPreview: (url: string) => void;
  onDelete: (id: string) => void;
  /** Set while Remove waits for the page Save (UX-2): the id of the sentence saying so. */
  removeBlockedReasonId: string | null;
}): ReactNode {
  const t = useTranslation('catalog') as Translate;
  const url = item.asset?.url ? toAbsoluteAssetUrl(item.asset.url) : null;

  return (
    <TableRow
      draggable={!disabled}
      onDragStart={() => onDragStart(item.id)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(index)}
      onDragEnd={onDragEnd}
    >
      <TableCell className="w-8">
        <span
          className="inline-flex cursor-grab items-center text-muted-foreground"
          title={t('productEditor.gallery.dragHint')}
          aria-hidden
        >
          <GripVertical className="h-4 w-4" />
        </span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {url ? (
            item.asset?.kind === 'video' ? (
              <video src={url} className="h-12 w-12 rounded border object-cover" muted />
            ) : (
              <button
                type="button"
                className="block rounded border p-0"
                title={t('productEditor.gallery.preview.open')}
                onClick={() => onPreview(url)}
              >
                <img src={url} alt="" className="h-12 w-12 rounded object-cover" />
              </button>
            )
          ) : (
            <span className="text-muted-foreground text-xs" aria-hidden>
              —
            </span>
          )}
          <span className="text-sm">{name}</span>
        </div>
      </TableCell>
      {channel ? (
        <TableCell className="text-center">
          <Checkbox
            checked={item.hiddenInChannels.includes(channel.id)}
            disabled={scopeDisabled}
            aria-label={t('productEditor.gallery.hide.label', { item: name, channel: channel.name })}
            onChange={(e) => onSetHidden(item.id, channel.id, e.target.checked)}
          />
        </TableCell>
      ) : (
        <>
          {GALLERY_LABELS.map((label) => {
            const checked = item.labels.includes(label);
            return (
              <TableCell key={label} className="text-center">
                <input
                  type="radio"
                  name={`gallery-label-${label}`}
                  checked={checked}
                  disabled={disabled}
                  aria-label={t(`productEditor.gallery.label.${label}`)}
                  onChange={() => onAssignLabel(label, item.id)}
                  // A checked radio fires no change: clicking it again clears the role.
                  onClick={() => {
                    if (checked) onClearLabel(label);
                  }}
                />
              </TableCell>
            );
          })}
          <TableCell className="text-xs text-muted-foreground">
            {item.hiddenInChannels.length > 0 ? item.hiddenInChannels.map(channelName).join(', ') : '—'}
          </TableCell>
        </>
      )}
      {language ? (
        <TableCell>
          <Input
            value={item.altText[language] ?? ''}
            disabled={scopeDisabled}
            maxLength={GALLERY_ALT_TEXT_MAX}
            placeholder={t('productEditor.gallery.alt.placeholder')}
            aria-label={t('productEditor.gallery.alt.label', { item: name, language: language.toUpperCase() })}
            onChange={(e) => onSetAltText(item.id, language, e.target.value)}
          />
        </TableCell>
      ) : null}
      <TableCell className="font-mono text-xs">{item.assetId.slice(0, 8)}…</TableCell>
      <TableCell className="space-x-2 whitespace-nowrap text-right">
        <TouchReorderButtons
          disabled={disabled}
          onMoveUp={() => onMove(index, index - 1)}
          onMoveDown={() => onMove(index, index + 1)}
          disableUp={index === 0}
          disableDown={index === total - 1}
        />
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={disabled || removeBlockedReasonId !== null}
          aria-describedby={removeBlockedReasonId ?? undefined}
          onClick={() => onDelete(item.id)}
        >
          {t('productEditor.gallery.action.remove')}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CreateGalleryItemInline({
  disabled,
  blockedReasonId,
  onCreate,
}: {
  disabled: boolean;
  /** Set while Add waits for the page Save (UX-2): the id of the sentence saying so. */
  blockedReasonId: string | null;
  onCreate: (assetId: string) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [assetId, setAssetId] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedFilename, setPickedFilename] = useState<string | null>(null);
  const onPick = (a: AssetSummary | AssetDetail): void => {
    setAssetId(a.id);
    setPickedFilename(a.filename);
    setPickerOpen(false);
  };

  return (
    <div className="space-y-3 border-t pt-4" role="group" aria-label={t('productEditor.gallery.addTitle')}>
      {pickerOpen ? (
        <AssetPicker
          acceptMimePrefix="image/"
          allowUpload
          onSelect={onPick}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
      <div className="space-y-1 md:col-span-3">
        <Label htmlFor="gasset">{t('productEditor.gallery.field.asset')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="gasset"
            value={pickedFilename ?? assetId}
            readOnly
            placeholder={t('productEditor.gallery.field.noAsset')}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            {t('productEditor.gallery.action.pickOrUpload')}
          </Button>
        </div>
      </div>
      <div className="flex items-end">
        <Button
          type="button"
          disabled={disabled || !assetId}
          aria-describedby={blockedReasonId ?? undefined}
          onClick={() => {
            if (!assetId) return;
            void onCreate(assetId).then(() => {
              setAssetId('');
              setPickedFilename(null);
            });
          }}
        >
          {t('productEditor.gallery.action.add')}
        </Button>
      </div>
      </div>
    </div>
  );
}


