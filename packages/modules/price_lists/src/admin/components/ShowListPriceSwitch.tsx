import { useEffect, useId, useState, type ReactNode } from 'react';
import { Store } from 'lucide-react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Button, Card, CardContent, SettingRow, Switch } from '@endora-commerce/admin-kit/ui';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * *Show list price beside the buyer's price* (feature 161, T085; US7; FR-026).
 *
 * Reads and writes `…/settings/show-list-price` — `{ value }`, one audited
 * command on the server (G8) — default off. The control exists only for an
 * operator holding `price_lists:write`; a reader is told the state in words,
 * with no control (FR-028's rule: absent, not disabled). A change saves at
 * once, as a switch promises; while it is in flight the control is busy and
 * cannot be pressed again, and the outcome is announced through a live region
 * mounted empty beforehand (WCAG 4.1.3). A refused save keeps the stored
 * value on screen.
 */
export function ShowListPriceSwitch(): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const { hasPermission } = useAuth();
  const mayWrite = hasPermission('price_lists:write');
  const id = useId();
  const [value, setValue] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoadFailed(false);
    api.showListPrice().then(
      (stored) => {
        if (live) setValue(stored);
      },
      () => {
        if (live) setLoadFailed(true);
      },
    );
    return (): void => {
      live = false;
    };
  }, [api, attempt]);

  const change = async (next: boolean): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setStatus(t('settings.listPrice.saving'));
    try {
      const saved = await api.setShowListPrice(next);
      setValue(saved);
      setStatus(saved ? t('settings.listPrice.savedOn') : t('settings.listPrice.savedOff'));
    } catch {
      setStatus(t('settings.listPrice.error'));
    } finally {
      setSaving(false);
    }
  };

  const titleId = `${id}-title`;
  return (
    <section aria-labelledby={titleId} className="mt-4">
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Store className="size-4" aria-hidden="true" />
            <h2 id={titleId} className="text-base font-semibold">
              {t('settings.storefront.title')}
            </h2>
          </div>
          {loadFailed ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>{t('settings.listPrice.loadError')}</span>
              <Button type="button" variant="outline" size="sm" onClick={(): void => setAttempt((n) => n + 1)}>
                {t('priceBooks.common.retry')}
              </Button>
            </div>
          ) : value === null ? (
            <p className="text-sm text-muted-foreground" aria-busy="true">
              {t('settings.precedence.loading')}
            </p>
          ) : mayWrite ? (
            // Issue #1607 — the kit `Switch` in a `SettingRow`: a real switch,
            // named by the label and described by the help beside it, busy
            // (and deaf to a second press) while its save is in flight.
            <SettingRow label={t('settings.listPrice.label')} description={t('settings.listPrice.help')}>
              <Switch checked={value} busy={saving} onCheckedChange={(next): void => void change(next)} />
            </SettingRow>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm">
                <span className="font-medium">{t('settings.listPrice.label')}</span>
                <span>{value ? t('settings.listPrice.on') : t('settings.listPrice.off')}</span>
              </p>
              <p className="text-sm text-muted-foreground">{t('settings.listPrice.help')}</p>
            </>
          )}
          <p role="status" className="text-sm">
            {status}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
