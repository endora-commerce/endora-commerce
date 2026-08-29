import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  LINKEDIN_TRIGGER_ACTIONS,
  type LinkedInConversionMapping,
  type LinkedInTriggerAction,
  type SalesChannelSummary,
} from '@endora-commerce/contracts';
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
import { linkedInAdsClient } from '../api/linkedin-ads-client';

const ALL_CHANNELS = '__all__';

/** Create / edit one conversion mapping (feature 063, US3). */
export function ConversionMappingEditPage(): ReactNode {
  const t = useTranslation('linkedin_ads');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === undefined;

  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [existing, setExisting] = useState<LinkedInConversionMapping | null>(null);
  const [triggerAction, setTriggerAction] = useState<LinkedInTriggerAction>('purchase');
  const [conversionId, setConversionId] = useState('');
  const [conversionRuleUrn, setConversionRuleUrn] = useState('');
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
        const row = await linkedInAdsClient.get(id);
        setExisting(row);
        setTriggerAction(row.triggerAction);
        setConversionId(row.conversionId);
        setConversionRuleUrn(row.conversionRuleUrn ?? '');
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
    const urn = conversionRuleUrn.trim() || null;
    try {
      if (isNew) {
        await linkedInAdsClient.create({
          triggerAction,
          conversionId: conversionId.trim(),
          salesChannelId: channel,
          conversionRuleUrn: urn,
          enabled,
        });
      } else if (existing) {
        await linkedInAdsClient.update(existing.id, {
          triggerAction,
          conversionId: conversionId.trim(),
          salesChannelId: channel,
          conversionRuleUrn: urn,
          enabled,
          version: existing.version,
        });
      }
      navigate('/linkedin-ads');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={isNew ? t('mappings.new') : t('mappings.edit')} />

      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <Label htmlFor="triggerAction">{t('mappings.triggerAction')}</Label>
            <Select
              id="triggerAction"
              value={triggerAction}
              onChange={(e) => setTriggerAction(e.target.value as LinkedInTriggerAction)}
            >
              {LINKEDIN_TRIGGER_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(`mappings.action.${a}`)}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="conversionId">{t('mappings.conversionId')}</Label>
            <Input
              id="conversionId"
              value={conversionId}
              inputMode="numeric"
              onChange={(e) => setConversionId(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('mappings.conversionIdHint')}</p>
          </div>

          <div>
            <Label htmlFor="conversionRuleUrn">{t('mappings.conversionRuleUrn')}</Label>
            <Input
              id="conversionRuleUrn"
              value={conversionRuleUrn}
              placeholder="urn:lla:llaPartnerConversion:…"
              onChange={(e) => setConversionRuleUrn(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t('mappings.conversionRuleUrnHint')}
            </p>
          </div>

          <div>
            <Label htmlFor="salesChannelId">{t('mappings.salesChannel')}</Label>
            <Select
              id="salesChannelId"
              value={salesChannelId}
              onChange={(e) => setSalesChannelId(e.target.value)}
            >
              <option value={ALL_CHANNELS}>{t('mappings.allChannels')}</option>
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
            {t('mappings.enabled')}
          </label>

          <Button disabled={busy || conversionId.trim() === ''} onClick={() => void save()}>
            {t('mappings.save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
