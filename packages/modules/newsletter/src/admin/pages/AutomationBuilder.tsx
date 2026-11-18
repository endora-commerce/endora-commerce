import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import type {
  AutomationDetail,
  AutomationStep,
  AutomationTriggerType,
  NewsletterCustomField,
  NewsletterTag,
} from '@endora-commerce/contracts';
import { isDraftEqual, useAuth } from '@endora-commerce/admin-kit/lib';
import { UnsavedChangesHint, useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, FormField, Input, PageHeader, Select } from '@endora-commerce/admin-kit/ui';
import {
  EmailEditorPane,
  EmailSubjectWithVariables,
  EmailVariablesProvider,
  listEmailTemplatesForApply,
  loadEmailTemplateCanvas,
  saveCanvasAsEmailTemplate,
} from '@endora-commerce/page-builder-admin/email';
import { newsletterVariables } from '../email-variables.js';
import { newsletterClient } from '../api/newsletter-client.js';
import { automationTriggerLabels } from '../lib/labels.js';

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

/** What a save sends, from the builder's fields (issue #1461: what `dirty` compares). */
interface AutomationDraft {
  name: string;
  triggerType: AutomationTriggerType;
  triggerTagIds: string[];
  steps: LocalStep[];
}

const blankDraft: AutomationDraft = {
  name: '',
  triggerType: 'all',
  triggerTagIds: [],
  steps: [{ type: 'send', subject: '', content: emptyData }],
};

function draftOf(detail: AutomationDetail | null): AutomationDraft {
  if (!detail) return blankDraft;
  return {
    name: detail.name,
    triggerType: detail.triggerType,
    triggerTagIds: detail.triggerTagIds,
    steps: fromApiSteps(detail.steps),
  };
}

export function AutomationBuilder(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const tc = useTranslation('core');
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
      setNotice(t('common.saved'));
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
      setNotice(t('automation.activated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Issue #1461 (CONTENT-02) — the fields and every step against the last saved automation.
  const dirty =
    (isNew || detail !== null) &&
    !isDraftEqual({ name, triggerType, triggerTagIds, steps }, draftOf(detail));
  const unsavedGuard = useUnsavedChangesGuard({
    dirty,
    onSave: canWrite ? async () => (await save()) !== null : undefined,
    onDiscard: () => {
      const saved = draftOf(detail);
      setName(saved.name);
      setTriggerType(saved.triggerType);
      setTriggerTagIds(saved.triggerTagIds);
      setSteps(saved.steps);
    },
  });

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
      <PageHeader
        title={isNew ? t('automations.new') : name || t('automation.titleFallback')}
        back={{ label: t('automation.back'), to: '/newsletter/automations' }}
        actions={
          canWrite ? (
            <>
              <UnsavedChangesHint dirty={dirty} />
              <Button variant="outline" onClick={() => void save()}>
                {tc('common.action.save')}
              </Button>
              <Button onClick={() => void activate()}>{t('automations.action.activate')}</Button>
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
        <Alert live="polite">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('automation.trigger.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label={t('automation.field.name')} className="max-w-md">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
          </FormField>
          <FormField label={t('automation.field.trigger')} className="max-w-xs">
            <Select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as AutomationTriggerType)}
              disabled={!canWrite}
            >
              {automationTriggerLabels.options(t).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
          {(triggerType === 'tag' || triggerType === 'tag_list') ? (
            <FormField label={t('automation.field.triggerTags')} group>
              <div className="flex flex-wrap gap-3">
                {tags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={triggerTagIds.includes(tag.id)}
                      onChange={(e) =>
                        setTriggerTagIds((prev) => (e.target.checked ? [...prev, tag.id] : prev.filter((x) => x !== tag.id)))
                      }
                      disabled={!canWrite}
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            </FormField>
          ) : null}
        </CardContent>
      </Card>

      <EmailVariablesProvider variables={variables}>
        <Card>
          <CardHeader>
            <CardTitle>{t('automation.steps.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.map((step, idx) => (
              <div key={idx} className="rounded border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {t(step.type === 'send' ? 'automation.step.send' : 'automation.step.wait', { index: idx + 1 })}
                  </span>
                  {canWrite ? (
                    <span className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={idx === 0}
                        aria-label={t('automation.step.moveUp', { index: idx + 1 })}
                        onClick={() => move(idx, -1)}
                      >
                        <span aria-hidden="true">↑</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={idx === steps.length - 1}
                        aria-label={t('automation.step.moveDown', { index: idx + 1 })}
                        onClick={() => move(idx, 1)}
                      >
                        <span aria-hidden="true">↓</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('automation.step.remove', { index: idx + 1 })}
                        onClick={() => setSteps((p) => p.filter((_, i) => i !== idx))}
                      >
                        <span aria-hidden="true">✕</span>
                      </Button>
                    </span>
                  ) : null}
                </div>
                {step.type === 'send' ? (
                  <>
                    <FormField label={t('automation.step.subject')}>
                      {(control) => (
                        <EmailSubjectWithVariables
                          id={control.id}
                          describedBy={control['aria-describedby']}
                          value={step.subject}
                          onChange={(subject) =>
                            setSteps((p) => p.map((s, i) => (i === idx && s.type === 'send' ? { ...s, subject } : s)))
                          }
                          disabled={!canWrite}
                        />
                      )}
                    </FormField>
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
                  <FormField label={t('automation.step.days')} className="max-w-[10rem]">
                    <Input
                      type="number"
                      min={1}
                      value={step.days}
                      onChange={(e) =>
                        setSteps((p) =>
                          p.map((s, i) => (i === idx && s.type === 'wait' ? { ...s, days: Number(e.target.value) } : s)),
                        )
                      }
                      disabled={!canWrite}
                    />
                  </FormField>
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
                  {t('automation.step.addSend')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSteps((p) => [...p, { type: 'wait', days: 1 }])}>
                  {t('automation.step.addWait')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </EmailVariablesProvider>
      {unsavedGuard.dialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default AutomationBuilder;
