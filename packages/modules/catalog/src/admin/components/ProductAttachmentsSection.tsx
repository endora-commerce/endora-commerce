import { useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { AssetPicker, ModalDialog, ScopedFieldGrid } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { EditorField, useProductEditor } from './editor/editor-context.js';
import { SectionHeading } from './editor/ImmediateBadge.js';
import { BooleanControl, TextControl, TextareaControl } from './editor/scoped-controls.js';

/**
 * Feature 172 (T101, T147; `contracts/editor-ui.md` §3, §4, §11) — the product's attachments at
 * the editor scope.
 *
 * The files and their order are Global: adding and removing one run at once as their own
 * audited Commands ("Applies immediately") and are offered at Global only. Each attachment's
 * name, description and visibility are scoped values (`attachment:<id>:name|description|hidden`)
 * staged with the editor's one Save. After an immediate action only the attachments family is
 * re-read; a staged change of a removed attachment is dropped and announced by the page.
 */

interface AdminAttachmentType {
  id: string;
  code: string;
  name: Record<string, string>;
  position: number;
}

export function AttachmentsSection(): ReactNode {
  const t = useTranslation('catalog');
  const ctx = useProductEditor();
  const data = ctx.state.data;
  const [types, setTypes] = useState<AdminAttachmentType[]>([]);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ data: AdminAttachmentType[] }>('/api/v1/admin/catalog/attachment-types')
      .then((res) => {
        if (!cancelled) setTypes(res.data ?? []);
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;
  const atGlobal = ctx.state.scope.level === 'global';
  const structural = atGlobal && !ctx.readOnly;
  const base = `/api/v1/admin/catalog/products/${encodeURIComponent(ctx.productId)}/attachments`;
  const attachments = [...data.attachments].sort((a, b) => a.position - b.position);
  const typeName = (typeId: string): string => {
    const type = types.find((candidate) => candidate.id === typeId);
    return type ? (type.name['en-US'] ?? type.code) : '';
  };

  const immediate = async (run: () => Promise<unknown>, done: string, failed: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await run();
      await ctx.refreshFamily('attachments');
      setStatus(done);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="product-attachments-heading">
      <SectionHeading
        id="product-attachments-heading"
        title={t('productEditor.attachments.title')}
        immediate={structural}
        globalOnlyLabel={atGlobal ? undefined : t('productEditor.attachments.setGlobalOnly')}
      />
      <p className="text-sm text-muted-foreground">
        {atGlobal
          ? t('productEditor.attachments.help.global')
          : t('productEditor.attachments.help.scoped', { scope: ctx.scopeLabel })}
      </p>
      <p role="status" className="sr-only">
        {status}
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('productEditor.attachments.empty')}</p>
      ) : null}
      <ul className="space-y-4">
        {attachments.map((attachment) => {
          const subject = attachment.fileName;
          return (
            <li key={attachment.id} className="rounded-md border p-3" data-attachment={attachment.id}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="flex-1 font-mono text-sm">{attachment.fileName}</span>
                <span className="text-xs text-muted-foreground">{typeName(attachment.typeId)}</span>
                {structural ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="max-lg:min-h-11"
                    disabled={busy}
                    onClick={(): void => setRemoving({ id: attachment.id, name: subject })}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    {t('productEditor.attachments.action.removeItem', { name: subject })}
                  </Button>
                ) : null}
              </div>
              <ScopedFieldGrid>
                <EditorField<string>
                  fieldPath={`attachment:${attachment.id}:name`}
                  label={t('productEditor.attachments.field.nameFor', { name: subject })}
                  textField
                  render={(p): ReactNode => <TextControl {...p} maxLength={160} />}
                />
                <EditorField<boolean>
                  fieldPath={`attachment:${attachment.id}:hidden`}
                  label={t('productEditor.attachments.field.visibilityFor', { name: subject })}
                  render={(p): ReactNode => (
                    <BooleanControl {...p} trueLabel={t('productEditor.visibility.hidden')} falseLabel={t('productEditor.visibility.shown')} />
                  )}
                />
                <EditorField<string>
                  fieldPath={`attachment:${attachment.id}:description`}
                  label={t('productEditor.attachments.field.descriptionFor', { name: subject })}
                  textField
                  wide
                  emptyMeaning={t('productEditor.emptyMeaning.nothingShown')}
                  render={(p): ReactNode => <TextareaControl {...p} rows={2} />}
                />
              </ScopedFieldGrid>
            </li>
          );
        })}
      </ul>
      {structural ? (
        <CreateAttachmentInline
          types={types}
          onCreate={(input): Promise<void> =>
            immediate(
              () =>
                apiClient.post(base, {
                  assetId: input.assetId,
                  attachmentTypeId: input.attachmentTypeId,
                  name: input.name,
                  ...(input.description ? { description: input.description } : {}),
                }),
              t('productEditor.attachments.success.add'),
              t('productEditor.attachments.error.add'),
            )
          }
        />
      ) : null}
      {removing ? (
        <ModalDialog
          title={t('productEditor.attachments.remove.title')}
          busy={busy}
          onClose={(): void => setRemoving(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setRemoving(null)}>
                {t('productEditor.attachments.remove.cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={(): void => {
                  const target = removing;
                  setRemoving(null);
                  void immediate(
                    () => apiClient.delete(`${base}/${target.id}`),
                    t('productEditor.attachments.success.delete', { name: target.name }),
                    t('productEditor.attachments.error.delete'),
                  );
                }}
              >
                {t('productEditor.attachments.remove.confirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('productEditor.attachments.remove.body', { name: removing.name })}</p>
        </ModalDialog>
      ) : null}
    </section>
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
          <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={() => setPickerOpen(true)}>
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

