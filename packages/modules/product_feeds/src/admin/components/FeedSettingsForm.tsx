import { useState, type ReactNode } from 'react';
import type { ProductSelectionRule } from '@endora-commerce/contracts';
import {
  Button,
  Card,
  CardContent,
  Checkbox,
  EditorSection,
  Input,
  Label,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { StickyFormActions } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { productFeedsClient, type ProductFeedDto } from '../api.js';
import { FeedCriteriaPanel } from './FeedCriteriaPanel.js';
import { FeedPriceBookField } from './FeedPriceBookField.js';
import { SchedulePresetField, type FeedScheduleValue } from './SchedulePresetField.js';

/**
 * Feed settings — ux-design §2.2.
 *
 * Four `EditorSection`s of the tab's one card, not separate cards (issue
 * #1503, UX audit SHELL-22; the DS-03 rule, #1437: one card per editor tab,
 * sections inside it). The fifth region, a "danger zone", held nothing but the
 * on/off switch, which is reversible and not dangerous; it moved into the
 * first section, beside the name (issue #1530, CAT-20). The save's refusal and
 * its result are in the `StickyFormActions` bar with the button, the status
 * region mounted before it has anything to say (WCAG 4.1.3).
 *
 * The price region is the one with a real cross-field rule: gross prices need a
 * tax country, because a feed has no buyer to infer one from (FR-044). It also
 * carries the price book the feed is pinned to (issue #414), sent only when
 * the operator changed it — a pin to a book that no longer exists would
 * otherwise refuse every save of the other fields.
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
  const [priceListId, setPriceListId] = useState<string | null>(feed.priceListId);
  const [selectionRule, setSelectionRule] = useState<ProductSelectionRule>(
    feed.selectionRule ?? { kind: 'all' },
  );
  const [schedule, setSchedule] = useState<FeedScheduleValue | null>(feed.schedule);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grossWithoutCountry = presentation === 'gross' && taxCountry.trim() === '';

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setSavedMessage(null);
    try {
      const result = await productFeedsClient.update(feed.id, {
        name: name.trim(),
        enabled,
        pricePresentation: presentation,
        taxCountry: presentation === 'gross' ? taxCountry.trim().toUpperCase() : null,
        ...(priceListId !== feed.priceListId ? { priceListId } : {}),
        selectionRule,
        schedule,
      });
      onSaved(result.data);
      setSavedMessage(t('feeds.settings.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="space-y-(--section-gap)">
          <EditorSection title={t('feeds.settings.binding')} contentClassName="flex flex-col gap-4">
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
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
              <Checkbox
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={!canWrite}
                title={writeTitle}
              />
              {t('feeds.settings.enabled')}
            </label>
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
          </EditorSection>

          <EditorSection title={t('feeds.settings.prices')} contentClassName="flex flex-col gap-4">
            <FeedPriceBookField
              feedId={feed.id}
              pinnedId={feed.priceListId}
              value={priceListId}
              onChange={setPriceListId}
              disabled={!canWrite}
              disabledTitle={writeTitle}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feed-price-presentation">{t('feeds.settings.presentation')}</Label>
              <Select
                id="feed-price-presentation"
                value={presentation}
                onChange={(e) => setPresentation(e.target.value as 'net' | 'gross')}
                disabled={!canWrite}
                title={writeTitle}
              >
                <option value="net">{t('feeds.settings.presentation.net')}</option>
                <option value="gross">{t('feeds.settings.presentation.gross')}</option>
              </Select>
            </div>
            {presentation === 'gross' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="feed-tax-country">{t('feeds.settings.taxCountry')}</Label>
                <Input
                  id="feed-tax-country"
                  value={taxCountry}
                  className="w-20 uppercase"
                  maxLength={2}
                  autoComplete="off"
                  onChange={(e) => setTaxCountry(e.target.value)}
                  aria-invalid={grossWithoutCountry}
                  aria-describedby={grossWithoutCountry ? 'feed-tax-country-error' : undefined}
                  disabled={!canWrite}
                  title={writeTitle}
                />
                {grossWithoutCountry && (
                  <p id="feed-tax-country-error" className="text-xs text-destructive">
                    {t('feeds.settings.taxCountry.required')}
                  </p>
                )}
              </div>
            )}
          </EditorSection>

          <EditorSection title={t('feeds.settings.criteria')}>
            <FeedCriteriaPanel
              salesChannelId={feed.salesChannelId}
              value={selectionRule}
              onChange={setSelectionRule}
              disabled={!canWrite}
              disabledTitle={writeTitle}
            />
          </EditorSection>

          <EditorSection title={t('feeds.settings.schedule')}>
            <SchedulePresetField
              value={schedule}
              onChange={setSchedule}
              nextRunAt={feed.nextRunAt}
              tooTight={feed.scheduleTooTightWarning}
              disabled={!canWrite}
              disabledTitle={writeTitle}
            />
          </EditorSection>
        </CardContent>
      </Card>

      {/* The refusal and the result sit in the bar with the button that caused them (Doherty). */}
      <StickyFormActions
        error={error}
        status={savedMessage}
        primary={
          <Button
            onClick={() => void save()}
            disabled={!canWrite || busy || grossWithoutCountry}
            aria-busy={busy}
            title={writeTitle}
          >
            {t('feeds.settings.save')}
          </Button>
        }
      />
    </div>
  );
}
