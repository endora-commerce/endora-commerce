import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Data } from '@measured/puck';
import type {
  SalesChannelListResponse,
  TransactionalEmailDetail,
} from '@endora-commerce/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { SaveButtonGroup } from '@/components/ui/save-button-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { transactionalEmailsClient } from '../api/transactional-emails-client';
import {
  EmailSubjectWithVariables,
  EmailVariablesProvider,
  mergeEmailVariables,
  saveCanvasAsEmailTemplate,
  listEmailTemplatesForApply,
  loadEmailTemplateCanvas,
} from '@endora-commerce/page-builder-admin/email';
import { EmailEditorPane } from '../components/EmailEditorPane';

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

export function EmailEditor(): React.ReactElement {
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
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await transactionalEmailsClient.saveContent(code, channelId, language, { subject, content });
      setNotice('Saved.');
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
    if (!window.confirm('Reset this email to the module default? Your customization for this scope will be removed.')) return;
    setBusy(true);
    setError(null);
    try {
      await transactionalEmailsClient.resetContent(code, channelId, language);
      setNotice('Reset to default.');
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
        <AlertDescription>You do not have permission to view transactional emails.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail?.name ?? code}
        description={`Source: ${detail?.effective.source ?? '—'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void reset()} disabled={!canWrite || busy}>
              Reset to default
            </Button>
            <SaveButtonGroup
              onSave={() => void save()}
              onSaveAndExit={() => void saveAndExit()}
              saving={busy}
              disabled={!canWrite}
              saveLabel="Save"
              savingLabel="Save"
              saveAndExitLabel="Save and exit"
            />
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="te-scope">Scope</Label>
            <Select
              id="te-scope"
              value={channelId ?? ''}
              onChange={(e) => setChannelId(e.target.value === '' ? null : e.target.value)}
            >
              <option value="">All channels (default)</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="te-lang">Language</Label>
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
        </CardContent>
      </Card>

      <EmailVariablesProvider variables={mergeEmailVariables(detail?.variables)}>
        <Card>
          <CardHeader>
            <CardTitle>Subject</CardTitle>
          </CardHeader>
          <CardContent>
            <EmailSubjectWithVariables
              value={subject}
              onChange={setSubject}
              disabled={!canWrite}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </EmailVariablesProvider>
    </div>
  );
}
