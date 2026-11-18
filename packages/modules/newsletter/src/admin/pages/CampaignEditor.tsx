import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import type {
  CampaignDetail,
  CampaignTargetType,
  NewsletterCustomField,
  NewsletterTag,
  SubscriberSummary,
} from '@endora-commerce/contracts';
import { ApiError, isDraftEqual, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { ConfirmDialog, UnsavedChangesHint, useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
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
import { campaignTargetLabels } from '../lib/labels.js';
import { useChannelLanguages } from '../lib/use-channel-languages.js';

const emptyData: Data = { root: { props: {} }, content: [] };

/** What a save sends, from the editor's fields (issue #1461: what `dirty` compares). */
interface CampaignDraft {
  name: string;
  language: string;
  subject: string;
  content: Data;
  targetType: CampaignTargetType;
  targetTagIds: string[];
}

const blankDraft: CampaignDraft = {
  name: '',
  language: 'en-US',
  subject: '',
  content: emptyData,
  targetType: 'all',
  targetTagIds: [],
};

function draftOf(campaign: CampaignDetail | null): CampaignDraft {
  if (!campaign) return blankDraft;
  return {
    name: campaign.name,
    language: campaign.language,
    subject: campaign.subject,
    content: asData(campaign.content),
    targetType: campaign.targetType,
    targetTagIds: campaign.targetTagIds,
  };
}

function asData(content: Record<string, unknown> | undefined): Data {
  if (!content || typeof content !== 'object') return emptyData;
  return content as Data;
}

/**
 * The words the send confirmation uses for a campaign's audience (issue #1462):
 * which kind of audience, and — for tag targeting — the tags by name, so the
 * operator reads the target they chose rather than a mode.
 */
function describeAudience(
  campaign: Pick<CampaignDetail, 'targetType' | 'targetTagIds'>,
  tags: readonly Pick<NewsletterTag, 'id' | 'name'>[],
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (campaign.targetType === 'all') return t('campaign.send.audience.all');
  if (campaign.targetType === 'group') return t('campaign.send.audience.group');
  const names = campaign.targetTagIds.map((id) => tags.find((tag) => tag.id === id)?.name ?? id);
  return t('campaign.send.audience.tag', { tags: names.join(', ') });
}

export function CampaignEditor(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const t = useTranslation('newsletter');
  const tc = useTranslation('core');
  const { language: uiLanguage } = useTranslationContext();
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
  // The saved campaign the send confirmation is asking about, while it is open.
  const [sendTarget, setSendTarget] = useState<CampaignDetail | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

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
      setGroupTouched(false);
      setNotice(t('common.saved'));
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

  /**
   * *Send* saves first — the confirmation must describe what will go out — and
   * then asks (issue #1462). A failed save stops here with its error on the
   * page, rather than sending the last saved version behind the operator's
   * back; an audience that reaches nobody is refused before anything is asked.
   */
  async function requestSend(): Promise<void> {
    const saved = await save();
    if (!saved) return;
    // The dialog is the answer to *Send*; a "Saved." notice beside it is noise.
    setNotice(null);
    if (saved.audienceEstimate === 0) {
      setError(t('campaign.send.noAudience'));
      return;
    }
    setSendError(null);
    setSendTarget(saved);
  }

  async function confirmSend(target: CampaignDetail): Promise<void> {
    setSending(true);
    setSendError(null);
    try {
      const sent = await newsletterClient.sendCampaign(target.id, target.version);
      setCampaign(sent);
      setSendTarget(null);
      setNotice(t(sent.status === 'sent' ? 'campaign.send.notice.sent' : 'campaign.send.notice.queued'));
    } catch (err) {
      // The error stays in the dialog, next to the button that will retry it.
      setSendError(err instanceof ApiError ? err.envelope.error.message : t('campaign.send.failed'));
    } finally {
      setSending(false);
    }
  }

  function sendConfirmation(target: CampaignDetail): React.ReactNode {
    const audience = describeAudience(target, tags, t);
    const subjectText = target.subject;
    if (target.audienceEstimate === null) {
      return (
        <ConfirmDialog
          title={t('campaign.send.title')}
          message={t('campaign.send.messageUnknown', { subject: subjectText, audience })}
          confirmLabel={t('campaign.send.confirmUnknown')}
          destructive
          busy={sending}
          error={sendError}
          onConfirm={() => void confirmSend(target)}
          onCancel={() => setSendTarget(null)}
        />
      );
    }
    const form = new Intl.PluralRules(uiLanguage).select(target.audienceEstimate);
    const count = new Intl.NumberFormat(uiLanguage).format(target.audienceEstimate);
    return (
      <ConfirmDialog
        title={t('campaign.send.title')}
        message={t(`campaign.send.message.${form}`, { subject: subjectText, count, audience })}
        confirmLabel={t(`campaign.send.confirm.${form}`, { count })}
        destructive
        busy={sending}
        error={sendError}
        onConfirm={() => void confirmSend(target)}
        onCancel={() => setSendTarget(null)}
      />
    );
  }

  // Issue #1461 (CONTENT-02) — the fields and canvas against the last saved campaign.
  const current: CampaignDraft = { name, language, subject, content, targetType, targetTagIds };
  const dirty = (isNew || campaign !== null) && (groupTouched || !isDraftEqual(current, draftOf(campaign)));
  const unsavedGuard = useUnsavedChangesGuard({
    dirty,
    onSave: canWrite ? async () => (await save()) !== null : undefined,
    onDiscard: () => {
      const saved = draftOf(campaign);
      setName(saved.name);
      setLanguage(saved.language);
      setSubject(saved.subject);
      setContent(saved.content);
      setTargetType(saved.targetType);
      setTargetTagIds(saved.targetTagIds);
      setGroupTouched(false);
    },
  });

  // Issue #1463 — the languages the shop's channels offer, not a free-text code.
  const languages = useChannelLanguages(language);

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
        title={isNew ? t('campaigns.new') : name || t('campaign.titleFallback')}
        back={{ label: t('campaign.back'), to: '/newsletter/campaigns' }}
        actions={
          canWrite ? (
            <>
              <UnsavedChangesHint dirty={dirty} />
              {!isNew ? (
                <Button asChild variant="outline">
                  <Link to={`/newsletter/campaigns/${id}/stats`}>{t('campaign.action.stats')}</Link>
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => void doPreview()}>
                {t('campaign.action.preview')}
              </Button>
              <Button variant="outline" onClick={() => void save()}>
                {tc('common.action.save')}
              </Button>
              <Button onClick={() => void requestSend()} disabled={sending}>
                {t('campaign.action.send')}
              </Button>
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

      {/* The audience comes first, so the target is chosen before composing (Serial Position, #1462). */}
      <Card>
        <CardHeader>
          <CardTitle>{t('campaign.audience.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label={t('campaign.field.audience')} className="max-w-xs">
            <Select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as CampaignTargetType)}
              disabled={!canWrite}
            >
              {campaignTargetLabels.options(t).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormField>
          {(targetType === 'tag' || targetType === 'tag_list') ? (
            tags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('campaign.audience.noTags')}{' '}
                <Link to="/newsletter/tags" className="underline">
                  {t('campaign.audience.createTags')}
                </Link>
              </p>
            ) : (
              <FormField
                label={t(targetType === 'tag' ? 'campaign.audience.tag' : 'campaign.audience.tags')}
                group
              >
                <div className="flex flex-wrap gap-3">
                  {tags.map((tag) => (
                    <label key={tag.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        checked={targetTagIds.includes(tag.id)}
                        onChange={(e) =>
                          setTargetTagIds((prev) =>
                            e.target.checked
                              ? targetType === 'tag'
                                ? [tag.id]
                                : [...prev, tag.id]
                              : prev.filter((x) => x !== tag.id),
                          )
                        }
                        disabled={!canWrite}
                      />
                      {tag.name}
                    </label>
                  ))}
                </div>
              </FormField>
            )
          ) : null}
          {targetType === 'group' ? (
            subscribers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('campaign.audience.noSubscribers')}</p>
            ) : (
              <FormField
                label={t('campaign.audience.subscribers')}
                hint={t('campaign.audience.selected', { count: targetSubscriberIds.length })}
                group
              >
                <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border p-2">
                  {subscribers.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
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
              </FormField>
            )
          ) : null}
        </CardContent>
      </Card>

      <EmailVariablesProvider variables={variables}>
        <Card>
          <CardHeader>
            <CardTitle>{t('campaign.content.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-start gap-3">
              <FormField label={t('campaign.field.name')} className="w-full max-w-md">
                <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
              </FormField>
              <FormField label={t('campaign.field.language')} className="w-full max-w-[12rem]">
                <Select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!canWrite}>
                  {languages.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <FormField label={t('campaign.field.subject')}>
              {(control) => (
                <EmailSubjectWithVariables
                  id={control.id}
                  describedBy={control['aria-describedby']}
                  value={subject}
                  onChange={setSubject}
                  disabled={!canWrite}
                />
              )}
            </FormField>
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

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('campaign.preview.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <iframe title={t('campaign.preview.frame')} sandbox="" srcDoc={preview} className="h-96 w-full rounded border" />
          </CardContent>
        </Card>
      ) : null}
      {sendTarget ? sendConfirmation(sendTarget) : null}
      {unsavedGuard.dialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CampaignEditor;
