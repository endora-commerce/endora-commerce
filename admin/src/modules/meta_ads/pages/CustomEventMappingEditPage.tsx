import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  META_STANDARD_EVENTS,
  META_TRIGGER_ACTIONS,
  type MetaCustomEventMapping,
  type MetaTriggerAction,
  type SalesChannelSummary,
} from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { salesChannelsClient } from '@/modules/sales_channels/api/sales-channels-client';
import { metaAdsClient } from '../api/meta-ads-client';

const ALL_CHANNELS = '__all__';

/** Create / edit one Meta custom event mapping (feature 064, US4). */
export function CustomEventMappingEditPage(): ReactNode {
  const t = useTranslation('meta_ads');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === undefined;

  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [existing, setExisting] = useState<MetaCustomEventMapping | null>(null);
  const [triggerAction, setTriggerAction] = useState<MetaTriggerAction>('purchase');
  const [eventName, setEventName] = useState('');
  const [salesChannelId, setSalesChannelId] = useState<string>(ALL_CHANNELS);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messageFor = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        if (err.envelope.error.code === 'VERSION_CONFLICT') return t('error.versionConflict');
        return err.envelope.error.message;
      }
      return t('error.generic');
    },
    [t],
  );

  useEffect(() => {
    void (async (): Promise<void> => {
      const chans = await salesChannelsClient
        .list({ activeOnly: false, pageSize: 100 })
        .catch(() => ({ items: [] }));
      setChannels(chans.items);
      if (isNew) return;
      try {
        const row = await metaAdsClient.get(id);
        setExisting(row);
        setTriggerAction(row.triggerAction);
        setEventName(row.eventName);
        setSalesChannelId(row.salesChannelId ?? ALL_CHANNELS);
        setEnabled(row.enabled);
      } catch (err) {
        setError(messageFor(err));
      }
    })();
  }, [id, isNew, messageFor]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const channel = salesChannelId === ALL_CHANNELS ? null : salesChannelId;
    try {
      if (isNew) {
        await metaAdsClient.create({
          triggerAction,
          eventName: eventName.trim(),
          salesChannelId: channel,
          enabled,
        });
      } else if (existing) {
        await metaAdsClient.update(existing.id, {
          triggerAction,
          eventName: eventName.trim(),
          salesChannelId: channel,
          enabled,
          version: existing.version,
        });
      }
      navigate('/meta-ads');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const standard = META_STANDARD_EVENTS[triggerAction];

  return (
    <div>
      <PageHeader title={isNew ? t('customEvents.new') : t('customEvents.edit')} />

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label htmlFor="triggerAction">{t('customEvents.triggerAction')}</Label>
            <Select
              id="triggerAction"
              value={triggerAction}
              onChange={(e) => setTriggerAction(e.target.value as MetaTriggerAction)}
            >
              {META_TRIGGER_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`customEvents.action.${a}`)}
                </option>
              ))}
            </Select>
            {/* Makes the additive semantics visible: the standard event keeps
                firing whatever custom name is chosen here. */}
            <p className="mt-1 text-xs text-muted-foreground">
              {t('customEvents.standardEvent')}: {standard ?? t('customEvents.standardEventNone')}
            </p>
          </div>

          <div>
            <Label htmlFor="eventName">{t('customEvents.eventName')}</Label>
            <Input
              id="eventName"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="SubmitQuote"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('customEvents.eventNameHint')}</p>
          </div>

          <div>
            <Label htmlFor="salesChannelId">{t('customEvents.salesChannel')}</Label>
            <Select
              id="salesChannelId"
              value={salesChannelId}
              onChange={(e) => setSalesChannelId(e.target.value)}
            >
              <option value={ALL_CHANNELS}>{t('customEvents.allChannels')}</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code}
                </option>
              ))}
            </Select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {t('customEvents.enabled')}
          </label>

          <Button disabled={busy || eventName.trim() === ''} onClick={() => void save()}>
            {t('customEvents.save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
