import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import type { EmailBlockDetail, EmailTemplateDetail } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Label, PageHeader, SaveButtonGroup, Select } from '@endora-commerce/admin-kit/ui';
import { transactionalEmailsClient } from '../api/transactional-emails-client.js';
import {
  EmailVariablesProvider,
  mergeEmailVariables,
  saveCanvasAsEmailTemplate,
  listEmailTemplatesForApply,
  loadEmailTemplateCanvas,
} from '@endora-commerce/page-builder-admin/email';
import { PageBuilderEditorLayout } from '@endora-commerce/page-builder-admin';
import { EmailEditorPane } from '../components/EmailEditorPane.js';

const emptyData: Data = { root: { props: {} }, content: [] };

type Detail = EmailBlockDetail | EmailTemplateDetail;

export interface EmailFragmentEditorProps {
  kind: 'block' | 'template';
}

/**
 * In-admin content editor for a reusable email block or template (feature 047,
 * US3). Editing a fragment's content updates every email that embeds it.
 *
 * Laid out in the shell every Page Builder editor shares, in its panel-less
 * shape: the one field beside the canvas is the language, and that says which
 * content is on the canvas, so it stays on the row above it.
 */
export function EmailFragmentEditor({ kind }: EmailFragmentEditorProps): React.ReactElement {
  const t = useTranslation('transactional_emails');
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('transactional_emails:write');

  const [detail, setDetail] = useState<Detail | null>(null);
  const [language, setLanguage] = useState('');
  const [content, setContent] = useState<Data>(emptyData);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = kind === 'block'
        ? await transactionalEmailsClient.getBlock(id)
        : await transactionalEmailsClient.getTemplate(id);
      setDetail(d);
      const firstLang = language || d.languages[0] || 'en-US';
      setLanguage(firstLang);
      setContent((d.content[firstLang] as Data) ?? emptyData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id, kind, language]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  const switchLanguage = (lang: string): void => {
    setLanguage(lang);
    setContent((detail?.content[lang] as Data) ?? emptyData);
  };

  const save = async (): Promise<boolean> => {
    if (!detail) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = { content, expectedVersion: detail.version };
      const updated = kind === 'block'
        ? await transactionalEmailsClient.putBlockContent(id, language, body)
        : await transactionalEmailsClient.putTemplateContent(id, language, body);
      setDetail(updated);
      setNotice(t('editor.saved'));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveAndExit = async (): Promise<void> => {
    if (await save()) {
      navigate(kind === 'block' ? '/transactional-emails/blocks' : '/transactional-emails/templates');
    }
  };

  if (!hasPermission('transactional_emails:read')) {
    return (
      <Alert>
        <AlertDescription>{t('editor.noPermissionContent')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <EmailVariablesProvider variables={mergeEmailVariables([])}>
      <PageBuilderEditorLayout
        header={
          <>
            <PageHeader
              title={detail?.name ?? id}
              description={kind === 'block' ? t('editor.blockContent') : t('editor.templateContent')}
              actions={
                <SaveButtonGroup
                  onSave={() => void save()}
                  onSaveAndExit={() => void saveAndExit()}
                  saving={busy}
                  disabled={!canWrite}
                  saveLabel={t('editor.save')}
                  savingLabel={t('editor.save')}
                  saveAndExitLabel={t('editor.saveAndExit')}
                />
              }
            />
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {/* A live region that is there before it has anything to say, so
                the result of a save is announced and not only shown. */}
            <div role="status">
              {notice ? (
                <Alert role="none">
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </>
        }
        canvasBar={
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="frag-lang">{t('editor.language')}</Label>
              <Select id="frag-lang" value={language} onChange={(e) => switchLanguage(e.target.value)}>
                {(detail?.languages ?? []).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        }
        builderLabel={t('editor.content')}
        builder={
          <EmailEditorPane
            editorKey={`${kind}:${id}:${language}`}
            data={content}
            onChange={setContent}
            {...(canWrite
              ? {
                  onSaveAsTemplate: async (
                    meta: { name: string; code: string },
                    canvasData: Data,
                  ) => {
                    await saveCanvasAsEmailTemplate({
                      ...meta,
                      data: canvasData,
                      salesChannelIds: [],
                      languages: detail?.languages?.length ? detail.languages : [language || 'en-US'],
                      activeLanguage: language || null,
                    });
                  },
                }
              : {})}
            onListTemplatesForApply={() => listEmailTemplatesForApply(null)}
            onResolveTemplateLayout={(templateId) => loadEmailTemplateCanvas(templateId, language || null)}
          />
        }
      />
    </EmailVariablesProvider>
  );
}
