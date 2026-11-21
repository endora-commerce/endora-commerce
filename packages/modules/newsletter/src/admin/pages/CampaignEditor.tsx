import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import type {
  CampaignDetail,
  CampaignGroupMember,
  CampaignTargetType,
  NewsletterCustomField,
  NewsletterTag,
} from '@endora-commerce/contracts';
import { ApiError, isDraftEqual, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { ConfirmDialog, UnsavedChangesHint, useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  EditorSection,
  FormField,
  InlineStatus,
  Input,
  MultiCombobox,
  PageHeader,
  Select,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
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
import { TagChoice } from '../components/TagChoice.js';

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

/** Whether two manual groups hold the same subscribers, whatever their order. */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

/**
 * Narrowing an audience to a single tag keeps the first tag chosen rather than
 * dropping them all (Tesler's Law: the editor does the trimming, issue #1533).
 */
function tagsForTarget(targetType: CampaignTargetType, tagIds: readonly string[]): string[] {
  return targetType === 'tag' ? tagIds.slice(0, 1) : [...tagIds];
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
  // The manual group (#1533): who can be picked (the active subscribers, at
  // most 200), who is in it as saved, and what the picker holds now. An
  // existing campaign's group is read before it can be edited; until it is,
  // the picker is locked, so a save never replaces a group it has not seen.
  const [subscribers, setSubscribers] = useState<CampaignGroupMember[]>([]);
  const [subscribersLoading, setSubscribersLoading] = useState(true);
  const [groupMembers, setGroupMembers] = useState<CampaignGroupMember[]>([]);
  const [savedGroupIds, setSavedGroupIds] = useState<string[]>([]);
  const [targetSubscriberIds, setTargetSubscriberIds] = useState<string[]>([]);
  const [groupState, setGroupState] = useState<'loading' | 'ready' | 'unavailable'>(isNew ? 'ready' : 'loading');
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en-US');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState<Data>(emptyData);
  const [targetType, setTargetType] = useState<CampaignTargetType>('all');
  const [targetTagIds, setTargetTagIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const status = useInlineStatus();
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
      .then((r) => setSubscribers(r.items.map((s) => ({ id: s.id, email: s.email }))))
      .catch(() => undefined)
      .finally(() => setSubscribersLoading(false));
    if (!isNew && id) {
      newsletterClient
        .getCampaignGroup(id)
        .then((group) => {
          const ids = group.items.map((m) => m.id);
          setGroupMembers(group.items);
          setSavedGroupIds(ids);
          setTargetSubscriberIds(ids);
          setGroupState('ready');
        })
        .catch(() => setGroupState('unavailable'));
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
      const writeGroup =
        targetType === 'group' && groupState === 'ready' && (isNew || !sameMembers(targetSubscriberIds, savedGroupIds));
      if (writeGroup) {
        saved = await newsletterClient.setCampaignGroup(saved.id, targetSubscriberIds);
        setSavedGroupIds(targetSubscriberIds);
      }
      setCampaign(saved);
      status.show(t('common.saved'));
      if (isNew) navigate(`/newsletter/campaigns/${saved.id}`, { replace: true });
      return saved;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
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
    status.clear();
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
      status.show(t(sent.status === 'sent' ? 'campaign.send.notice.sent' : 'campaign.send.notice.queued'));
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
  const groupChanged = targetType === 'group' && !sameMembers(targetSubscriberIds, savedGroupIds);
  const dirty = (isNew || campaign !== null) && (groupChanged || !isDraftEqual(current, draftOf(campaign)));
  // A "Saved" that outlives the next edit would contradict the unsaved hint beside it.
  const { clear: clearStatus } = status;
  useEffect(() => {
    if (dirty) clearStatus();
  }, [dirty, clearStatus]);
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
      setTargetSubscriberIds(savedGroupIds);
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
  // A member who is no longer active is not offered, but stays a named chip.
  const offered = new Set(subscribers.map((s) => s.id));
  const subscriberOptions = [...subscribers, ...groupMembers.filter((m) => !offered.has(m.id))].map((s) => ({
    value: s.id,
    label: s.email,
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title={isNew ? t('campaigns.new') : name || t('campaign.titleFallback')}
        back={{ label: t('campaign.back'), to: '/newsletter/campaigns' }}
        actions={
          canWrite ? (
            <>
              <InlineStatus {...status.props} />
              <UnsavedChangesHint dirty={dirty} />
              {!isNew ? (
                <Button asChild variant="outline">
                  <Link to={`/newsletter/campaigns/${id}/stats`}>{t('campaign.action.stats')}</Link>
                </Button>
              ) : null}
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
      {/*
        Settings first, then the content (#1462, #1533 — Serial Position): what
        the campaign is, in which language, under which subject and to whom are
        decided before composing, and the content card holds only the canvas.
      */}
      <EditorSection chrome="card" title={t('campaign.settings.title')} contentClassName="space-y-4">
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
        <EmailVariablesProvider variables={variables}>
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
        </EmailVariablesProvider>
        <FormField label={t('campaign.field.audience')} className="max-w-xs">
          <Select
            value={targetType}
            onChange={(e) => {
              const next = e.target.value as CampaignTargetType;
              setTargetType(next);
              setTargetTagIds((prev) => tagsForTarget(next, prev));
            }}
            disabled={!canWrite}
          >
            {campaignTargetLabels.options(t).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </FormField>
        {targetType === 'tag' || targetType === 'tag_list' ? (
          tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('campaign.audience.noTags')}{' '}
              <Link to="/newsletter/tags" className="underline">
                {t('campaign.audience.createTags')}
              </Link>
            </p>
          ) : (
            <TagChoice
              mode={targetType === 'tag' ? 'one' : 'many'}
              label={t(targetType === 'tag' ? 'campaign.audience.tag' : 'campaign.audience.tags')}
              tags={tags}
              value={targetTagIds}
              onChange={setTargetTagIds}
              disabled={!canWrite}
            />
          )
        ) : null}
        {targetType === 'group' ? (
          !subscribersLoading && subscriberOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('campaign.audience.noSubscribers')}</p>
          ) : (
            <FormField
              label={t('campaign.audience.subscribers')}
              {...(groupState === 'unavailable'
                ? { description: t('campaign.audience.groupUnavailable') }
                : { hint: t('campaign.audience.selected', { count: targetSubscriberIds.length }) })}
              className="max-w-2xl"
            >
              {(control) => (
                <MultiCombobox
                  id={control.id}
                  ariaDescribedBy={control['aria-describedby']}
                  options={subscriberOptions}
                  value={targetSubscriberIds}
                  onChange={setTargetSubscriberIds}
                  loading={subscribersLoading || groupState === 'loading'}
                  disabled={!canWrite || groupState !== 'ready'}
                  placeholder={t('campaign.audience.searchSubscribers')}
                  emptyMessage={t('campaign.audience.noMatch')}
                />
              )}
            </FormField>
          )
        ) : null}
      </EditorSection>

      <EmailVariablesProvider variables={variables}>
        <EditorSection chrome="card" title={t('campaign.content.title')}>
          <EmailEditorPane
            editorKey={`campaign:${id ?? 'new'}:${language}`}
            data={content}
            onChange={setContent}
            builderContext="newsletter"
            previewLanguage={language}
            {...(canWrite
              ? {
                  onSaveAsTemplate: async (meta: { name: string; code: string }, canvasData: Data) => {
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
        </EditorSection>
      </EmailVariablesProvider>

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
