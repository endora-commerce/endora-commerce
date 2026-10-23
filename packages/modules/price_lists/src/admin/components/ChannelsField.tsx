import { forwardRef, useId, type ReactNode } from 'react';
import type { PriceBookTargetSalesChannel } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Checkbox } from '@endora-commerce/admin-kit/ui';
import { useLocalizedName } from '../lib/localized-name.js';

/**
 * A book's sales channels (feature 161, FR-002, FR-003; US1 scenarios 2 and 4).
 *
 * Only the channels that sell in the book's currency are offered, and the
 * others are named with the reason they are missing — an operator looking for
 * a channel should not have to guess why it is not there. A binding the server
 * reports **dormant** (the channel stopped offering the currency) stays listed
 * and checked, with the reason in words, so removing it is a choice.
 *
 * The fieldset takes focus (`tabIndex -1`) so a refused activation can take
 * the operator straight to it (FR-004).
 */
export const ChannelsField = forwardRef<
  HTMLFieldSetElement,
  {
    readonly currency: string;
    readonly channels: readonly PriceBookTargetSalesChannel[];
    readonly value: readonly string[];
    readonly onChange: (channelIds: string[]) => void;
    /** Bound channels the server reports as dormant. */
    readonly dormant?: ReadonlySet<string>;
    readonly readOnly?: boolean;
    readonly error?: string | undefined;
  }
>(function ChannelsField(props, ref): ReactNode {
  const t = useTranslation('price_lists');
  const localizedName = useLocalizedName();
  const errorId = useId();
  const offers = (c: PriceBookTargetSalesChannel): boolean => c.currencies.includes(props.currency);
  const bound = new Set(props.value);
  const shown = props.channels.filter((c) => offers(c) || bound.has(c.id) || props.dormant?.has(c.id));
  const absent = props.channels.filter((c) => !offers(c) && !bound.has(c.id) && !props.dormant?.has(c.id));
  const nameOf = (c: PriceBookTargetSalesChannel): string => localizedName(c.name, c.code);

  const toggle = (id: string, checked: boolean): void => {
    props.onChange(checked ? [...props.value, id] : props.value.filter((v) => v !== id));
  };

  return (
    <fieldset
      ref={ref}
      tabIndex={-1}
      className="space-y-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-describedby={props.error ? errorId : undefined}
    >
      <legend className="text-sm font-medium">{t('priceBooks.field.channels')}</legend>
      {props.readOnly ? (
        bound.size === 0 ? (
          <p className="text-sm text-muted-foreground">{t('priceBooks.channels.noneBound')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {props.channels
              .filter((c) => bound.has(c.id))
              .map((channel) => (
                <li key={channel.id}>
                  {nameOf(channel)}
                  {props.dormant?.has(channel.id) ? (
                    <span className="block text-xs text-amber-800">{t('priceBooks.channels.dormant', { currency: props.currency })}</span>
                  ) : null}
                </li>
              ))}
          </ul>
        )
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('priceBooks.channels.none', { currency: props.currency })}</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((channel) => {
            const dormant = props.dormant?.has(channel.id) ?? false;
            return (
              <li key={channel.id}>
                <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
                  <Checkbox
                    checked={bound.has(channel.id)}
                    onChange={(event): void => toggle(channel.id, event.target.checked)}
                  />
                  <span>{nameOf(channel)}</span>
                </label>
                {dormant ? (
                  <p className="ml-6 text-xs text-amber-800">{t('priceBooks.channels.dormant', { currency: props.currency })}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {!props.readOnly && absent.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('priceBooks.channels.absent', { currency: props.currency, channels: absent.map(nameOf).join(', ') })}
        </p>
      ) : null}
      {props.error ? (
        <p id={errorId} className="text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
    </fieldset>
  );
});
