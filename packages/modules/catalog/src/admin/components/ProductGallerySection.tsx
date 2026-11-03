import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import type { AssetDetail, AssetSummary } from '@endora-commerce/contracts';
import { ApiError, apiClient, toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Input, Label } from '@endora-commerce/admin-kit/ui';
import { AssetPicker, ModalDialog, ScopedFieldGrid } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { EditorField, useProductEditor } from './editor/editor-context.js';
import { SectionHeading } from './editor/ImmediateBadge.js';
import { BooleanControl, SelectControl, TextControl } from './editor/scoped-controls.js';

/**
 * Feature 170 (T101, T147; `contracts/editor-ui.md` §3, §4, §11) — the product's images at the
 * editor scope.
 *
 * The image set and its order are Global: adding, removing and reordering run at once as their
 * own audited Commands ("Applies immediately") and are offered at Global only. Alt text,
 * visibility and the three roles are scoped values (`gallery:<id>:altText`,
 * `gallery:<id>:hidden`, `galleryRole:<label>`) staged with the editor's one Save. After an
 * immediate action only the gallery family is re-read; staged changes stay, and a staged change
 * of a removed image is dropped and announced by the page.
 */

const ROLE_LABELS = ['base_image', 'small_image', 'thumbnail'] as const;
const ROLE_KEY = { base_image: 'baseImage', small_image: 'smallImage', thumbnail: 'thumbnail' } as const;

function fileOf(url: string): string {
  const last = url.split('?')[0]?.split('/').filter(Boolean).pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export function GallerySection(): ReactNode {
  const t = useTranslation('catalog');
  const ctx = useProductEditor();
  const data = ctx.state.data;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  /** Where focus goes once the list is re-read (WCAG 2.4.3): the moved image, or the heading after a removal. */
  const pendingFocus = useRef<{ id: string; dir: 'up' | 'down' } | 'heading' | null>(null);
  const itemOrder = data ? data.gallery.items.map((i) => `${i.id}:${i.position}`).join(',') : '';
  useEffect(() => {
    const target = pendingFocus.current;
    if (busy || target === null) return;
    pendingFocus.current = null;
    if (target === 'heading') {
      const heading = document.getElementById('product-gallery-heading');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
      return;
    }
    const row = document.querySelector(`[data-gallery-item="${target.id}"]`);
    const same = row?.querySelector<HTMLElement>(`[data-move="${target.dir}"]`);
    const other = row?.querySelector<HTMLElement>(`[data-move="${target.dir === 'up' ? 'down' : 'up'}"]`);
    (same && same.getAttribute('aria-disabled') !== 'true' ? same : (other ?? same))?.focus();
  }, [busy, itemOrder]);
  if (!data) return null;
  const atGlobal = ctx.state.scope.level === 'global';
  const structural = atGlobal && !ctx.readOnly;
  const items = [...data.gallery.items].sort((a, b) => a.position - b.position);
  const itemName = (id: string): string => {
    const index = items.findIndex((i) => i.id === id);
    const item = items[index];
    return t('productEditor.gallery.itemOption', {
      item: t('productEditor.gallery.itemName', { n: String(index + 1) }),
      file: item ? fileOf(item.url) : '',
    });
  };
  const base = `/api/v1/admin/catalog/products/${encodeURIComponent(ctx.productId)}/gallery`;

  const immediate = async (run: () => Promise<unknown>, done: string, failed: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await run();
      await ctx.refreshFamily('gallery');
      setStatus(done);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : failed);
    } finally {
      setBusy(false);
    }
  };

  const move = (from: number, to: number): void => {
    if (busy || to < 0 || to >= items.length) return;
    const next = items.map((i) => i.id);
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    pendingFocus.current = { id: moved, dir: to < from ? 'up' : 'down' };
    void immediate(
      () => apiClient.put(`${base}/order`, { orderedGalleryItemIds: next }),
      t('productEditor.gallery.success.moved'),
      t('productEditor.gallery.error.save'),
    );
  };

  const roleOptions = items.map((i) => ({ value: i.id, label: itemName(i.id) }));

  return (
    <section className="space-y-4" aria-labelledby="product-gallery-heading">
      <SectionHeading
        id="product-gallery-heading"
        title={t('productEditor.gallery.title')}
        immediate={structural}
        globalOnlyLabel={atGlobal ? undefined : t('productEditor.gallery.setGlobalOnly')}
      />
      <p className="text-sm text-muted-foreground">
        {atGlobal ? t('productEditor.gallery.help.global') : t('productEditor.gallery.help.scoped', { scope: ctx.scopeLabel })}
      </p>
      <p role="status" className="sr-only">
        {status}
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{t('productEditor.gallery.empty')}</p> : null}
      <ul className="space-y-4">
        {items.map((item, index) => {
          const name = itemName(item.id);
          return (
            <li key={item.id} className="rounded-md border p-3" data-gallery-item={item.id}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <img src={toAbsoluteAssetUrl(item.url)} alt="" className="h-16 w-16 rounded border object-cover" />
                <span className="flex-1 text-sm font-medium">{name}</span>
                {structural ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      // aria-disabled, not disabled: the pressed button keeps focus while the move runs.
                      aria-disabled={busy || index === 0 ? true : undefined}
                      data-move="up"
                      aria-label={t('productEditor.gallery.moveUp', { item: name })}
                      onClick={(): void => move(index, index - 1)}
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-disabled={busy || index === items.length - 1 ? true : undefined}
                      data-move="down"
                      aria-label={t('productEditor.gallery.moveDown', { item: name })}
                      onClick={(): void => move(index, index + 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={(): void => setRemoving(item.id)}>
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t('productEditor.gallery.action.removeItem', { item: name })}
                    </Button>
                  </>
                ) : null}
              </div>
              <ScopedFieldGrid>
                <EditorField<string>
                  fieldPath={`gallery:${item.id}:altText`}
                  label={t('productEditor.gallery.field.altTextFor', { item: name })}
                  textField
                  emptyMeaning={t('productEditor.gallery.altEmptyMeaning')}
                  note={item.assetAltText ? t('productEditor.gallery.assetAltFallback', { alt: item.assetAltText }) : undefined}
                  render={(p): ReactNode => <TextControl {...p} maxLength={255} />}
                />
                <EditorField<boolean>
                  fieldPath={`gallery:${item.id}:hidden`}
                  label={t('productEditor.gallery.field.visibilityFor', { item: name })}
                  render={(p): ReactNode => (
                    <BooleanControl {...p} trueLabel={t('productEditor.visibility.hidden')} falseLabel={t('productEditor.visibility.shown')} />
                  )}
                />
              </ScopedFieldGrid>
            </li>
          );
        })}
      </ul>

      {items.length > 0 ? (
        <section className="space-y-2" aria-labelledby="product-gallery-roles-heading">
          <h4 id="product-gallery-roles-heading" className="text-sm font-semibold">
            {t('productEditor.gallery.roles.title')}
          </h4>
          <ScopedFieldGrid>
            {ROLE_LABELS.map((label) => (
              <EditorField<string>
                key={label}
                fieldPath={`galleryRole:${label}`}
                label={t(`productEditor.gallery.role.${ROLE_KEY[label]}`)}
                emptyMeaning={t('productEditor.gallery.roles.emptyMeaning')}
                render={(p): ReactNode => <SelectControl {...p} options={roleOptions} noneLabel={t('productEditor.gallery.roles.none')} />}
              />
            ))}
          </ScopedFieldGrid>
        </section>
      ) : null}

      {structural ? (
        <AddGalleryItem
          disabled={busy}
          onAdd={(assetId): Promise<void> =>
            immediate(
              () => apiClient.post(base, { assetId, labels: [] }),
              t('productEditor.gallery.success.add'),
              t('productEditor.gallery.error.add'),
            )
          }
        />
      ) : null}

      {removing ? (
        <ModalDialog
          title={t('productEditor.gallery.removeTitle', { item: itemName(removing) })}
          busy={busy}
          onClose={(): void => setRemoving(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setRemoving(null)}>
                {t('productEditor.gallery.removeCancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={(): void => {
                  const id = removing;
                  setRemoving(null);
                  pendingFocus.current = 'heading';
                  void immediate(
                    () => apiClient.delete(`${base}/${id}`),
                    t('productEditor.gallery.success.remove'),
                    t('productEditor.gallery.error.delete'),
                  );
                }}
              >
                {t('productEditor.gallery.removeConfirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('productEditor.gallery.removeBody')}</p>
        </ModalDialog>
      ) : null}
    </section>
  );
}

function AddGalleryItem({ disabled, onAdd }: { disabled: boolean; onAdd(assetId: string): Promise<void> }): ReactNode {
  const t = useTranslation('catalog');
  const [picked, setPicked] = useState<{ id: string; filename: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const onPick = (asset: AssetSummary | AssetDetail): void => {
    setPicked({ id: asset.id, filename: asset.filename });
    setPickerOpen(false);
  };
  return (
    <div className="space-y-2 border-t pt-4" role="group" aria-label={t('productEditor.gallery.addTitle')}>
      {pickerOpen ? (
        <AssetPicker acceptMimePrefix="image/" allowUpload onSelect={onPick} onClose={(): void => setPickerOpen(false)} />
      ) : null}
      <Label htmlFor="gallery-new-asset">{t('productEditor.gallery.field.asset')}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id="gallery-new-asset" readOnly value={picked?.filename ?? ''} placeholder={t('productEditor.gallery.field.noAsset')} />
        <Button type="button" variant="outline" size="sm" onClick={(): void => setPickerOpen(true)}>
          {t('productEditor.gallery.action.pickOrUpload')}
        </Button>
        <Button
          type="button"
          disabled={disabled || !picked}
          onClick={(): void => {
            if (!picked) return;
            void onAdd(picked.id).then(() => setPicked(null));
          }}
        >
          {t('productEditor.gallery.action.add')}
        </Button>
      </div>
    </div>
  );
}
