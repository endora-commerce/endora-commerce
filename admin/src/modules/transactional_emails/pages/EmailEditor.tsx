import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Data } from '@measured/puck';
import type { TransactionalEmailDetail } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { SaveButtonGroup } from '@/components/ui/save-button-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { salesChannelsClient } from '@/modules/sales_channels/api/sales-channels-client';
import { transactionalEmailsClient } from '../api/transactional-emails-client';
import { EmailEditorPane } from '../components/EmailEditorPane';
import { BrandingPanel } from '../components/BrandingPanel';

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
    void salesChannelsClient.list({ activeOnly: true }).then((res) => {
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

  const preview = async (): Promise<void> => {
    try {
      const res = await transactionalEmailsClient.preview(code, {
        ...(channelId ? { salesChannelId: channelId } : {}),
        language,
        draftSubject: subject,
        draftContent: content,
      });
      const w = window.open('', '_blank');
      if (w) {
        w.document.open();
        w.document.write(`<title>${res.subject}</title>${res.html}`);
        w.document.close();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

      <Card>
        <CardHeader>
          <CardTitle>Subject</CardTitle>
        </CardHeader>
        <CardContent>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canWrite} />
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
          />
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <SaveButtonGroup
          onSave={() => void save()}
          onSaveAndExit={() => void saveAndExit()}
          saving={busy}
          disabled={!canWrite}
          saveLabel="Save"
          savingLabel="Save"
          saveAndExitLabel="Save and exit"
        />
        <Button variant="outline" onClick={() => void reset()} disabled={!canWrite || busy}>
          Reset to default
        </Button>
        <Button variant="outline" onClick={() => void preview()}>
          Preview
        </Button>
      </div>

      <BrandingPanel salesChannelId={channelId} />
    </div>
  );
}
