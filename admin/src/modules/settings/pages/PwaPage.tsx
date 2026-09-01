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
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ColorPicker } from '@/components/ui/color-picker';
import { pwaClient } from '../api/pwa-client';
import { PushAudienceRuleBuilder } from '../PushAudienceRuleBuilder';

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
  const [config, setConfig] = useState<PwaAdminConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : 'Failed to load PWA settings.');
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
    setInfo(null);
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
      });
      setInfo('Settings saved.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const resetToGlobal = async (): Promise<void> => {
    if (!selectedChannelId) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await pwaClient.resetConfig(selectedChannelId);
      setInfo('Channel override cleared; this channel now inherits the global configuration.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setBusy(false);
    }
  };

  const generateVapid = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await pwaClient.generateVapid();
      setInfo('VAPID keys generated.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate VAPID keys.');
    } finally {
      setBusy(false);
    }
  };

  const uploadIcon = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await pwaClient.uploadIcon(file, selectedChannelId);
      setInfo('Icon uploaded and resized.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Icon upload failed.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const sendPush = async (): Promise<void> => {
    // Sends are per-channel: the operator must pick a concrete channel scope.
    if (!selectedChannelId) {
      setError('Select a sales channel above to send a notification.');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      // A 'rule' audience that resolves to "all" is equivalent to a broadcast.
      const audience: PushAudience =
        audienceMode === 'rule' && audienceRule.kind !== 'all'
          ? { kind: 'rule', rule: audienceRule }
          : { kind: 'all' };
      const res = await pwaClient.sendMessage({
        salesChannelId: selectedChannelId,
        title: pushTitle,
        body: pushBody,
        ...(pushUrl ? { url: pushUrl } : {}),
        audience,
      });
      setInfo(`Queued ${res.queuedDeliveries} notification(s).`);
      setPushTitle('');
      setPushBody('');
      setPushUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Progressive Web App"
        description="Installable-app identity, asset caching, and push notifications."
      />

      <div className="flex items-center gap-2">
        <Label htmlFor="pwa-scope">Scope</Label>
        <select
          id="pwa-scope"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          value={selectedChannelId ?? ''}
          onChange={(e) => setSelectedChannelId(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">Global (all channels)</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {channelLabel(c.name, c.code)} ({c.code})
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {selectedChannelId ? 'Editing a per-channel override.' : 'Editing the global value.'}
        </span>
        {selectedChannelId ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void resetToGlobal()}>
            Reset to global
          </Button>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {config ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>App identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="pwa-name">App name</Label>
                  <Input id="pwa-name" value={config.appName} onChange={(e) => patch({ appName: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="pwa-short">Short name</Label>
                  <Input id="pwa-short" value={config.shortName} onChange={(e) => patch({ shortName: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Theme color</Label>
                  <ColorPicker
                    value={config.themeColor}
                    onChange={(hex) => patch({ themeColor: hex })}
                    label="Theme color"
                    customLabel="Custom theme color"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Background color</Label>
                  <ColorPicker
                    value={config.backgroundColor}
                    onChange={(hex) => patch({ backgroundColor: hex })}
                    label="Background color"
                    customLabel="Custom background color"
                  />
                </div>
                <div>
                  <Label htmlFor="pwa-display">Display mode</Label>
                  <select
                    id="pwa-display"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={config.displayMode}
                    onChange={(e) => patch({ displayMode: e.target.value as PwaDisplayMode })}
                  >
                    <option value="standalone">standalone</option>
                    <option value="fullscreen">fullscreen</option>
                    <option value="minimal-ui">minimal-ui</option>
                  </select>
                </div>
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
                  <Upload className="mr-2 h-4 w-4" /> Upload icon
                </Button>
                <span className="text-sm text-muted-foreground">
                  PNG or WebP, at least 512×512, square.{config.iconAssetId ? ' Icon set.' : ''}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Capabilities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2">
                <Checkbox checked={config.cachingEnabled} onChange={(e) => patch({ cachingEnabled: e.target.checked })} />
                <span>Enable static-asset caching on the storefront</span>
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={config.pushEnabled} onChange={(e) => patch({ pushEnabled: e.target.checked })} />
                <span>Enable push notifications</span>
              </label>
              <div className="flex items-center gap-3 pt-1">
                <Button type="button" variant="outline" disabled={busy} onClick={() => void generateVapid()}>
                  <KeyRound className="mr-2 h-4 w-4" /> Generate VAPID keys
                </Button>
                <span className="text-sm text-muted-foreground">
                  {config.vapidPrivateKeyIsSet ? 'VAPID keys configured.' : 'No VAPID keys configured.'}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="button" disabled={busy} onClick={() => void save()}>
              <Save className="mr-2 h-4 w-4" /> Save
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Send push notification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats ? (
                <p className="text-sm text-muted-foreground">
                  Subscribers — active: {stats.active}, invalid: {stats.invalid}
                </p>
              ) : null}
              <div>
                <Label htmlFor="push-title">Title</Label>
                <Input id="push-title" value={pushTitle} onChange={(e) => setPushTitle(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="push-body">Message</Label>
                <Input id="push-body" value={pushBody} onChange={(e) => setPushBody(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="push-url">Link (optional, opened on tap)</Label>
                <Input id="push-url" value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="/account/orders/123" />
              </div>

              <div className="space-y-2">
                <Label>Audience</Label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="push-audience-mode"
                      checked={audienceMode === 'all'}
                      onChange={() => setAudienceMode('all')}
                    />
                    All subscribers
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="push-audience-mode"
                      checked={audienceMode === 'rule'}
                      onChange={() => setAudienceMode('rule')}
                    />
                    Target by criteria
                  </label>
                </div>
                {audienceMode === 'rule' ? (
                  <PushAudienceRuleBuilder value={audienceRule} onChange={setAudienceRule} disabled={busy} />
                ) : null}
              </div>

              {!selectedChannelId ? (
                <p className="text-sm text-muted-foreground">
                  Select a sales channel in the Scope selector above to send a notification.
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={busy || !selectedChannelId || !config.pushEnabled || !pushTitle || !pushBody}
                  onClick={() => void sendPush()}
                >
                  <Send className="mr-2 h-4 w-4" />{' '}
                  {audienceMode === 'rule' && audienceRule.kind !== 'all'
                    ? 'Send to targeted subscribers'
                    : 'Send to all subscribers'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </div>
  );
}
