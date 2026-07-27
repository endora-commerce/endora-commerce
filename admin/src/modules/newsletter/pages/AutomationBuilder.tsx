import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@measured/puck';
import type {
  AutomationDetail,
  AutomationStep,
  AutomationTriggerType,
  NewsletterCustomField,
  NewsletterTag,
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

type LocalStep =
  | { type: 'send'; subject: string; content: Data }
  | { type: 'wait'; days: number };

function toApiSteps(steps: LocalStep[]): AutomationStep[] {
  return steps.map((s) =>
    s.type === 'send'
      ? { type: 'send', subject: s.subject, content: s.content as Record<string, unknown> }
      : { type: 'wait', days: s.days },
  );
}

function fromApiSteps(steps: AutomationStep[]): LocalStep[] {
  return steps.map((s) => {
    if (s.type === 'wait') return { type: 'wait', days: s.days };
    return {
      type: 'send',
      subject: s.subject,
      content: (s.content as Data) ?? emptyData,
    };
  });
}

export function AutomationBuilder(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('newsletter:write');

  const [detail, setDetail] = useState<AutomationDetail | null>(null);
  const [tags, setTags] = useState<NewsletterTag[]>([]);
  const [customFields, setCustomFields] = useState<NewsletterCustomField[]>([]);
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('all');
  const [triggerTagIds, setTriggerTagIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<LocalStep[]>([{ type: 'send', subject: '', content: emptyData }]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    newsletterClient.listTags().then((r) => setTags(r.items)).catch(() => undefined);
    newsletterClient
      .listCustomFields()
      .then((r) => setCustomFields(r.items))
      .catch(() => undefined);
    if (!isNew && id) {
      newsletterClient
        .getAutomation(id)
        .then((a) => {
          setDetail(a);
          setName(a.name);
          setTriggerType(a.triggerType);
          setTriggerTagIds(a.triggerTagIds);
          setSteps(fromApiSteps(a.steps));
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }
  }, [id, isNew]);

  function move(idx: number, dir: -1 | 1): void {
    setSteps((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j]!, next[idx]!];
      return next;
    });
  }

  async function save(): Promise<AutomationDetail | null> {
    setError(null);
    try {
      const payload = {
        name,
        triggerType,
        triggerTagIds,
        language: detail?.language ?? 'en-US',
        reentryPolicy: detail?.reentryPolicy ?? ('once' as const),
        steps: toApiSteps(steps),
      };
      const saved = isNew
        ? await newsletterClient.createAutomation(payload)
        : await newsletterClient.updateAutomation(id!, { ...payload, expectedVersion: detail!.version });
      setDetail(saved);
      setNotice('Saved.');
      if (isNew) navigate(`/newsletter/automations/${saved.id}`, { replace: true });
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async function activate(): Promise<void> {
    const saved = (await save()) ?? detail;
    if (!saved) return;
    try {
      const a = await newsletterClient.activateAutomation(saved.id, saved.version);
      setDetail(a);
      setNotice('Activated.');
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
        title={isNew ? 'New automation' : name || 'Automation'}
        back={{ label: 'Automations', to: '/newsletter/automations' }}
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => void save()}>
                Save
              </Button>
              <Button onClick={() => void activate()}>Activate</Button>
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

      <Card>
        <CardHeader>
          <CardTitle>Trigger</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Automation name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
          <select
            className="border rounded px-2 py-1 text-sm"
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
            disabled={!canWrite}
          >
            <option value="all">All subscribers</option>
            <option value="tag">Tag</option>
            <option value="tag_list">Tag list</option>
          </select>
          {(triggerType === 'tag' || triggerType === 'tag_list') ? (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <label key={t.id} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={triggerTagIds.includes(t.id)}
                    onChange={(e) =>
                      setTriggerTagIds((prev) => (e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id)))
                    }
                    disabled={!canWrite}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <EmailVariablesProvider variables={variables}>
        <Card>
          <CardHeader>
            <CardTitle>Steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.map((step, idx) => (
              <div key={idx} className="rounded border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {idx + 1}. {step.type === 'send' ? 'Send email' : 'Wait'}
                  </span>
                  {canWrite ? (
                    <span className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => move(idx, -1)}>
                        ↑
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => move(idx, 1)}>
                        ↓
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setSteps((p) => p.filter((_, i) => i !== idx))}>
                        ✕
                      </Button>
                    </span>
                  ) : null}
                </div>
                {step.type === 'send' ? (
                  <>
                    <EmailSubjectWithVariables
                      value={step.subject}
                      onChange={(subject) =>
                        setSteps((p) => p.map((s, i) => (i === idx && s.type === 'send' ? { ...s, subject } : s)))
                      }
                      disabled={!canWrite}
                      placeholder="Subject"
                    />
                    <EmailEditorPane
                      editorKey={`automation:${id ?? 'new'}:step:${idx}`}
                      data={step.content}
                      onChange={(content) =>
                        setSteps((p) => p.map((s, i) => (i === idx && s.type === 'send' ? { ...s, content } : s)))
                      }
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
                  </>
                ) : (
                  <label className="flex items-center gap-2 text-sm">
                    Wait
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      value={step.days}
                      onChange={(e) =>
                        setSteps((p) =>
                          p.map((s, i) => (i === idx && s.type === 'wait' ? { ...s, days: Number(e.target.value) } : s)),
                        )
                      }
                      disabled={!canWrite}
                    />
                    days
                  </label>
                )}
              </div>
            ))}
            {canWrite ? (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSteps((p) => [...p, { type: 'send', subject: '', content: emptyData }])}
                >
                  + Send email
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSteps((p) => [...p, { type: 'wait', days: 1 }])}>
                  + Wait
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </EmailVariablesProvider>
    </div>
  );
}
