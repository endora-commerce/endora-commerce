import { useEffect, useState } from 'react';
import type { ProviderConfig } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { newsletterClient } from '../api/newsletter-client';

export function ProviderSettingsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('newsletter:write');
  const [cfg, setCfg] = useState<ProviderConfig | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    newsletterClient
      .getProvider()
      .then(setCfg)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>You do not have permission to view the newsletter.</AlertDescription>
      </Alert>
    );
  }
  if (!cfg) return <p className="text-sm text-muted-foreground">Loading…</p>;

  function set<K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]): void {
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev));
  }
  function setSmtp<K extends keyof ProviderConfig['smtp']>(key: K, value: ProviderConfig['smtp'][K]): void {
    setCfg((prev) => (prev ? { ...prev, smtp: { ...prev.smtp, [key]: value } } : prev));
  }
  function setSender<K extends keyof ProviderConfig['sender']>(key: K, value: ProviderConfig['sender'][K]): void {
    setCfg((prev) => (prev ? { ...prev, sender: { ...prev.sender, [key]: value } } : prev));
  }

  async function save(): Promise<void> {
    if (!cfg) return;
    setError(null);
    try {
      const saved = await newsletterClient.putProvider({
        provider: cfg.provider,
        smtp: {
          host: cfg.smtp.host,
          port: cfg.smtp.port,
          secure: cfg.smtp.secure,
          username: cfg.smtp.username,
          ...(password ? { password } : {}),
        },
        sender: { fromEmail: cfg.sender.fromEmail, fromName: cfg.sender.fromName },
        rateLimitPerSecond: cfg.rateLimitPerSecond,
      });
      setCfg(saved);
      setPassword('');
      setNotice('Saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function test(): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      const r = await newsletterClient.testProvider();
      setNotice(r.ok ? 'Provider OK.' : `Provider error: ${r.error}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Newsletter — Sending provider"
        description="Configure the bulk SMTP provider (e.g. Amazon SES)."
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => void test()}>
                Test
              </Button>
              <Button onClick={() => void save()}>Save</Button>
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
          <CardTitle>SMTP</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <select
            className="border rounded px-2 py-1 text-sm"
            value={cfg.provider}
            onChange={(e) => set('provider', e.target.value as ProviderConfig['provider'])}
            disabled={!canWrite}
          >
            <option value="smtp">SMTP</option>
            <option value="console">Console (dev)</option>
          </select>
          <div />
          <Input placeholder="Host" value={cfg.smtp.host} onChange={(e) => setSmtp('host', e.target.value)} disabled={!canWrite} />
          <Input type="number" placeholder="Port" value={cfg.smtp.port} onChange={(e) => setSmtp('port', Number(e.target.value))} disabled={!canWrite} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.smtp.secure} onChange={(e) => setSmtp('secure', e.target.checked)} disabled={!canWrite} />
            TLS (secure)
          </label>
          <div />
          <Input placeholder="Username" value={cfg.smtp.username} onChange={(e) => setSmtp('username', e.target.value)} disabled={!canWrite} />
          <Input
            type="password"
            placeholder={cfg.smtp.passwordSet ? '•••••• (set — leave blank to keep)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!canWrite}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sender &amp; throttle</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Input placeholder="From email" value={cfg.sender.fromEmail} onChange={(e) => setSender('fromEmail', e.target.value)} disabled={!canWrite} />
          <Input placeholder="From name" value={cfg.sender.fromName} onChange={(e) => setSender('fromName', e.target.value)} disabled={!canWrite} />
          <Input
            type="number"
            placeholder="Rate limit / second"
            value={cfg.rateLimitPerSecond}
            onChange={(e) => set('rateLimitPerSecond', Number(e.target.value))}
            disabled={!canWrite}
          />
        </CardContent>
      </Card>
    </div>
  );
}
