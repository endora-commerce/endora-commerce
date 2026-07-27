import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@measured/puck';
import type {
  CampaignDetail,
  CampaignTargetType,
  NewsletterCustomField,
  NewsletterTag,
  SubscriberSummary,
} from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import {
  EmailEditorPane,
  EmailSubjectWithVariables,
  EmailVariablesProvider,
  listEmailTemplatesForApply,
  loadEmailTemplateCanvas,
  newsletterVariables,
  saveCanvasAsEmailTemplate,
} from '@/modules/_shared/email-builder';
import { newsletterClient } from '../api/newsletter-client';

const emptyData: Data = { root: { props: {} }, content: [] };

function asData(content: Record<string, unknown> | undefined): Data {
  if (!content || typeof content !== 'object') return emptyData;
  return content as Data;
}

export function CampaignEditor(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('newsletter:write');

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [tags, setTags] = useState<NewsletterTag[]>([]);
  const [customFields, setCustomFields] = useState<NewsletterCustomField[]>([]);
  const [subscribers, setSubscribers] = useState<SubscriberSummary[]>([]);
  const [targetSubscriberIds, setTargetSubscriberIds] = useState<string[]>([]);
  const [groupTouched, setGroupTouched] = useState(false);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState<Data>(emptyData);
  const [targetType, setTargetType] = useState<CampaignTargetType>('all');
  const [targetTagIds, setTargetTagIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    newsletterClient.listTags().then((r) => setTags(r.items)).catch(() => undefined);
    newsletterClient
      .listCustomFields()
      .then((r) => setCustomFields(r.items))
      .catch(() => undefined);
    newsletterClient
      .listSubscribers({ status: 'active', pageSize: 200 })
      .then((r) => setSubscribers(r.items))
      .catch(() => undefined);
    if (!isNew && id) {
      newsletterClient
        .getCampaign(id)
        .then((c) => {
          setCampaign(c);
          setName(c.name);
          setLanguage(c.language);
          setSubject(c.subject);
          setContent(asData(c.content));
          setTargetType(c.targetType);
          setTargetTagIds(c.targetTagIds);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }
  }, [id, isNew]);

  async function save(): Promise<CampaignDetail | null> {
    setError(null);
    try {
      const payload = {
        name,
        language,
        subject,
        content: content as Record<string, unknown>,
        targetType,
        targetTagIds,
      };
      let saved = isNew
        ? await newsletterClient.createCampaign(payload)
        : await newsletterClient.updateCampaign(id!, { ...payload, expectedVersion: campaign!.version });
      if (targetType === 'group' && (isNew || groupTouched)) {
        saved = await newsletterClient.setCampaignGroup(saved.id, targetSubscriberIds);
      }
      setCampaign(saved);
      setNotice('Saved.');
      if (isNew) navigate(`/newsletter/campaigns/${saved.id}`, { replace: true });
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async function doPreview(): Promise<void> {
    const saved = campaign ?? (await save());
    if (!saved) return;
    try {
      const r = await newsletterClient.previewCampaign(saved.id);
      setPreview(r.html);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function doSend(): Promise<void> {
    const saved = (await save()) ?? campaign;
    if (!saved) return;
    try {
      const sent = await newsletterClient.sendCampaign(saved.id, saved.version);
      setCampaign(sent);
      setNotice(`Campaign ${sent.status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>You do not have permission to view the newsletter.</AlertDescription>
      </Alert>
    );
  }

  const variables = newsletterVariables(customFields.map((f) => ({ key: f.key, label: f.label })));

  return (
    <div className="space-y-4">
      <PageHeader
        title={isNew ? 'New campaign' : name || 'Campaign'}
        back={{ label: 'Campaigns', to: '/newsletter/campaigns' }}
        actions={
          canWrite ? (
            <>
              {!isNew ? (
                <Link to={`/newsletter/campaigns/${id}/stats`}>
                  <Button variant="outline">Stats</Button>
                </Link>
              ) : null}
              <Button variant="outline" onClick={() => void doPreview()}>
                Preview
              </Button>
              <Button variant="outline" onClick={() => void save()}>
                Save
              </Button>
              <Button onClick={() => void doSend()}>Send</Button>
            </>
          ) : null
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

      <EmailVariablesProvider variables={variables}>
        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
            <Input placeholder="Language (e.g. en-US)" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!canWrite} />
            <EmailSubjectWithVariables
              value={subject}
              onChange={setSubject}
              disabled={!canWrite}
              placeholder="Subject (supports {{var …}})"
            />
            <EmailEditorPane
              editorKey={`campaign:${id ?? 'new'}:${language}`}
              data={content}
              onChange={setContent}
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
                        languages: [language || 'en-US'],
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

      <Card>
        <CardHeader>
          <CardTitle>Audience</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            className="border rounded px-2 py-1 text-sm"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as CampaignTargetType)}
            disabled={!canWrite}
          >
            <option value="all">All subscribers</option>
            <option value="tag">Single tag</option>
            <option value="tag_list">Tag list</option>
            <option value="group">Manual group</option>
          </select>
          {(targetType === 'tag' || targetType === 'tag_list') ? (
            tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tags yet — create tags on the{' '}
                <Link to="/newsletter/tags" className="underline">
                  Tags &amp; fields
                </Link>{' '}
                page first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <p className="w-full text-sm text-muted-foreground">
                  {targetType === 'tag' ? 'Select a tag:' : 'Select one or more tags:'}
                </p>
                {tags.map((t) => (
                  <label key={t.id} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={targetTagIds.includes(t.id)}
                      onChange={(e) =>
                        setTargetTagIds((prev) =>
                          e.target.checked
                            ? targetType === 'tag'
                              ? [t.id]
                              : [...prev, t.id]
                            : prev.filter((x) => x !== t.id),
                        )
                      }
                      disabled={!canWrite}
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )
          ) : null}
          {targetType === 'group' ? (
            subscribers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active subscribers to add to a manual group yet.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Pick the subscribers for this campaign&apos;s manual group:
                </p>
                <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border p-2">
                  {subscribers.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={targetSubscriberIds.includes(s.id)}
                        onChange={(e) => {
                          setGroupTouched(true);
                          setTargetSubscriberIds((prev) =>
                            e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id),
                          );
                        }}
                        disabled={!canWrite}
                      />
                      {s.email}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {targetSubscriberIds.length} selected — saved when you save the campaign.
                </p>
              </div>
            )
          ) : null}
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <iframe title="preview" srcDoc={preview} className="h-96 w-full rounded border" />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
