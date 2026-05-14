import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Save } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Quote Requests settings tab (feature 008 / T080).
 *
 * Three settings:
 *   - quote_requests.expiry_days (integer, 0 = never)
 *   - quote_requests.show_add_to_quote_on_card (boolean)
 *   - quote_requests.show_add_to_quote_on_pdp (boolean)
 */

interface SettingValue {
  code: string;
  value: unknown;
}

const KEYS = {
  expiry: 'quote_requests.expiry_days',
  card: 'quote_requests.show_add_to_quote_on_card',
  pdp: 'quote_requests.show_add_to_quote_on_pdp',
} as const;

export function QuoteRequestsSettingsTab(): ReactNode {
  const t = useTranslation('settings');
  const [expiry, setExpiry] = useState('0');
  const [card, setCard] = useState(true);
  const [pdp, setPdp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const res = await apiClient.get<{ data: SettingValue[] }>(
        '/api/v1/admin/settings?prefix=quote_requests.',
      );
      for (const v of res.data) {
        if (v.code === KEYS.expiry && typeof v.value === 'number') setExpiry(String(v.value));
        if (v.code === KEYS.card && typeof v.value === 'boolean') setCard(v.value);
        if (v.code === KEYS.pdp && typeof v.value === 'boolean') setPdp(v.value);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('quoteRequestsTab.error.load'));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const expiryDays = Number(expiry);
    if (!Number.isFinite(expiryDays) || expiryDays < 0) {
      setError(t('quoteRequestsTab.error.invalidExpiry'));
      setBusy(false);
      return;
    }
    try {
      await apiClient.patch('/api/v1/admin/settings', {
        changes: [
          { code: KEYS.expiry, value: Math.floor(expiryDays) },
          { code: KEYS.card, value: card },
          { code: KEYS.pdp, value: pdp },
        ],
      });
      setInfo(t('quoteRequestsTab.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('quoteRequestsTab.error.save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('quoteRequestsTab.title')}</CardTitle>
      </CardHeader>
      <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        <div>
          <Label htmlFor="expiry">{t('quoteRequestsTab.expiry.label')}</Label>
          <Input
            id="expiry"
            type="number"
            min={0}
            value={expiry}
            onChange={(e): void => setExpiry(e.target.value)}
          />
          <p style={{ fontSize: 12, color: 'var(--b2b-muted)', marginTop: 4 }}>
            {t('quoteRequestsTab.expiry.help')}
          </p>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={card}
            onChange={(e): void => setCard(e.target.checked)}
          />
          {t('quoteRequestsTab.showOnCards')}
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={pdp}
            onChange={(e): void => setPdp(e.target.checked)}
          />
          {t('quoteRequestsTab.showOnPdp')}
        </label>

        <div>
          <Button onClick={(): void => void save()} disabled={busy}>
            <Save size={14} style={{ marginRight: 4 }} /> {t('quoteRequestsTab.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
