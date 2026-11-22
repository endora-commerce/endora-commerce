import { useEffect, useState, useCallback } from 'react';
import type { Data } from '@puckeditor/core';
import type { NewsletterCustomField, NewsletterEmailBlockSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { ListPage, ResponsiveTable, useConfirmDialog, type ListPageLoad } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, Checkbox, EmptyState, FormField, Input, PageHeader } from '@endora-commerce/admin-kit/ui';
import {
  EmailEditorPane,
  EmailVariablesProvider,
  listEmailTemplatesForApply,
  loadEmailTemplateCanvas,
  saveCanvasAsEmailTemplate,
} from '@endora-commerce/page-builder-admin/email';
import { newsletterVariables } from '../email-variables.js';
import { newsletterClient } from '../api/newsletter-client.js';
import { describeDeleteError } from '../describe-delete-error.js';
import { Blocks, Plus } from 'lucide-react';

const emptyData: Data = { root: { props: {} }, content: [] };

function asData(content: unknown): Data {
  if (!content || typeof content !== 'object') return emptyData;
  return content as Data;
}

/**
 * The newsletter's reusable e-mail blocks.
 *
 * The list is the kit's `ListPage` since issue #1749. The block editor — a
 * whole e-mail canvas — used to be drawn open above the list for a new block
 * all the time (Hick); *New block* in the header now opens it in place of the
 * list, as *Edit* does, and *Cancel* or a save comes back to the list.
 */
export function BlocksPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const tc = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const canWrite = hasPermission('newsletter:write');
  const [items, setItems] = useState<NewsletterEmailBlockSummary[]>([]);
  const [customFields, setCustomFields] = useState<NewsletterCustomField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [listLoad, setListLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [createContent, setCreateContent] = useState<Data>(emptyData);
  const [edit, setEdit] = useState<{
    id: string;
    code: string;
    name: string;
    content: Data;
    active: boolean;
    version: number;
  } | null>(null);

  const load = useCallback(() => {
    newsletterClient
      .listBlocks()
      .then((r) => {
        setItems(r.items);
        setListLoad({ kind: 'ready' });
      })
      .catch((e: unknown) => setListLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(() => load(), [load]);
  useEffect(() => {
    newsletterClient
      .listCustomFields()
      .then((r) => setCustomFields(r.items))
      .catch(() => undefined);
  }, []);

  const startEdit = useCallback((id: string): void => {
    setError(null);
    newsletterClient
      .getBlock(id)
      .then((b) => {
        setEdit({
          id: b.id,
          code: b.code,
          name: b.name,
          content: asData(b.content),
          active: b.active,
          version: b.version,
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /** Issue #1464 — a delete asks first, and runs inside the dialog. */
  async function confirmDelete(block: NewsletterEmailBlockSummary): Promise<void> {
    setError(null);
    await confirm({
      title: t('delete.block.title'),
      message: t('delete.block.message', { name: block.name, code: block.code }),
      confirmLabel: t('delete.block.action'),
      destructive: true,
      action: async () => {
        await newsletterClient.deleteBlock(block.id);
        load();
      },
      describeError: describeDeleteError(t),
    });
  }

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>{t('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const variables = newsletterVariables(customFields.map((f) => ({ key: f.key, label: f.label })));

  const errorAlert = error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  if (canWrite && edit) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('emailBlocks.edit.title')} />
        {errorAlert}
        <EmailVariablesProvider variables={variables}>
          <Card>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <FormField label={t('emailBlocks.field.code')} className="w-full max-w-sm">
                  <Input value={edit.code} readOnly disabled className="font-mono" />
                </FormField>
                <FormField label={t('emailBlocks.field.name')} className="w-full max-w-sm">
                  <Input
                    value={edit.name}
                    onChange={(e) => setEdit((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                  />
                </FormField>
              </div>
              <EmailEditorPane
                editorKey={`nl-block:${edit.id}`}
                data={edit.content}
                onChange={(data) => setEdit((prev) => (prev ? { ...prev, content: data } : prev))}
                builderContext="newsletter"
                onSaveAsTemplate={async (meta: { name: string; code: string }, canvasData: Data) => {
                  await saveCanvasAsEmailTemplate({
                    ...meta,
                    data: canvasData,
                    languages: ['en-US'],
                    activeLanguage: 'en-US',
                  });
                }}
                onListTemplatesForApply={() => listEmailTemplatesForApply(null)}
                onResolveTemplateLayout={(templateId) => loadEmailTemplateCanvas(templateId, 'en-US')}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={edit.active}
                  onChange={(e) => setEdit((prev) => (prev ? { ...prev, active: e.target.checked } : prev))}
                />
                {t('emailBlocks.field.active')}
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    void run(async () => {
                      await newsletterClient.updateBlock(edit.id, {
                        name: edit.name,
                        content: edit.content as Record<string, unknown>,
                        active: edit.active,
                        expectedVersion: edit.version,
                      });
                      setEdit(null);
                    })
                  }
                >
                  {t('emailBlocks.saveChanges')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEdit(null)}>
                  {tc('common.action.cancel')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </EmailVariablesProvider>
      </div>
    );
  }

  if (canWrite && creating) {
    const closeCreate = (): void => {
      setCreating(false);
      setCode('');
      setName('');
      setCreateContent(emptyData);
    };
    return (
      <div className="space-y-4">
        <PageHeader title={t('emailBlocks.new.title')} />
        {errorAlert}
        <EmailVariablesProvider variables={variables}>
          <Card>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-start gap-3">
                <FormField label={t('emailBlocks.field.code')} hint={t('emailBlocks.field.codeHint')} className="w-full max-w-sm">
                  <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
                </FormField>
                <FormField label={t('emailBlocks.field.name')} className="w-full max-w-sm">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </FormField>
              </div>
              <EmailEditorPane
                editorKey={`nl-block:new:${code || 'draft'}`}
                data={createContent}
                onChange={setCreateContent}
                builderContext="newsletter"
                onSaveAsTemplate={async (meta, canvasData) => {
                  await saveCanvasAsEmailTemplate({
                    ...meta,
                    data: canvasData,
                    languages: ['en-US'],
                    activeLanguage: 'en-US',
                  });
                }}
                onListTemplatesForApply={() => listEmailTemplatesForApply(null)}
                onResolveTemplateLayout={(templateId) => loadEmailTemplateCanvas(templateId, 'en-US')}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    void run(async () => {
                      await newsletterClient.createBlock({
                        code,
                        name,
                        content: createContent as Record<string, unknown>,
                      });
                      closeCreate();
                    })
                  }
                >
                  {t('emailBlocks.create')}
                </Button>
                <Button variant="outline" size="sm" onClick={closeCreate}>
                  {tc('common.action.cancel')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </EmailVariablesProvider>
      </div>
    );
  }

  const newBlock = (
    <Button
      onClick={() => {
        setError(null);
        setCreating(true);
      }}
    >
      <Plus aria-hidden="true" />
      {t('emailBlocks.new.title')}
    </Button>
  );
  const nothingYet = listLoad.kind === 'ready' && items.length === 0;

  return (
    <>
      <ListPage
        title={t('emailBlocks.title')}
        actions={canWrite && !nothingYet ? newBlock : null}
        count={t('emailBlocks.count', { count: items.length })}
        notice={errorAlert}
        load={listLoad}
        onRetry={load}
      >
        <ResponsiveTable
          data={items}
          keyExtractor={(b) => b.id}
          emptyState={<EmptyState icon={<Blocks size={20} />} title={t('emailBlocks.empty')} action={canWrite ? newBlock : null} />}
          columns={[
            { id: 'name', header: t('common.column.name'), primary: true, render: (b) => <span className="font-medium">{b.name}</span>, meta: (b) => <code className="text-xs">{b.code}</code> },
            { id: 'code', header: t('common.column.code'), hideOnMobile: true, className: 'font-mono text-xs', render: (b) => b.code },
            { id: 'active', header: t('emailBlocks.column.active'), render: (b) => (b.active ? t('common.yes') : '—') },
            { id: 'system', header: t('emailBlocks.column.system'), render: (b) => (b.isSystem ? t('common.yes') : '—') },
          ]}
          {...(canWrite
            ? {
                renderActions: (b: NewsletterEmailBlockSummary) => (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(b.id)}>
                      {tc('common.action.edit')}
                    </Button>
                    {!b.isSystem ? (
                      <Button variant="ghost" size="sm" onClick={() => void confirmDelete(b)}>
                        {tc('common.action.delete')}
                      </Button>
                    ) : (
                      <span className="self-center text-xs text-muted-foreground">{t('emailBlocks.protected')}</span>
                    )}
                  </div>
                ),
              }
            : {})}
        />
      </ListPage>
      {confirmDialog}
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default BlocksPage;
