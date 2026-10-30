import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ProductAttachment } from '@endora-commerce/contracts';
import { ApiError, apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { AssetPicker, ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { ScopeContext } from './ProductScopeEditor.js';
import { AttachmentScopesDialog } from './AttachmentScopesDialog.js';
import { getProductScopeContext } from '../lib/product-scopes-api.js';
import { channelNameIn, type TranslationMap } from '../lib/media-scopes.js';

// ---------------------------------------------------------------------------
// Attachments section (T086) — admin CRUD for Product Attachments. The
// Library picker (feature 013 / US1) replaces the manual UUID input; assets
// are picked from the Library or uploaded inline.
//
// Feature 163 (T141, US9 #4, FR-078) — the list is the admin read, so an
// attachment hidden in the channel the public read resolves to stays listed (the
// public read only lends the file links). Each row opens its names and
// descriptions per language and its hidden channels.
// ---------------------------------------------------------------------------

type Translate = (key: string, params?: Record<string, string>) => string;

interface AdminAttachmentType {
  id: string;
  code: string;
  name: Record<string, string>;
  position: number;
}

interface AdminAttachment {
  id: string;
  productId: string;
  assetId: string;
  attachmentTypeId: string;
  name: string;
  description: string | null;
  position: number;
  nameTranslations: TranslationMap;
  descriptionTranslations: TranslationMap;
  hiddenInChannels: string[];
  asset?: { url: string; filename: string; mimeType: string };
}

/** What the public product read carries that the admin read does not: the file links. */
interface PublicAttachments {
  attachments?: Array<{
    id: string;
    asset: { id: string; url: string; filename: string; mimeType: string };
  }>;
}

export function AttachmentsSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog') as Translate;
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');
  const [attachments, setAttachments] = useState<AdminAttachment[]>([]);
  const [types, setTypes] = useState<AdminAttachmentType[]>([]);
  const [context, setContext] = useState<ScopeContext | null>(null);
  const [editing, setEditing] = useState<AdminAttachment | null>(null);
  /** The attachment waiting on "delete it?" — asked in the kit dialog, as the gallery asks. */
  const [removing, setRemoving] = useState<AdminAttachment | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [list, typesRes, scope, detail] = await Promise.all([
        apiClient.get<{ data: ProductAttachment[] }>(`/api/v1/admin/catalog/products/${productId}/attachments`),
        apiClient.get<{ data: AdminAttachmentType[] }>(
          '/api/v1/admin/catalog/attachment-types',
        ),
        getProductScopeContext(productId).catch(() => null),
        apiClient
          .get<{ data: PublicAttachments }>(`/api/v1/catalog/products/${productId}`)
          .catch(() => ({ data: {} as PublicAttachments })),
      ]);
      const assetById = new Map((detail.data?.attachments ?? []).map((a) => [a.id, a.asset]));
      setAttachments(
        (list.data ?? []).map((a) => {
          const asset = assetById.get(a.id);
          return {
            id: a.id,
            productId,
            assetId: a.assetId,
            attachmentTypeId: a.attachmentTypeId,
            name: a.name,
            description: a.description,
            position: a.position,
            // 168-shim: 163's per-scope maps are gone from the DTO; S3 moves these to `ScopedField`.
            nameTranslations: {},
            descriptionTranslations: {},
            hiddenInChannels: [],
            ...(asset ? { asset: { url: asset.url, filename: asset.filename, mimeType: asset.mimeType } } : {}),
          };
        }),
      );
      setTypes(typesRes.data);
      setContext(scope);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.attachments.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  const typeName = (typeId: string): string => {
    const type = types.find((typ) => typ.id === typeId);
    return type ? (type.name['en-US'] ?? type.code) : '—';
  };
  const hiddenIn = (attachment: AdminAttachment): string | null =>
    attachment.hiddenInChannels.length === 0
      ? null
      : t('productEditor.mediaScopes.hiddenIn', {
          channels: attachment.hiddenInChannels
            .map((id) => channelNameIn(context, id, t('productEditor.mediaScopes.unknownChannel')))
            .join(', '),
        });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      assetId: string;
      attachmentTypeId: string;
      name: string;
      description: string;
    }): Promise<void> => {
      try {
        await apiClient.post(`/api/v1/admin/catalog/products/${productId}/attachments`, {
          assetId: input.assetId,
          attachmentTypeId: input.attachmentTypeId,
          name: input.name,
          ...(input.description ? { description: input.description } : {}),
        });
        setInfo(t('productEditor.attachments.success.add'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.attachments.error.add'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (attachmentId: string, name: string): Promise<void> => {
      setRemoveBusy(true);
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/attachments/${attachmentId}`,
        );
        setRemoving(null);
        setInfo(t('productEditor.attachments.success.delete', { name }));
        await refresh();
      } catch (err) {
        setRemoving(null);
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.attachments.error.delete'));
      } finally {
        setRemoveBusy(false);
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.attachments.title')}</CardTitle>
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
        ) : attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.attachments.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('productEditor.attachments.column.type')}</TableHead>
                <TableHead>{t('productEditor.attachments.column.name')}</TableHead>
                <TableHead>{t('productEditor.attachments.column.description')}</TableHead>
                <TableHead>{t('productEditor.attachments.column.file')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.attachments.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attachments.map((att) => (
                <TableRow key={att.id}>
                  <TableCell>{typeName(att.attachmentTypeId)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{att.name}</div>
                    {hiddenIn(att) ? (
                      <div className="text-xs text-muted-foreground">{hiddenIn(att)}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {att.description ?? '—'}
                  </TableCell>
                  <TableCell>
                    {att.asset?.url ? (
                      <a
                        href={att.asset.url}
                        target="_blank"
                        rel="noopener"
                        className="text-xs underline"
                      >
                        {att.asset.filename}
                      </a>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="space-x-2 whitespace-nowrap">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={t('productEditor.attachments.scopes.title', { name: att.name })}
                      onClick={() => setEditing(att)}
                    >
                      {t('productEditor.attachments.scopes.open')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => setRemoving(att)}
                    >
                      {t('productEditor.attachments.action.delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <CreateAttachmentInline types={types} onCreate={handleCreate} />
      </CardContent>
      {removing ? (
        <ModalDialog
          title={t('productEditor.attachments.deleteConfirm', { name: removing.name })}
          busy={removeBusy}
          onClose={(): void => setRemoving(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={removeBusy} onClick={(): void => setRemoving(null)}>
                {t('productEditor.attachments.remove.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={removeBusy}
                aria-busy={removeBusy}
                onClick={(): void => void handleDelete(removing.id, removing.name)}
              >
                {t('productEditor.attachments.remove.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('productEditor.attachments.remove.body', { name: removing.name })}</p>
        </ModalDialog>
      ) : null}
      {editing ? (
        <AttachmentScopesDialog
          productId={productId}
          attachment={editing}
          context={context}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setInfo(t('productEditor.attachments.scopes.saved'));
            void refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

function CreateAttachmentInline({
  types,
  onCreate,
}: {
  types: AdminAttachmentType[];
  onCreate: (input: {
    assetId: string;
    attachmentTypeId: string;
    name: string;
    description: string;
  }) => Promise<void>;
}): ReactNode {
  const [assetId, setAssetId] = useState('');
  const [attachmentTypeId, setAttachmentTypeId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedFilename, setPickedFilename] = useState<string | null>(null);
  const t = useTranslation('catalog');

  return (
    <div className="space-y-3 border-t pt-4" role="group" aria-label={t('productEditor.attachments.addTitle')}>
      {pickerOpen ? (
        <AssetPicker
          allowUpload
          onSelect={(a): void => {
            setAssetId(a.id);
            setPickedFilename(a.filename);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor="aasset">{t('productEditor.attachments.field.asset')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="aasset"
            value={pickedFilename ?? assetId}
            readOnly
            placeholder={t('productEditor.attachments.field.noAsset')}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            {t('productEditor.attachments.action.pickOrUpload')}
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="atype">{t('productEditor.attachments.field.type')}</Label>
        <Select
          id="atype"
          value={attachmentTypeId}
          onChange={(e): void => setAttachmentTypeId(e.target.value)}
        >
          <option value="">—</option>
          {types.map((typ) => (
            <option key={typ.id} value={typ.id}>
              {typ.name['en-US'] ?? typ.code}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="aname">{t('productEditor.attachments.field.name')}</Label>
        <Input
          id="aname"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder={t('productEditor.attachments.field.namePlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="adesc">{t('productEditor.attachments.field.description')}</Label>
        <Input
          id="adesc"
          value={description}
          onChange={(e): void => setDescription(e.target.value)}
          placeholder={t('productEditor.attachments.field.descriptionPlaceholder')}
        />
      </div>
      <div className="md:col-span-4">
        <Button
          type="button"
          onClick={() => {
            if (!assetId || !attachmentTypeId || !name) return;
            void onCreate({ assetId, attachmentTypeId, name, description }).then(() => {
              setAssetId('');
              setPickedFilename(null);
              setAttachmentTypeId('');
              setName('');
              setDescription('');
            });
          }}
        >
          {t('productEditor.attachments.action.add')}
        </Button>
      </div>
      </div>
    </div>
  );
}

