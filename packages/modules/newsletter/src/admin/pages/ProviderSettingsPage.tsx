import { useEffect, useState } from 'react';
import type { ProviderConfig } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input, PageHeader } from '@endora-commerce/admin-kit/ui';
import { newsletterClient } from '../api/newsletter-client.js';

export function ProviderSettingsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const tc = useTranslation('core');
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
        <AlertDescription>{t('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }
  if (!cfg) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;

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
      setNotice(t('common.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function test(): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      const r = await newsletterClient.testProvider();
      setNotice(r.ok ? t('provider.ok') : t('provider.error', { error: r.error }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('provider.title')}
        description={t('provider.connection')}
        actions={
          canWrite ? (
            <>
              <Button variant="outline" onClick={() => void test()}>
                {t('provider.test')}
              </Button>
              <Button onClick={() => void save()}>{tc('common.action.save')}</Button>
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
          <CardTitle>{t('provider.section')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('provider.field.fromEmail')}>
            <Input
              type="email"
              value={cfg.sender.fromEmail}
              onChange={(e) => setSender('fromEmail', e.target.value)}
              disabled={!canWrite}
            />
          </FormField>
          <FormField label={t('provider.field.fromName')}>
            <Input
              value={cfg.sender.fromName}
              onChange={(e) => setSender('fromName', e.target.value)}
              disabled={!canWrite}
            />
          </FormField>
          <FormField label={t('provider.field.rateLimit')}>
            <Input
              type="number"
              min={1}
              value={cfg.rateLimitPerSecond}
              onChange={(e) => set('rateLimitPerSecond', Number(e.target.value))}
              disabled={!canWrite}
            />
          </FormField>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default ProviderSettingsPage;
