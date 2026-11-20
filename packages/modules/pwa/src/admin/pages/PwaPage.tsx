import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyRound, Save, Send, Upload } from 'lucide-react';
import type {
  PushAudience,
  PushAudienceRule,
  PwaAdminConfig,
  PwaDisplayMode,
  SalesChannelListResponse,
  SalesChannelSummary,
} from '@endora-commerce/contracts';
import { ApiError, apiClient, useModulePresence } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { ConfirmDialog } from '@endora-commerce/admin-kit/components';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, ColorPicker, FormField, InlineStatus, Input, PageHeader, Select, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { pwaClient } from '../api/pwa-client.js';
import { PushAudienceRuleBuilder } from '../components/PushAudienceRuleBuilder.js';
import { displayModeLabels } from '../lib/labels.js';

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
function listSalesChannels(activeOnly: boolean, pageSize: number): Promise<SalesChannelListResponse> {
  const qs = new URLSearchParams();
  qs.set('activeOnly', String(activeOnly));
  qs.set('pageSize', String(pageSize));
  return apiClient.get<SalesChannelListResponse>(
    `/api/v1/admin/sales-channels?${qs.toString()}`,
  );
}

/** Pick a display label from a multilingual sales-channel name. */
function channelLabel(name: SalesChannelSummary['name'], code: string): string {
  const values = Object.values(name);
  return values[0] ?? code;
}

/**
 * PWA configuration page (feature 046, US2 + US4 admin surface). Edits the
 * global PWA identity + toggles, uploads the icon (sharp-derived sizes),
 * generates VAPID keys, and sends a broadcast push. The Scope selector switches
 * between the global value and a per-Sales-Channel override; a per-channel scope
 * can be reset back to the global value with "Reset to global".
 */
export function PwaPage(): ReactNode {
  const t = useTranslation('pwa');
  // `refresh` reloads on a scope change only, not when the bundle arrives.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const { language } = useTranslationContext();
  // Quote pushes come from `quote_requests` (through `customerPushPort` since
  // `specs/179-rfq-and-customer-notifications/` WP-10): while it is absent no
  // quote push is produced, so the quote switch is not offered, and its stored
  // value is left alone.
  const { isPresent } = useModulePresence();
  const quotesPresent = isPresent('quote_requests');
  const [config, setConfig] = useState<PwaAdminConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each action's result is said beside its own button, in a region mounted
  // before it has text — not one success banner at the top (issue #1499,
  // DEC-12 a). A new action empties every one, so only the latest stands.
  const saveStatus = useInlineStatus();
  const resetStatus = useInlineStatus();
  const iconStatus = useInlineStatus();
  const vapidStatus = useInlineStatus();
  const pushStatus = useInlineStatus();
  const clearResults = (): void => {
    for (const status of [saveStatus, resetStatus, iconStatus, vapidStatus, pushStatus]) status.clear();
  };
  const [stats, setStats] = useState<{ active: number; invalid: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Scope selector — null = global, otherwise a per-channel override.
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  // Send-push form.
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushUrl, setPushUrl] = useState('');
  // Audience targeting — 'all' broadcasts; 'rule' narrows via the Rule Builder.
  const [audienceMode, setAudienceMode] = useState<'all' | 'rule'>('all');
  const [audienceRule, setAudienceRule] = useState<PushAudienceRule>({ kind: 'all' });
  // A push cannot be recalled, so *Send* asks first (issue #1462); the request
  // runs inside the dialog, which keeps its own error.
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [cfg, st] = await Promise.all([
        pwaClient.getConfig(selectedChannelId),
        pwaClient.getSubscriptionStats(selectedChannelId).catch(() => null),
      ]);
      setConfig(cfg);
      setStats(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : tRef.current('settings.loadError'));
    }
  }, [selectedChannelId]);

  // Load the channel list once for the scope selector.
  useEffect(() => {
    void listSalesChannels(true, 200)
      .then((res) => setChannels(res.items))
      .catch(() => setChannels([]));
  }, []);

  // (Re)load config + stats whenever the selected scope changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = (next: Partial<PwaAdminConfig>): void => {
    setConfig((c) => (c ? { ...c, ...next } : c));
  };

  const save = async (): Promise<void> => {
    if (!config) return;
    setBusy(true);
    setError(null);
    clearResults();
    try {
      await pwaClient.updateConfig({
        ...(selectedChannelId ? { salesChannelId: selectedChannelId } : {}),
        appName: config.appName,
        shortName: config.shortName,
        themeColor: config.themeColor,
        backgroundColor: config.backgroundColor,
        displayMode: config.displayMode,
        cachingEnabled: config.cachingEnabled,
        pushEnabled: config.pushEnabled,
        orderStatusPushEnabled: config.orderStatusPushEnabled,
        ...(quotesPresent ? { quoteStatusPushEnabled: config.quoteStatusPushEnabled } : {}),
      });
      saveStatus.show(t('settings.saved'));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const resetToGlobal = async (): Promise<void> => {
    if (!selectedChannelId) return;
    setBusy(true);
    setError(null);
    clearResults();
    try {
      await pwaClient.resetConfig(selectedChannelId);
      resetStatus.show(t('settings.resetDone'));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.resetError'));
    } finally {
      setBusy(false);
    }
  };

  const generateVapid = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    clearResults();
    try {
      await pwaClient.generateVapid();
      vapidStatus.show(t('settings.vapid.generated'));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.vapid.error'));
    } finally {
      setBusy(false);
    }
  };

  const uploadIcon = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    clearResults();
    try {
      await pwaClient.uploadIcon(file, selectedChannelId);
      iconStatus.show(t('settings.icon.uploaded'));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.icon.uploadError'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const targeted = audienceMode === 'rule' && audienceRule.kind !== 'all';

  const requestSend = (): void => {
    // Sends are per-channel: the operator must pick a concrete channel scope.
    if (!selectedChannelId) {
      setError(t('push.selectChannel'));
      return;
    }
    setSendError(null);
    setConfirmingSend(true);
  };

  const sendPush = async (): Promise<void> => {
    if (!selectedChannelId) return;
    setBusy(true);
    setSendError(null);
    clearResults();
    try {
      // A 'rule' audience that resolves to "all" is equivalent to a broadcast.
      const audience: PushAudience = targeted ? { kind: 'rule', rule: audienceRule } : { kind: 'all' };
      const res = await pwaClient.sendMessage({
        salesChannelId: selectedChannelId,
        title: pushTitle,
        body: pushBody,
        ...(pushUrl ? { url: pushUrl } : {}),
        audience,
      });
      setConfirmingSend(false);
      const form = new Intl.PluralRules(language).select(res.queuedDeliveries);
      pushStatus.show(t(`push.queued.${form}`, { count: new Intl.NumberFormat(language).format(res.queuedDeliveries) }));
      setPushTitle('');
      setPushBody('');
      setPushUrl('');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.envelope.error.message : t('push.confirm.failed'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The question names the notification and its reach: the active device
   * count for a broadcast, when the stats loaded; the criteria otherwise, as
   * this screen has no count for a targeted audience.
   */
  const sendConfirmation = (): ReactNode => {
    const count = !targeted && stats ? stats.active : null;
    const form = count === null ? null : new Intl.PluralRules(language).select(count);
    const formatted = count === null ? '' : new Intl.NumberFormat(language).format(count);
    const message =
      form !== null
        ? t(`push.confirm.message.${form}`, { title: pushTitle, count: formatted })
        : t(targeted ? 'push.confirm.messageTargeted' : 'push.confirm.messageAll', { title: pushTitle });
    return (
      <ConfirmDialog
        title={t('push.confirm.title')}
        message={message}
        confirmLabel={form !== null ? t(`push.confirm.action.${form}`, { count: formatted }) : t('push.confirm.actionUnknown')}
        destructive
        busy={busy}
        error={sendError}
        onConfirm={() => void sendPush()}
        onCancel={() => setConfirmingSend(false)}
      />
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} />

      <div className="flex flex-wrap items-end gap-3">
        <FormField
          label={t('settings.scope')}
          hint={selectedChannelId ? t('settings.scope.editingChannel') : t('settings.scope.editingGlobal')}
          className="w-full max-w-xs"
        >
          <Select
            value={selectedChannelId ?? ''}
            onChange={(e) => {
              clearResults();
              setSelectedChannelId(e.target.value === '' ? null : e.target.value);
            }}
          >
            <option value="">{t('settings.channel.global')}</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {channelLabel(c.name, c.code)} ({c.code})
              </option>
            ))}
          </Select>
        </FormField>
        {selectedChannelId ? (
          <div className="mb-5 flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void resetToGlobal()}>
              {t('settings.resetToGlobal')}
            </Button>
            <InlineStatus {...resetStatus.props} />
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {config ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.section.identity')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField label={t('settings.field.appName')}>
                  <Input value={config.appName} onChange={(e) => patch({ appName: e.target.value })} />
                </FormField>
                <FormField label={t('settings.field.shortName')}>
                  <Input value={config.shortName} onChange={(e) => patch({ shortName: e.target.value })} />
                </FormField>
                <div className="flex flex-col gap-1.5">
                  <span aria-hidden="true" className="text-sm font-medium leading-none">{t('settings.field.themeColor')}</span>
                  <ColorPicker
                    value={config.themeColor}
                    onChange={(hex) => patch({ themeColor: hex })}
                    label={t('settings.field.themeColor')}
                    customLabel={t('settings.field.themeColorCustom')}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span aria-hidden="true" className="text-sm font-medium leading-none">{t('settings.field.backgroundColor')}</span>
                  <ColorPicker
                    value={config.backgroundColor}
                    onChange={(hex) => patch({ backgroundColor: hex })}
                    label={t('settings.field.backgroundColor')}
                    customLabel={t('settings.field.backgroundColorCustom')}
                  />
                </div>
                <FormField label={t('settings.field.displayMode')}>
                  <Select
                    value={config.displayMode}
                    onChange={(e) => patch({ displayMode: e.target.value as PwaDisplayMode })}
                  >
                    {displayModeLabels.options(t).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>

              <div className="flex items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadIcon(f);
                  }}
                />
                <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" aria-hidden="true" /> {t('settings.icon.upload')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t('settings.icon.hint')}
                  {config.iconAssetId ? <> {t('settings.icon.set')}</> : null}
                </span>
                <InlineStatus {...iconStatus.props} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.section.capabilities')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2">
                <Checkbox checked={config.cachingEnabled} onChange={(e) => patch({ cachingEnabled: e.target.checked })} />
                <span>{t('settings.field.cachingEnabled')}</span>
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={config.pushEnabled} onChange={(e) => patch({ pushEnabled: e.target.checked })} />
                <span>{t('settings.field.pushEnabled')}</span>
              </label>
              <div className="space-y-2 pl-6">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={config.orderStatusPushEnabled}
                    disabled={!config.pushEnabled}
                    onChange={(e) => patch({ orderStatusPushEnabled: e.target.checked })}
                  />
                  <span>{t('settings.field.orderStatusPush')}</span>
                </label>
                {quotesPresent ? (
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={config.quoteStatusPushEnabled}
                      disabled={!config.pushEnabled}
                      onChange={(e) => patch({ quoteStatusPushEnabled: e.target.checked })}
                    />
                    <span>{t('settings.field.quoteStatusPush')}</span>
                  </label>
                ) : null}
                <p className="text-sm text-muted-foreground">{t('settings.field.statusPushHint')}</p>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <Button type="button" variant="outline" disabled={busy} onClick={() => void generateVapid()}>
                  <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" /> {t('settings.vapid.generate')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {config.vapidPrivateKeyIsSet ? t('settings.vapid.set') : t('settings.vapid.unset')}
                </span>
                <InlineStatus {...vapidStatus.props} />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <InlineStatus {...saveStatus.props} />
            <Button type="button" disabled={busy} onClick={() => void save()}>
              <Save className="mr-2 h-4 w-4" aria-hidden="true" /> {t('settings.save')}
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('push.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats ? (
                <p className="text-sm text-muted-foreground">
                  {t('push.subscribers.summary', { active: stats.active, invalid: stats.invalid })}
                </p>
              ) : null}
              <FormField label={t('push.field.title')} required>
                <Input value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} />
              </FormField>
              <FormField label={t('push.field.body')} required>
                <Input value={pushBody} onChange={(e) => setPushBody(e.target.value)} />
              </FormField>
              <FormField label={t('push.field.url')}>
                <Input value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="/account/orders/123" />
              </FormField>

              <div className="space-y-2">
                <span id="push-audience-label" className="text-sm font-medium leading-none">{t('push.field.audience')}</span>
                <div className="flex items-center gap-4" role="radiogroup" aria-labelledby="push-audience-label">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="push-audience-mode"
                      checked={audienceMode === 'all'}
                      onChange={() => setAudienceMode('all')}
                    />
                    {t('push.audience.all')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="push-audience-mode"
                      checked={audienceMode === 'rule'}
                      onChange={() => setAudienceMode('rule')}
                    />
                    {t('push.audience.rule')}
                  </label>
                </div>
                {audienceMode === 'rule' ? (
                  <PushAudienceRuleBuilder value={audienceRule} onChange={setAudienceRule} disabled={busy} />
                ) : null}
              </div>

              {!selectedChannelId ? (
                <p className="text-sm text-muted-foreground">{t('push.selectChannel')}</p>
              ) : null}
              <div className="flex items-center justify-end gap-3">
                <InlineStatus {...pushStatus.props} />
                <Button
                  type="button"
                  disabled={busy || !selectedChannelId || !config.pushEnabled || !pushTitle || !pushBody}
                  onClick={requestSend}
                >
                  <Send className="mr-2 h-4 w-4" aria-hidden="true" />{' '}
                  {targeted ? t('push.sendTargeted') : t('push.sendAll')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('settings.loading')}</p>
      )}
      {confirmingSend ? sendConfirmation() : null}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default PwaPage;
