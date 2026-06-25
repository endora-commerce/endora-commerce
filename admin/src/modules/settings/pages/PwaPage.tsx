import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { KeyRound, Save, Send, Upload } from 'lucide-react';
import type { PwaAdminConfig, PwaDisplayMode } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { pwaClient } from '../api/pwa-client';

/**
 * PWA configuration page (feature 046, US2 + US4 admin surface). Edits the
 * global PWA identity + toggles, uploads the icon (sharp-derived sizes),
 * generates VAPID keys, and sends a broadcast push. Per-channel overrides are
 * available through the generic Settings screen; this page targets the global
 * scope for the common case.
 */
export function PwaPage(): ReactNode {
  const [config, setConfig] = useState<PwaAdminConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [stats, setStats] = useState<{ active: number; invalid: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Send-push form.
  const [pushTitle, setPushTitle] = useState('');
  const [pushBody, setPushBody] = useState('');
  const [pushUrl, setPushUrl] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [cfg, st] = await Promise.all([
        pwaClient.getConfig(null),
        pwaClient.getSubscriptionStats(null).catch(() => null),
      ]);
      setConfig(cfg);
      setStats(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PWA settings.');
    }
  }, []);

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
      await pwaClient.uploadIcon(file, null);
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
    if (!config) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await pwaClient.sendMessage({
        // Global config has no channel id; the send endpoint needs one. We rely
        // on the operator setting push per channel; for the global page we send
        // to the platform default by leaving channel resolution to the backend
        // is not possible, so this form requires an explicit channel in a future
        // iteration. For now, surface a clear message if the backend rejects it.
        salesChannelId: config.salesChannelId ?? '',
        title: pushTitle,
        body: pushBody,
        ...(pushUrl ? { url: pushUrl } : {}),
        audience: { kind: 'all' },
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
                <div>
                  <Label htmlFor="pwa-theme">Theme color</Label>
                  <Input id="pwa-theme" value={config.themeColor} onChange={(e) => patch({ themeColor: e.target.value })} placeholder="#1d4ed8" />
                </div>
                <div>
                  <Label htmlFor="pwa-bg">Background color</Label>
                  <Input id="pwa-bg" value={config.backgroundColor} onChange={(e) => patch({ backgroundColor: e.target.value })} placeholder="#fafafa" />
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
                <Label htmlFor="push-url">Link (opened on tap)</Label>
                <Input id="push-url" value={pushUrl} onChange={(e) => setPushUrl(e.target.value)} placeholder="/account/orders/123" />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={busy || !config.pushEnabled || !pushTitle || !pushBody}
                  onClick={() => void sendPush()}
                >
                  <Send className="mr-2 h-4 w-4" /> Send to all subscribers
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
