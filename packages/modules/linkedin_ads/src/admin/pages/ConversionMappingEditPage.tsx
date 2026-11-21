import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  conversionRuleUrnFor,
  linkedInConversionIdSchema,
  type LinkedInTriggerAction,
  type SalesChannelSummary,
} from '@endora-commerce/contracts';
import { ApiError, isDraftEqual } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  DetailSkeleton,
  FormField,
  Input,
  PageHeader,
  Select,
  Switch,
} from '@endora-commerce/admin-kit/ui';
import {
  DetailHeaderActions,
  RowActionMenuItem,
  StickyFormActions,
  useConfirmDialog,
  useUnsavedChangesGuard,
} from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { linkedInAdsClient, listSalesChannels } from '../api/linkedin-ads-client.js';
import { linkedInTriggerActionLabels, salesChannelLabel } from '../lib/labels.js';

const LIST_PATH = '/linkedin-ads';
const ALL_CHANNELS = '__all__';
const CONVERSION_ID_ID = 'linkedin-conversion-id';

interface Draft {
  triggerAction: LinkedInTriggerAction;
  conversionId: string;
  conversionRuleUrn: string;
  salesChannelId: string;
  enabled: boolean;
}

const EMPTY_DRAFT: Draft = {
  triggerAction: 'purchase',
  conversionId: '',
  conversionRuleUrn: '',
  salesChannelId: ALL_CHANNELS,
  enabled: true,
};

/** Campaign Manager shows the ID grouped; accept it pasted with spaces (Postel). */
const normaliseConversionId = (value: string): string => value.replace(/\s+/g, '');

/**
 * Create / edit one conversion mapping (feature 063, US3).
 *
 * Issue #1537 (UX audit CONTENT-20) — the same editor shape as Google
 * Analytics custom events and Meta Ads custom events: one card of
 * `FormField`s, the one Save as the submit of the kit's sticky bar beside
 * Cancel, Delete in the header's "More" menu (away from Save, asking first),
 * Enabled as a switch, the sales channel picked by name, a required field
 * refused at Save with its own message, and a refused save said in the bar. A
 * successful Save returns to the list.
 */
export default function ConversionMappingEditPage(): ReactNode {
  const t = useTranslation('linkedin_ads');
  const tc = useTranslation('core');
  const { language } = useTranslationContext();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === undefined;
  const { confirm, confirmDialog } = useConfirmDialog();

  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [saved, setSaved] = useState<Draft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [conversionIdError, setConversionIdError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = !isDraftEqual(draft, saved);
  const guard = useUnsavedChangesGuard({ dirty });

  const messageFor = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.envelope.error.code === 'VERSION_CONFLICT') return t('error.versionConflict');
      return err.envelope.error.message;
    }
    return t('error.generic');
  };

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      // A channel read failure leaves "All channels" and the stored channel's id.
      const chans = await listSalesChannels().catch(() => ({ items: [] as SalesChannelSummary[] }));
      if (cancelled) return;
      setChannels(chans.items);
      if (isNew) return;
      try {
        const row = await linkedInAdsClient.get(id);
        if (cancelled) return;
        const next: Draft = {
          triggerAction: row.triggerAction,
          conversionId: row.conversionId,
          conversionRuleUrn: row.conversionRuleUrn ?? '',
          salesChannelId: row.salesChannelId ?? ALL_CHANNELS,
          enabled: row.enabled,
        };
        setSaved(next);
        setDraft(next);
        setVersion(row.version);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof ApiError && err.status === 404 ? t('error.notFound') : messageFor(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `t` is stable per language; the load depends on the record only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  const patch = (next: Partial<Draft>): void => setDraft((current) => ({ ...current, ...next }));

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const conversionId = normaliseConversionId(draft.conversionId);
    // Checked on submit, never on the first keystroke (Postel).
    if (!linkedInConversionIdSchema.safeParse(conversionId).success) {
      setConversionIdError(t('mappings.conversionIdInvalid'));
      document.getElementById(CONVERSION_ID_ID)?.focus();
      return;
    }
    setConversionIdError(null);
    setBusy(true);
    setSaveError(null);
    const channel = draft.salesChannelId === ALL_CHANNELS ? null : draft.salesChannelId;
    const conversionRuleUrn = draft.conversionRuleUrn.trim() || null;
    try {
      if (isNew) {
        await linkedInAdsClient.create({
          triggerAction: draft.triggerAction,
          conversionId,
          conversionRuleUrn,
          salesChannelId: channel,
          enabled: draft.enabled,
        });
      } else {
        await linkedInAdsClient.update(id, {
          triggerAction: draft.triggerAction,
          conversionId,
          conversionRuleUrn,
          salesChannelId: channel,
          enabled: draft.enabled,
          version: version ?? 1,
        });
      }
      navigate(LIST_PATH);
    } catch (err) {
      setSaveError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (isNew) return;
    const deleted = await confirm({
      title: t('mappings.deleteConfirm.title'),
      message: t('mappings.deleteConfirm.message', { name: saved.conversionId }),
      confirmLabel: t('mappings.deleteConfirm.action'),
      destructive: true,
      action: () => linkedInAdsClient.remove(id),
      describeError: (err) =>
        err instanceof ApiError ? err.envelope.error.message : t('mappings.deleteConfirm.failed'),
    });
    if (deleted) navigate(LIST_PATH);
  };

  const title = isNew ? t('mappings.new') : t('mappings.edit');

  if (loading) return <DetailSkeleton tabs={false} rows={4} />;
  if (loadError !== null) {
    return (
      <>
        <PageHeader title={title} />
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{loadError}</span>
            <Button asChild variant="outline" size="sm">
              <Link to={LIST_PATH}>{tc('common.action.back')}</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const storedChannelMissing =
    draft.salesChannelId !== ALL_CHANNELS && !channels.some((c) => c.id === draft.salesChannelId);

  return (
    <>
      <PageHeader
        title={title}
        actions={
          isNew ? null : (
            <DetailHeaderActions moreDisabled={busy}>
              <RowActionMenuItem destructive onSelect={() => void remove()}>
                {t('mappings.delete')}
              </RowActionMenuItem>
            </DetailHeaderActions>
          )
        }
      />
      <form noValidate onSubmit={(event) => void save(event)}>
        <Card>
          <CardContent className="space-y-4">
            <FormField label={t('mappings.triggerAction')} required>
              <Select
                value={draft.triggerAction}
                onChange={(e) => patch({ triggerAction: e.target.value as LinkedInTriggerAction })}
              >
                {linkedInTriggerActionLabels.options(t).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              id={CONVERSION_ID_ID}
              label={t('mappings.conversionId')}
              hint={t('mappings.conversionIdHint')}
              error={conversionIdError}
              required
            >
              <Input
                value={draft.conversionId}
                inputMode="numeric"
                onChange={(e) => patch({ conversionId: e.target.value })}
              />
            </FormField>

            {/* The placeholder is the value derived when the field is left
                empty, so the operator sees what is sent without typing it. */}
            <FormField label={t('mappings.conversionRuleUrn')} hint={t('mappings.conversionRuleUrnHint')}>
              <Input
                value={draft.conversionRuleUrn}
                placeholder={conversionRuleUrnFor(normaliseConversionId(draft.conversionId))}
                onChange={(e) => patch({ conversionRuleUrn: e.target.value })}
              />
            </FormField>

            <FormField label={t('mappings.salesChannel')}>
              <Select value={draft.salesChannelId} onChange={(e) => patch({ salesChannelId: e.target.value })}>
                <option value={ALL_CHANNELS}>{t('mappings.allChannels')}</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {salesChannelLabel(c, language, c.code)}
                  </option>
                ))}
                {storedChannelMissing ? <option value={draft.salesChannelId}>{draft.salesChannelId}</option> : null}
              </Select>
            </FormField>

            <FormField label={t('mappings.enabled')} layout="row">
              <Switch checked={draft.enabled} onCheckedChange={(enabled) => patch({ enabled })} />
            </FormField>
          </CardContent>
        </Card>
        <StickyFormActions
          desktop="sticky"
          dirty={dirty}
          error={saveError}
          secondary={
            <Button asChild variant="outline">
              <Link to={LIST_PATH}>{tc('common.action.cancel')}</Link>
            </Button>
          }
          primary={
            <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
              {busy ? tc('common.state.saving') : t('mappings.save')}
            </Button>
          }
        />
      </form>
      {confirmDialog}
      {guard.dialog}
    </>
  );
}
