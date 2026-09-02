import { useState, type ReactNode } from 'react';
import type { ProductSelectionRule } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { productFeedsClient, type ProductFeedDto } from '../api.js';
import { FeedCriteriaPanel } from './FeedCriteriaPanel.js';
import { SchedulePresetField, type FeedScheduleValue } from './SchedulePresetField.js';

/**
 * Feed settings — ux-design §2.2, five `Card` regions.
 *
 * All five regions are real: the criteria panel arrived with US2 and the
 * schedule presets with US3.
 *
 * The price region is the one with a real cross-field rule: gross prices need a
 * tax country, because a feed has no buyer to infer one from (FR-044).
 */

export interface FeedSettingsFormProps {
  feed: ProductFeedDto;
  onSaved: (feed: ProductFeedDto) => void;
}

export function FeedSettingsForm(props: FeedSettingsFormProps): ReactNode {
  const { feed, onSaved } = props;
  const t = useTranslation('product_feeds');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('product_feeds:write');
  const writeTitle = canWrite ? undefined : t('permission.needWrite');

  const [name, setName] = useState(feed.name);
  const [enabled, setEnabled] = useState(feed.enabled);
  const [presentation, setPresentation] = useState(feed.pricePresentation);
  const [taxCountry, setTaxCountry] = useState(feed.taxCountry ?? '');
  const [selectionRule, setSelectionRule] = useState<ProductSelectionRule>(
    feed.selectionRule ?? { kind: 'all' },
  );
  const [schedule, setSchedule] = useState<FeedScheduleValue | null>(feed.schedule);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const grossWithoutCountry = presentation === 'gross' && taxCountry.trim() === '';

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await productFeedsClient.update(feed.id, {
        name: name.trim(),
        enabled,
        pricePresentation: presentation,
        taxCountry: presentation === 'gross' ? taxCountry.trim().toUpperCase() : null,
        selectionRule,
        schedule,
      });
      onSaved(result.data);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('feeds.settings.binding')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feed-name">{t('feeds.create.name')}</Label>
            <Input
              id="feed-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canWrite}
              title={writeTitle}
            />
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('feeds.create.channel')}</dt>
              <dd>{feed.salesChannelCode}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('feeds.create.language')}</dt>
              <dd>{feed.languageCode}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('feeds.create.template')}</dt>
              <dd>{feed.feedTemplateName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('feeds.settings.prices')}</dt>
              <dd>{feed.currencyCode}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('feeds.settings.prices')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feed-price-presentation">{t('feeds.settings.prices')}</Label>
            <Select
              id="feed-price-presentation"
              value={presentation}
              onChange={(e) => setPresentation(e.target.value as 'net' | 'gross')}
              disabled={!canWrite}
              title={writeTitle}
            >
              <option value="net">net</option>
              <option value="gross">gross</option>
            </Select>
          </div>
          {presentation === 'gross' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feed-tax-country">taxCountry</Label>
              <Input
                id="feed-tax-country"
                value={taxCountry}
                maxLength={2}
                onChange={(e) => setTaxCountry(e.target.value)}
                aria-invalid={grossWithoutCountry}
                disabled={!canWrite}
                title={writeTitle}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('feeds.settings.criteria')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FeedCriteriaPanel
            salesChannelId={feed.salesChannelId}
            value={selectionRule}
            onChange={setSelectionRule}
            disabled={!canWrite}
            disabledTitle={writeTitle}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('feeds.settings.schedule')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SchedulePresetField
            value={schedule}
            onChange={setSchedule}
            nextRunAt={feed.nextRunAt}
            tooTight={feed.scheduleTooTightWarning}
            disabled={!canWrite}
            disabledTitle={writeTitle}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('feeds.settings.danger')}</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={!canWrite}
              title={writeTitle}
            />
            {t('feeds.settings.enabled')}
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={() => void save()}
          disabled={!canWrite || busy || grossWithoutCountry}
          title={writeTitle}
        >
          {t('feeds.settings.save')}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-600" role="status">
            {t('feeds.settings.saved')}
          </span>
        )}
      </div>
    </div>
  );
}
