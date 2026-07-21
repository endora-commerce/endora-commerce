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
  function setSender<K extends keyof ProviderConfig['sender']>(
    key: K,
    value: ProviderConfig['sender'][K],
  ): void {
    setCfg((prev) => (prev ? { ...prev, sender: { ...prev.sender, [key]: value } } : prev));
  }

  async function save(): Promise<void> {
    if (!cfg) return;
    setError(null);
    try {
      const saved = await newsletterClient.putProvider({
        sender: { fromEmail: cfg.sender.fromEmail, fromName: cfg.sender.fromName },
        rateLimitPerSecond: cfg.rateLimitPerSecond,
      });
      setCfg(saved);
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
        description="The SMTP connection + credentials come from an Email adapter credential configuration referenced by the newsletter.email_credentials setting (Credentials / Settings screen). This page manages the sender identity and throttle."
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
          <CardTitle>Sender &amp; throttle</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="From email"
            value={cfg.sender.fromEmail}
            onChange={(e) => setSender('fromEmail', e.target.value)}
            disabled={!canWrite}
          />
          <Input
            placeholder="From name"
            value={cfg.sender.fromName}
            onChange={(e) => setSender('fromName', e.target.value)}
            disabled={!canWrite}
          />
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
