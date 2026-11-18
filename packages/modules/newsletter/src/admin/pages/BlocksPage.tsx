import { useEffect, useState, useCallback } from 'react';
import type { Data } from '@puckeditor/core';
import type { NewsletterCustomField, NewsletterEmailBlockSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, FormField, Input, PageHeader } from '@endora-commerce/admin-kit/ui';
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

const emptyData: Data = { root: { props: {} }, content: [] };

function asData(content: unknown): Data {
  if (!content || typeof content !== 'object') return emptyData;
  return content as Data;
}

export function BlocksPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const tc = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const canWrite = hasPermission('newsletter:write');
  const [items, setItems] = useState<NewsletterEmailBlockSummary[]>([]);
  const [customFields, setCustomFields] = useState<NewsletterCustomField[]>([]);
  const [error, setError] = useState<string | null>(null);
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
      .then((r) => setItems(r.items))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
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

  return (
    <div className="space-y-4">
      <PageHeader title={t('emailBlocks.title')} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <EmailVariablesProvider variables={variables}>
        {canWrite && edit ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('emailBlocks.edit.title')}</CardTitle>
            </CardHeader>
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
                {...(canWrite
                  ? {
                      onSaveAsTemplate: async (
                        meta: { name: string; code: string },
                        canvasData: Data,
                      ) => {
                        await saveCanvasAsEmailTemplate({
                          ...meta,
                          data: canvasData,
                          languages: ['en-US'],
                          activeLanguage: 'en-US',
                        });
                      },
                    }
                  : {})}
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
        ) : null}
        {canWrite && !edit ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('emailBlocks.new.title')}</CardTitle>
            </CardHeader>
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
              <Button
                size="sm"
                onClick={() =>
                  void run(async () => {
                    await newsletterClient.createBlock({
                      code,
                      name,
                      content: createContent as Record<string, unknown>,
                    });
                    setCode('');
                    setName('');
                    setCreateContent(emptyData);
                  })
                }
              >
                {t('emailBlocks.create')}
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </EmailVariablesProvider>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">{t('common.column.code')}</th>
                <th className="p-3 font-medium">{t('common.column.name')}</th>
                <th className="p-3 font-medium">{t('emailBlocks.column.active')}</th>
                <th className="p-3 font-medium">{t('emailBlocks.column.system')}</th>
                {canWrite ? <th className="p-3 font-medium">{t('common.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3 font-mono text-xs">{b.code}</td>
                  <td className="p-3">{b.name}</td>
                  <td className="p-3">{b.active ? t('common.yes') : '—'}</td>
                  <td className="p-3">{b.isSystem ? t('common.yes') : '—'}</td>
                  {canWrite ? (
                    <td className="p-3">
                      <div className="flex gap-1">
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
                    </td>
                  ) : null}
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={canWrite ? 5 : 4}>
                    {t('emailBlocks.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default BlocksPage;
