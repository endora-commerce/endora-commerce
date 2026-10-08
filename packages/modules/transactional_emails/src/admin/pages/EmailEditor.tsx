import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import type {
  SalesChannelListResponse,
  TransactionalEmailDetail,
} from '@endora-commerce/contracts';
import { apiClient, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Label, PageHeader, SaveButtonGroup, Select } from '@endora-commerce/admin-kit/ui';
import { transactionalEmailsClient } from '../api/transactional-emails-client.js';
import {
  EmailSubjectWithVariables,
  EmailVariablesProvider,
  mergeEmailVariables,
  saveCanvasAsEmailTemplate,
  listEmailTemplatesForApply,
  loadEmailTemplateCanvas,
} from '@endora-commerce/page-builder-admin/email';
import { PageBuilderEditorLayout } from '@endora-commerce/page-builder-admin';
import { EmailEditorPane } from '../components/EmailEditorPane.js';

/**
 * List sales channels (feature 091, P6).
 *
 * The request is built here rather than through `sales_channels`' own admin
 * API client: that client is another module's **code**, which is what the
 * cross-module ledger recorded, while `/api/v1/admin/sales-channels` and
 * `SalesChannelListResponse` are an HTTP path and a
 * `@endora-commerce/contracts` type that both sides already compile. That is
 * the exit P2 established and `admin-kit-surface.md` R6 records — one `GET`
 * out of that client's ten methods, and no dependency on the owner's code.
 */
function listActiveSalesChannels(): Promise<SalesChannelListResponse> {
  return apiClient.get<SalesChannelListResponse>('/api/v1/admin/sales-channels?activeOnly=true');
}

const emptyData: Data = { root: { props: {} }, content: [] };

/**
 * The editor of one transactional e-mail, in the shell every Page Builder
 * editor shares — and the one shape of it with **no settings panel**.
 *
 * A CMS page or a blog post has fields that describe the entity (a name, a
 * slug, a scope), and those go into a panel that can be put away. This screen
 * has none of that kind. The sales channel and the language say **which
 * message** is on the canvas — the shop-wide default or one channel's override
 * — and editing the wrong one is the expensive mistake here; the subject is the
 * first line of the message and the one field a save is refused without. So all
 * three stay on the row above the canvas, always in sight, and what the shell
 * gives this screen is the rest: the full editor width and a canvas that starts
 * on the first screen instead of under three stacked cards.
 */
export function EmailEditor(): React.ReactElement {
  const t = useTranslation('transactional_emails');
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('transactional_emails:write');

  const [channels, setChannels] = useState<Array<{ id: string; code: string }>>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>('');
  const [detail, setDetail] = useState<TransactionalEmailDetail | null>(null);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState<Data>(emptyData);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subjectMissing, setSubjectMissing] = useState(false);

  useEffect(() => {
    let live = true;
    void listActiveSalesChannels().then((res) => {
      if (live) setChannels(res.items.map((c) => ({ id: c.id, code: c.code })));
    });
    return () => {
      live = false;
    };
  }, []);

  const load = useCallback(
    async (lang?: string) => {
      setError(null);
      try {
        const d = await transactionalEmailsClient.get(code, channelId, lang || undefined);
        setDetail(d);
        setLanguage(d.scope.language);
        setSubject(d.effective.subject);
        setContent(d.effective.content as Data);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [code, channelId],
  );

  useEffect(() => {
    void load(language || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, channelId]);

  const save = async (): Promise<boolean> => {
    setNotice(null);
    // The API refuses an empty subject with a generic validation error. Say
    // which field, and put the cursor in it, before the request is made.
    if (subject.trim().length === 0) {
      setError(t('editor.subjectRequired'));
      setSubjectMissing(true);
      document.getElementById('te-subject')?.focus();
      return false;
    }
    setSubjectMissing(false);
    setBusy(true);
    setError(null);
    try {
      await transactionalEmailsClient.saveContent(code, channelId, language, { subject, content });
      setNotice(t('editor.saved'));
      await load(language);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveAndExit = async (): Promise<void> => {
    if (await save()) navigate('/transactional-emails');
  };

  const reset = async (): Promise<void> => {
    if (!window.confirm(t('editor.resetConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await transactionalEmailsClient.resetContent(code, channelId, language);
      setNotice(t('editor.resetDone'));
      await load(language);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!hasPermission('transactional_emails:read')) {
    return (
      <Alert>
        <AlertDescription>{t('editor.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <EmailVariablesProvider variables={mergeEmailVariables(detail?.variables)}>
      <PageBuilderEditorLayout
        header={
          <>
            <PageHeader
              title={detail?.name ?? code}
              description={t('editor.source', { source: detail?.effective.source ?? '—' })}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={() => void reset()} disabled={!canWrite || busy}>
                    {t('editor.reset')}
                  </Button>
                  <SaveButtonGroup
                    onSave={() => void save()}
                    onSaveAndExit={() => void saveAndExit()}
                    saving={busy}
                    disabled={!canWrite}
                    saveLabel={t('editor.save')}
                    savingLabel={t('editor.save')}
                    saveAndExitLabel={t('editor.saveAndExit')}
                  />
                </div>
              }
            />
            {error ? (
              <Alert id="te-error" variant="destructive">
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
          // One row in reading order: which message, in which language, and
          // its first line. It wraps rather than shrinks the subject.
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="te-scope">{t('editor.scope')}</Label>
              <Select
                id="te-scope"
                value={channelId ?? ''}
                onChange={(e) => setChannelId(e.target.value === '' ? null : e.target.value)}
              >
                <option value="">{t('scope.global')}</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="te-lang">{t('editor.language')}</Label>
              <Select
                id="te-lang"
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  void load(e.target.value);
                }}
              >
                {(detail?.languages ?? []).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-[18rem] flex-1 space-y-1">
              <Label htmlFor="te-subject">{t('editor.subject')}</Label>
              <EmailSubjectWithVariables
                id="te-subject"
                value={subject}
                onChange={(next) => {
                  setSubject(next);
                  if (subjectMissing && next.trim().length > 0) {
                    setSubjectMissing(false);
                    setError(null);
                  }
                }}
                disabled={!canWrite}
                invalid={subjectMissing}
                describedBy="te-error"
              />
            </div>
          </div>
        }
        builderLabel={t('editor.content')}
        builder={
          <EmailEditorPane
            editorKey={`${code}:${channelId ?? 'global'}:${language}`}
            data={content}
            onChange={setContent}
            salesChannelId={channelId}
            previewLanguage={language || null}
            onSaveAsTemplate={async (meta, canvasData) => {
              await saveCanvasAsEmailTemplate({
                ...meta,
                data: canvasData,
                salesChannelIds: channelId ? [channelId] : [],
                languages: detail?.languages?.length ? detail.languages : [language || 'en-US'],
                activeLanguage: language || null,
              });
            }}
            onListTemplatesForApply={() => listEmailTemplatesForApply(channelId)}
            onResolveTemplateLayout={(templateId) => loadEmailTemplateCanvas(templateId, language || null)}
          />
        }
      />
    </EmailVariablesProvider>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default EmailEditor;
