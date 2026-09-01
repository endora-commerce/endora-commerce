import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Data } from '@measured/puck';
import type { EmailBlockDetail, EmailTemplateDetail } from '@endora-commerce/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { SaveButtonGroup } from '@/components/ui/save-button-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { transactionalEmailsClient } from '../api/transactional-emails-client';
import {
  EmailVariablesProvider,
  mergeEmailVariables,
  saveCanvasAsEmailTemplate,
  listEmailTemplatesForApply,
  loadEmailTemplateCanvas,
} from '@endora-commerce/page-builder-admin/email';
import { EmailEditorPane } from '../components/EmailEditorPane';

const emptyData: Data = { root: { props: {} }, content: [] };

type Detail = EmailBlockDetail | EmailTemplateDetail;

export interface EmailFragmentEditorProps {
  kind: 'block' | 'template';
}

/**
 * In-admin content editor for a reusable email block or template (feature 047,
 * US3). Editing a fragment's content updates every email that embeds it.
 */
export function EmailFragmentEditor({ kind }: EmailFragmentEditorProps): React.ReactElement {
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
      setNotice('Saved.');
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
        <AlertDescription>You do not have permission to view this content.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={detail?.name ?? id}
        description={kind === 'block' ? 'Email block content' : 'Email template content'}
        actions={
          <SaveButtonGroup
            onSave={() => void save()}
            onSaveAndExit={() => void saveAndExit()}
            saving={busy}
            disabled={!canWrite}
            saveLabel="Save"
            savingLabel="Save"
            saveAndExitLabel="Save and exit"
          />
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
        <CardContent className="flex items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="frag-lang">Language</Label>
            <Select id="frag-lang" value={language} onChange={(e) => switchLanguage(e.target.value)}>
              {(detail?.languages ?? []).map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <EmailVariablesProvider variables={mergeEmailVariables([])}>
        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </EmailVariablesProvider>
    </div>
  );
}
