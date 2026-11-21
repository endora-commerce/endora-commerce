import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import {
  gaEventNameSchema,
  type GaCustomEventCreate,
  type GaCustomEventField,
  type GaCustomEventResponse,
  type GaCustomEventUpdate,
  type GaTriggerAction,
  type SalesChannelSummary,
} from '@endora-commerce/contracts';
import { ApiError, isDraftEqual } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
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
import {
  googleAnalyticsClient,
  listSalesChannels,
  type GaActionCatalogue,
} from '../api/google-analytics-client.js';
import { gaTriggerActionLabels, salesChannelLabel } from '../lib/labels.js';

const LIST_PATH = '/google-analytics';
const ALL_CHANNELS = '';
const FIELD_IDS = { eventName: 'ga-event-name', buttonId: 'ga-button-id' } as const;

interface DynamicRow {
  fieldKey: string;
  payloadKey: string;
}

interface Draft {
  eventName: string;
  triggerAction: GaTriggerAction;
  buttonId: string;
  channelCode: string;
  enabled: boolean;
  staticSelected: string[];
  dynamicRows: DynamicRow[];
}

type FieldErrors = Partial<Record<keyof typeof FIELD_IDS, string>>;

const EMPTY_DRAFT: Draft = {
  eventName: '',
  triggerAction: 'add_to_cart',
  buttonId: '',
  channelCode: ALL_CHANNELS,
  enabled: true,
  staticSelected: [],
  dynamicRows: [],
};

function draftOf(ev: GaCustomEventResponse, cat: GaActionCatalogue): Draft {
  const isStatic = cat[ev.triggerAction]?.static !== null;
  return {
    eventName: ev.eventName,
    triggerAction: ev.triggerAction,
    buttonId: ev.buttonId ?? '',
    channelCode: ev.salesChannelCode ?? ALL_CHANNELS,
    enabled: ev.enabled,
    staticSelected: isStatic ? ev.fields.map((f) => f.fieldKey) : [],
    dynamicRows: isStatic ? [] : ev.fields.map((f) => ({ fieldKey: f.fieldKey, payloadKey: f.payloadKey ?? '' })),
  };
}

/**
 * Create / edit one Google Analytics custom event (feature 049, US3).
 *
 * Issue #1537 (UX audit CONTENT-20) — the same editor shape as Meta Ads custom
 * events and LinkedIn Ads conversion mappings: one card of `FormField`s, the
 * one Save as the submit of the kit's sticky bar beside Cancel, Delete in the
 * header's "More" menu (away from Save, asking first — #1464), Enabled as a
 * switch, the sales channel picked by name, a required field refused at Save
 * with its own message, and a refused save said in the bar. A successful Save
 * returns to the list, as in the two sibling editors.
 */
export default function CustomEventEditPage(): ReactNode {
  const t = useTranslation('google_analytics');
  const tc = useTranslation('core');
  const { language } = useTranslationContext();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { confirm, confirmDialog } = useConfirmDialog();
  const isCreate = id === 'new' || id === undefined;

  const [catalogue, setCatalogue] = useState<GaActionCatalogue | null>(null);
  // `null` when the channels could not be read: the field falls back to typing the code.
  const [channels, setChannels] = useState<SalesChannelSummary[] | null>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [saved, setSaved] = useState<Draft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
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
    setLoading(true);
    setLoadError(null);
    // Fire-and-forget: the body catches its own errors.
    void (async () => {
      try {
        const [cat, chans] = await Promise.all([
          googleAnalyticsClient.actionCatalogue(),
          listSalesChannels()
            .then((res) => res.items)
            .catch(() => null),
        ]);
        if (cancelled) return;
        setCatalogue(cat);
        setChannels(chans);
        if (!isCreate) {
          const ev = await googleAnalyticsClient.get(id);
          if (cancelled) return;
          const next = draftOf(ev, cat);
          setSaved(next);
          setDraft(next);
          setVersion(ev.version);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError && err.status === 404 ? t('error.notFound') : messageFor(err),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `t` is stable per language; the load depends on the record only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const staticFields = useMemo(
    () => catalogue?.[draft.triggerAction]?.static ?? null,
    [catalogue, draft.triggerAction],
  );

  const patch = (next: Partial<Draft>): void => setDraft((current) => ({ ...current, ...next }));

  function buildFields(): GaCustomEventField[] {
    if (staticFields !== null) {
      return staticFields
        .filter((k) => draft.staticSelected.includes(k))
        .map((fieldKey, position) => ({ fieldKey, position }));
    }
    return draft.dynamicRows
      .filter((r) => r.fieldKey.trim())
      .map((r, position) => ({
        fieldKey: r.fieldKey.trim(),
        position,
        ...(r.payloadKey.trim() ? { payloadKey: r.payloadKey.trim() } : {}),
      }));
  }

  /** The fields a Save refuses, checked on submit — never on the first keystroke (Postel). */
  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!gaEventNameSchema.safeParse(draft.eventName.trim()).success) next.eventName = t('customEvents.eventNameInvalid');
    if (draft.triggerAction === 'button_click_by_id' && draft.buttonId.trim() === '') {
      next.buttonId = t('customEvents.buttonIdRequired');
    }
    return next;
  }

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const invalid = validate();
    setErrors(invalid);
    const first = (Object.keys(FIELD_IDS) as Array<keyof typeof FIELD_IDS>).find((key) => invalid[key]);
    if (first) {
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    const eventName = draft.eventName.trim();
    const isButton = draft.triggerAction === 'button_click_by_id';
    const channelCode = draft.channelCode.trim();
    try {
      const fields = buildFields();
      if (isCreate) {
        const body: GaCustomEventCreate = {
          eventName,
          triggerAction: draft.triggerAction,
          enabled: draft.enabled,
          fields,
          ...(channelCode ? { salesChannelCode: channelCode } : {}),
          ...(isButton ? { buttonId: draft.buttonId.trim() } : {}),
        };
        await googleAnalyticsClient.create(body);
      } else {
        const body: GaCustomEventUpdate = {
          eventName,
          triggerAction: draft.triggerAction,
          enabled: draft.enabled,
          fields,
          version: version ?? 1,
          salesChannelCode: channelCode ? channelCode : null,
          buttonId: isButton ? draft.buttonId.trim() : null,
        };
        await googleAnalyticsClient.update(id, body);
      }
      navigate(LIST_PATH);
    } catch (err) {
      setSaveError(messageFor(err));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Issue #1464 — Delete asks first, naming the event, and runs inside the
   * dialog; since #1537 it is an entry of the header's "More" menu, the same
   * place as in the Meta and LinkedIn editors, away from Save.
   */
  const remove = async (): Promise<void> => {
    if (isCreate) return;
    const deleted = await confirm({
      title: t('customEvents.deleteConfirm.title'),
      message: t('customEvents.deleteConfirm.message', { name: saved.eventName }),
      confirmLabel: t('customEvents.deleteConfirm.action'),
      destructive: true,
      action: () => googleAnalyticsClient.remove(id),
      describeError: (err) =>
        err instanceof ApiError ? err.envelope.error.message : t('customEvents.deleteConfirm.failed'),
    });
    if (deleted) navigate(LIST_PATH);
  };

  const title = isCreate ? t('customEvents.new') : t('customEvents.edit');

  if (loading) return <DetailSkeleton tabs={false} rows={5} />;
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

  // A stored code the channel list does not hold stays selectable, so it can be seen and replaced.
  const storedCodeMissing =
    channels !== null && draft.channelCode !== ALL_CHANNELS && !channels.some((c) => c.code === draft.channelCode);

  return (
    <>
      <PageHeader
        title={title}
        actions={
          isCreate ? null : (
            <DetailHeaderActions moreDisabled={saving}>
              <RowActionMenuItem destructive onSelect={() => void remove()}>
                {t('customEvents.delete')}
              </RowActionMenuItem>
            </DetailHeaderActions>
          )
        }
      />
      <form noValidate onSubmit={(event) => void save(event)}>
        <Card>
          <CardContent className="space-y-4">
            <FormField label={t('customEvents.triggerAction')} required>
              <Select
                value={draft.triggerAction}
                onChange={(e) =>
                  patch({ triggerAction: e.target.value as GaTriggerAction, staticSelected: [], dynamicRows: [] })
                }
              >
                {gaTriggerActionLabels.options(t).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              id={FIELD_IDS.eventName}
              label={t('customEvents.eventName')}
              hint={t('customEvents.eventNameHint')}
              error={errors.eventName}
              required
            >
              <Input value={draft.eventName} onChange={(e) => patch({ eventName: e.target.value })} />
            </FormField>

            {draft.triggerAction === 'button_click_by_id' ? (
              <FormField id={FIELD_IDS.buttonId} label={t('customEvents.buttonId')} error={errors.buttonId} required>
                <Input value={draft.buttonId} onChange={(e) => patch({ buttonId: e.target.value })} />
              </FormField>
            ) : null}

            <FormField label={t('customEvents.salesChannel')}>
              {channels === null ? (
                <Input
                  value={draft.channelCode}
                  placeholder={t('customEvents.allChannels')}
                  onChange={(e) => patch({ channelCode: e.target.value })}
                />
              ) : (
                <Select value={draft.channelCode} onChange={(e) => patch({ channelCode: e.target.value })}>
                  <option value={ALL_CHANNELS}>{t('customEvents.allChannels')}</option>
                  {channels.map((c) => (
                    <option key={c.code} value={c.code}>
                      {salesChannelLabel(c, language, c.code)}
                    </option>
                  ))}
                  {storedCodeMissing ? <option value={draft.channelCode}>{draft.channelCode}</option> : null}
                </Select>
              )}
            </FormField>

            <FormField label={t('customEvents.fields')} hint={t('customEvents.fieldsHint')} group>
              {staticFields !== null ? (
                <div className="flex flex-col gap-2">
                  {staticFields.map((key) => (
                    <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={draft.staticSelected.includes(key)}
                        onChange={(e) =>
                          patch({
                            staticSelected: e.target.checked
                              ? [...draft.staticSelected, key]
                              : draft.staticSelected.filter((k) => k !== key),
                          })
                        }
                      />
                      <code className="text-xs">{key}</code>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {draft.dynamicRows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        aria-label={t('customEvents.fieldKeyLabel', { n: i + 1 })}
                        placeholder={t('customEvents.fieldKey')}
                        value={row.fieldKey}
                        onChange={(e) =>
                          patch({
                            dynamicRows: draft.dynamicRows.map((r, j) => (j === i ? { ...r, fieldKey: e.target.value } : r)),
                          })
                        }
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">{t('customEvents.sentAs')}</span>
                      <Input
                        aria-label={t('customEvents.payloadKeyLabel', { n: i + 1 })}
                        placeholder={t('customEvents.payloadKeyHint')}
                        value={row.payloadKey}
                        onChange={(e) =>
                          patch({
                            dynamicRows: draft.dynamicRows.map((r, j) => (j === i ? { ...r, payloadKey: e.target.value } : r)),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        aria-label={t('customEvents.removeField', { n: i + 1 })}
                        onClick={() => patch({ dynamicRows: draft.dynamicRows.filter((_, j) => j !== i) })}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => patch({ dynamicRows: [...draft.dynamicRows, { fieldKey: '', payloadKey: '' }] })}
                    >
                      <Plus size={16} aria-hidden="true" />
                      {t('customEvents.addField')}
                    </Button>
                  </div>
                </div>
              )}
            </FormField>

            <FormField label={t('customEvents.enabled')} layout="row">
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
            <Button type="submit" disabled={saving} aria-busy={saving || undefined}>
              {saving ? tc('common.state.saving') : t('customEvents.save')}
            </Button>
          }
        />
      </form>
      {confirmDialog}
      {guard.dialog}
    </>
  );
}
