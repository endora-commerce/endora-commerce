import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SalesChannelDetail, SalesChannelSummary } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { StickyFormActions } from '@/components/StickyFormActions';
import { useAuth } from '@/lib/auth';
import { SalesChannelPicker } from '@/components/sales-channel-picker/SalesChannelPicker';
import { ApiError } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { salesChannelsClient } from '@/modules/sales_channels/api/sales-channels-client';
import {
  productFeedsClient,
  slugify,
  type FeedTemplateSummary,
} from './api';

/**
 * Create a feed — ux-design §2.2, FR-019, SC-001.
 *
 * **Four fields only**: template, name, channel, language. Everything else
 * (currency, price basis, criteria, schedule, the token) has a defensible
 * default the operator can change afterwards, and asking for it here is what
 * turns a two-minute task into an abandoned form.
 *
 * The language and currency options come from the **chosen channel**, not from
 * a global list, because those are the only values the backend will accept
 * (contract admin-feeds.md §2) — so an invalid combination is unreachable
 * rather than merely refused.
 */
export function ProductFeedCreatePage(): ReactNode {
  const t = useTranslation('product_feeds');
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  // US6 AS-7 — a read-only administrator sees the form and a disabled primary
  // that says why, rather than a form that only fails once it is filled in.
  const canWrite = hasPermission('product_feeds:write');
  const writeTitle = canWrite ? undefined : t('permission.needWrite');

  const [templates, setTemplates] = useState<FeedTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [channel, setChannel] = useState<SalesChannelDetail | null>(null);
  const [languageCode, setLanguageCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void productFeedsClient.listTemplates().then((r) => {
      setTemplates(r.data);
      const google = r.data.find((tpl) => tpl.systemCode === 'google_merchant_v1');
      setTemplateId(google?.id ?? r.data[0]?.id ?? '');
    });
  }, []);

  // Resolve the channel's own languages and currencies once one is picked.
  useEffect(() => {
    if (!channelId) {
      setChannel(null);
      return;
    }
    let alive = true;
    void salesChannelsClient.list({ pageSize: 200 }).then(async (list) => {
      const summary = (list.items as SalesChannelSummary[]).find((c) => c.id === channelId);
      if (!summary) return;
      const detail = await salesChannelsClient.getByCode(summary.code);
      if (!alive) return;
      setChannel(detail);
      setLanguageCode((current) =>
        current && detail.languages.includes(current) ? current : detail.defaultLanguage,
      );
    });
    return () => {
      alive = false;
    };
  }, [channelId]);

  const currencyCode = channel?.defaultCurrency ?? '';
  const canSubmit = useMemo(
    () => templateId !== '' && name.trim() !== '' && channelId !== null && languageCode !== '',
    [templateId, name, channelId, languageCode],
  );

  const submit = async (): Promise<void> => {
    if (!canSubmit || !channelId) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await productFeedsClient.create({
        name: name.trim(),
        slug: slugify(name),
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode,
        currencyCode,
        // Gross needs a tax country the operator has not been asked for yet, so
        // the first version of a feed is net; the settings tab offers gross
        // together with the country it requires.
        pricePresentation: 'net',
      });
      // The plaintext link is returned exactly once — hand it straight to the
      // detail page rather than storing it anywhere.
      navigate(`/product-feeds/${created.data.feed.id}`, {
        state: { issuedToken: created.data.issuedToken },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('feeds.create.title')}
        description={t('feeds.create.subtitle')}
        back={{ label: t('page.title'), to: '/product-feeds' }}
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feed-template">{t('feeds.create.template')}</Label>
            <select
              id="feed-template"
              className="b2b-select"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                  {tpl.isSystem && tpl.fieldCount <= 7 ? ` — ${t('templates.startingPoint')}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feed-name">{t('feeds.create.name')}</Label>
            <Input
              id="feed-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feed-channel">{t('feeds.create.channel')}</Label>
            <SalesChannelPicker
              id="feed-channel"
              value={channelId}
              onChange={setChannelId}
              activeOnly
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feed-language">{t('feeds.create.language')}</Label>
            <select
              id="feed-language"
              className="b2b-select"
              value={languageCode}
              onChange={(e) => setLanguageCode(e.target.value)}
              disabled={!channel}
            >
              {(channel?.languages ?? []).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          {/* The live derived-settings line: everything the operator did NOT
              have to decide, stated before they commit. */}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {currencyCode ? `${currencyCode} · ` : ''}
            {t('feeds.create.derived')}
          </p>
        </CardContent>
      </Card>

      <StickyFormActions className="mt-4">
        <Button variant="outline" onClick={() => navigate('/product-feeds')}>
          {t('feeds.retry') === '' ? '' : '←'} {t('page.title')}
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={!canWrite || !canSubmit || submitting}
          title={writeTitle}
        >
          {t('feeds.create.submit')}
        </Button>
      </StickyFormActions>
    </div>
  );
}
