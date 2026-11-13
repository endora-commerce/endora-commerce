import { useEffect, useId, useState, type ReactNode } from 'react';
import { Label, Select } from '@endora-commerce/admin-kit/ui';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { productFeedsClient, type FeedPriceBookOption } from '../api.js';

/**
 * The price book a feed is pinned to — issue #414.
 *
 * A pinned book publishes only while it would price an anonymous buyer on the
 * feed's channel now (feature 160 FR-029, owner ruling 2026-10-23). So the
 * picker offers the books that would, first, and lists the others disabled
 * with the reason beside their name — the operator learns what to fix in the
 * book instead of wondering why it is missing. The book the feed is already
 * pinned to stays selectable whatever its state, so opening the tab and saving
 * never changes the pin behind the operator's back; its reason is stated
 * under the field.
 *
 * The books are `price_lists`' and the options route asks for
 * `price_lists:read`; without it the field shows the pin it cannot name,
 * disabled, and says why.
 */

export interface FeedPriceBookFieldProps {
  feedId: string;
  /** The feed's stored pin, which may name a book that no longer exists. */
  pinnedId: string | null;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  disabledTitle?: string | undefined;
}

type Load = { state: 'loading' } | { state: 'ready'; options: FeedPriceBookOption[] } | { state: 'failed' };

export function FeedPriceBookField(props: FeedPriceBookFieldProps): ReactNode {
  const { feedId, pinnedId, value, onChange } = props;
  const t = useTranslation('product_feeds');
  const { hasPermission } = useAuth();
  const canReadBooks = hasPermission('price_lists:read');
  const id = useId();
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    if (!canReadBooks) return undefined;
    let live = true;
    setLoad({ state: 'loading' });
    productFeedsClient
      .priceBookOptions(feedId)
      .then((res) => {
        if (live) setLoad({ state: 'ready', options: res.data });
      })
      .catch(() => {
        if (live) setLoad({ state: 'failed' });
      });
    return () => {
      live = false;
    };
  }, [feedId, canReadBooks]);

  const options = load.state === 'ready' ? load.options : [];
  const label = (option: FeedPriceBookOption): string =>
    option.isBase ? `${option.name} · ${t('feeds.settings.priceBook.base')}` : option.name;
  const selectable = (option: FeedPriceBookOption): boolean =>
    option.unpublishableReason === null || option.id === pinnedId;
  const offered = options.filter(selectable);
  const others = options.filter((option) => !selectable(option));
  const pinnedMissing = pinnedId !== null && load.state === 'ready' && !options.some((o) => o.id === pinnedId);
  const selected = options.find((o) => o.id === value) ?? null;
  const selectedReason = selected?.unpublishableReason ?? (value !== null && value === pinnedId && pinnedMissing ? 'not_found' : null);

  const fieldDisabled = props.disabled === true || !canReadBooks || load.state !== 'ready';
  const notice = !canReadBooks
    ? t('feeds.settings.priceBook.needPriceListsRead')
    : load.state === 'failed'
      ? t('feeds.settings.priceBook.loadFailed')
      : selectedReason
        ? t(`feeds.pinnedBook.${selectedReason}`)
        : '';

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{t('feeds.settings.priceBook')}</Label>
      <Select
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        disabled={fieldDisabled}
        title={props.disabled ? props.disabledTitle : undefined}
        aria-describedby={`${hintId} ${statusId}`}
        aria-busy={canReadBooks && load.state === 'loading'}
        aria-invalid={selectedReason !== null}
      >
        <option value="">{t('feeds.settings.priceBook.none')}</option>
        {/* A pin the list cannot show — the book is gone, or unreadable here — stays as it is. */}
        {pinnedId !== null && (pinnedMissing || load.state !== 'ready') && (
          <option value={pinnedId}>
            {t(pinnedMissing ? 'feeds.settings.priceBook.missing' : 'feeds.settings.priceBook.current')}
          </option>
        )}
        {offered.map((option) => (
          <option key={option.id} value={option.id}>
            {label(option)}
          </option>
        ))}
        {others.length > 0 && (
          <optgroup label={t('feeds.settings.priceBook.unavailable')}>
            {others.map((option) => (
              <option key={option.id} value={option.id} disabled>
                {`${label(option)} — ${t(`feeds.settings.priceBook.reason.${option.unpublishableReason}`)}`}
              </option>
            ))}
          </optgroup>
        )}
      </Select>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('feeds.settings.priceBook.hint')}
      </p>
      {/* Mounted empty so the reason is announced when it appears (WCAG 4.1.3). */}
      <p id={statusId} role="status" aria-live="polite" className={selectedReason ? 'text-xs text-amber-700 dark:text-amber-400' : 'text-xs text-muted-foreground'}>
        {notice}
      </p>
    </div>
  );
}
