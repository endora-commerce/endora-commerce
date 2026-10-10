import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { SalesChannelOption } from '@endora-commerce/contracts';
// The barrel, not `../../lib/api-client.js` — `SalesChannelPicker` beside this
// file says why: it is the only spelling an admin test can `vi.mock`.
import { apiClient } from '../../lib/index.js';
import { AppLanguageContext } from '../../i18n/app-language-context.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { Badge } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { MultiSelect, type MultiSelectOption } from '../../ui/multi-select.js';

/**
 * Choosing, and showing, the sales channels a delivery or payment method is
 * offered in — one implementation for the two method screens, which are twins
 * and would otherwise each carry a copy.
 *
 * ## The rule the control has to make visible
 *
 * For a method a channel assignment is a **restriction**: an empty selection is
 * not "nowhere", it is "every channel". That is the opposite of what an empty
 * multi-select usually means, so nothing here leaves it to be inferred — the
 * trigger reads *All channels* when nothing is ticked, and a sentence under it
 * says in words which of the two states the form is in.
 *
 * ## Why it does not reuse `EntityChannelMembership`
 *
 * `sales_channels` already ships a control that assigns channels to an entity,
 * mounted on the product editor and the organization screen. It works on an
 * entity that **already exists**, writes one membership per click through the
 * central membership routes, and refuses to remove the last one — which is
 * right for a product and wrong on all three counts here: a method is created
 * and assigned in one form, its channels are saved with the rest of it by the
 * method's own `PUT`, and "none" is a state the operator may choose. So this is
 * a field over the kit's `MultiSelect`, and the write stays the method's.
 *
 * ## The list is loaded here, once per screen
 *
 * `useSalesChannelOptions` is called by the page and its result handed to both
 * the form field and the list cells, so the two always agree and the screen
 * asks once. It reads the path the page gives it — the method module's own
 * channel-options route — so the field works for every administrator who may
 * open the screen. Inactive channels are included and marked, because a method
 * may be assigned to one and the form must not silently drop it.
 */

export interface MethodSalesChannelOption {
  id: string;
  code: string;
  label: string;
  active: boolean;
}

/**
 * A channel's display name for the admin's language.
 *
 * The admin language is a bare `en` / `pl` while a channel's names are keyed by
 * full locale (`en-US`, `pl-PL`), so the lookup is exact, then by language
 * prefix, then English, then whatever the channel has, then its code.
 */
function channelLabel(name: Record<string, string>, code: string, language: string): string {
  const byPrefix = Object.keys(name).find((locale) => locale.split('-')[0] === language);
  return (
    name[language] ??
    (byPrefix !== undefined ? name[byPrefix] : undefined) ??
    name['en-US'] ??
    Object.values(name)[0] ??
    code
  );
}

export type MethodSalesChannelOptions =
  | { status: 'loading'; channels: MethodSalesChannelOption[]; retry: () => void }
  | { status: 'ready'; channels: MethodSalesChannelOption[]; retry: () => void }
  | { status: 'error'; channels: MethodSalesChannelOption[]; retry: () => void };

/**
 * Every sales channel of the instance, for the field and the list cells.
 *
 * `path` is the owning module's own read of the channels — for the two method
 * screens `/api/v1/admin/delivery-methods/sales-channels` and its payment
 * twin, each gated on that module's read permission. It is a parameter because
 * the answer to "may this operator see the channels to assign to" belongs to
 * the module whose entity is being assigned, not to the kit and not to the
 * sales-channel administration screens.
 *
 * `enabled` is the screen's own read gate: a page that renders nothing for an
 * operator without the permission has no reason to ask.
 *
 * `error` covers every way the list can be unavailable — a network failure or
 * a server error. The field degrades the same way
 * for all of them, and says so; see {@link MethodSalesChannelsField}.
 */
export function useSalesChannelOptions(
  path: string,
  enabled: boolean,
): MethodSalesChannelOptions {
  // Read without `useAppLanguage`, which throws outside the provider: the two
  // method screens are mounted without it in their own tests, and a missing
  // language is no reason for a channel field to take a whole screen down.
  const language = useContext(AppLanguageContext)?.language ?? 'en';
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [channels, setChannels] = useState<MethodSalesChannelOption[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setStatus('loading');
    apiClient
      .get<{ data: SalesChannelOption[] }>(path)
      .then((res) => {
        if (!alive) return;
        setChannels(
          res.data.map((ch) => ({
            id: ch.id,
            code: ch.code,
            label: channelLabel(ch.name, ch.code, language),
            active: ch.active,
          })),
        );
        setStatus('ready');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });
    return (): void => {
      alive = false;
    };
  }, [path, enabled, language, attempt]);

  const retry = useCallback((): void => setAttempt((n) => n + 1), []);
  return useMemo(() => ({ status, channels, retry }), [status, channels, retry]);
}

/**
 * The value a method form sends as `salesChannelIds`.
 *
 * `undefined` — the field is **omitted** — whenever the channel list is not
 * loaded. The form cannot show the operator what they would be choosing then,
 * and the API reads an omitted field as "say nothing about channels": an edit
 * keeps the assignment it has, a new method goes to the default channel.
 * Sending the form's untouched `[]` instead would be read as "every channel"
 * and would lift a restriction nobody could see on the screen.
 */
export function salesChannelIdsToSubmit(
  options: MethodSalesChannelOptions,
  selected: readonly string[],
): string[] | undefined {
  return options.status === 'ready' ? [...selected] : undefined;
}

export interface MethodSalesChannelsFieldProps {
  options: MethodSalesChannelOptions;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function MethodSalesChannelsField({
  options,
  value,
  onChange,
  disabled = false,
}: MethodSalesChannelsFieldProps): ReactNode {
  const t = useTranslation('core');
  const labelId = useId();
  const helpId = useId();

  const selectOptions: MultiSelectOption[] = useMemo(
    () =>
      options.channels.map((ch) => ({
        value: ch.id,
        label: ch.active
          ? ch.label
          : t('methodSalesChannels.inactiveOption', { channel: ch.label }),
      })),
    [options.channels, t],
  );

  const selectedLabels = selectOptions.filter((o) => value.includes(o.value)).map((o) => o.label);
  // Ids the loaded list does not contain — an assignment that changed between
  // the two reads the screen makes. Deleting a channel rebinds or refuses its
  // members, so it is not a dangling id — and `MultiSelect` only ever returns ids it has an option for,
  // so `toggle` below puts these back on every change instead of dropping them.
  const listedIds = new Set(selectOptions.map((o) => o.value));
  const unlistedIds = value.filter((id) => !listedIds.has(id));
  const unlisted = unlistedIds.length;
  const toggle = (next: string[]): void => onChange([...next, ...unlistedIds]);

  return (
    <div className="space-y-2" role="group" aria-labelledby={labelId} aria-describedby={helpId}>
      <span id={labelId} className="text-sm font-medium leading-none">
        {t('methodSalesChannels.label')}
      </span>

      {options.status === 'error' ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
          <p>{t('methodSalesChannels.loadError')}</p>
          <Button type="button" variant="outline" size="sm" onClick={options.retry}>
            {t('methodSalesChannels.retry')}
          </Button>
        </div>
      ) : (
        <MultiSelect
          options={selectOptions}
          selected={value}
          onChange={toggle}
          // `MultiSelect` shows the placeholder alone for an empty selection and
          // "<placeholder> (n)" for several, so it is "All channels" only while
          // that is what the selection means.
          placeholder={
            options.status === 'loading'
              ? t('methodSalesChannels.loading')
              : value.length === 0
                ? t('methodSalesChannels.all')
                : t('methodSalesChannels.label')
          }
          ariaLabel={t('methodSalesChannels.label')}
          disabled={disabled || options.status === 'loading'}
          searchable={selectOptions.length > 8}
          searchPlaceholder={t('methodSalesChannels.search')}
        />
      )}

      {/* Mounted in every state, so the sentence is announced when it changes. */}
      <p id={helpId} role="status" className="text-xs text-muted-foreground">
        {options.status === 'loading'
          ? t('methodSalesChannels.loading')
          : options.status === 'error'
            ? ''
            : value.length === 0
              ? t('methodSalesChannels.helpAll')
              : t('methodSalesChannels.helpSelected', {
                  channels: [
                    ...selectedLabels,
                    ...(unlisted > 0
                      ? [t('methodSalesChannels.unlisted', { count: unlisted })]
                      : []),
                  ].join(', '),
                })}
      </p>
    </div>
  );
}

/** A method's channels in the list: *All channels*, or the channels' names. */
export function MethodSalesChannelsCell({
  options,
  salesChannelIds,
}: {
  options: MethodSalesChannelOptions;
  salesChannelIds: readonly string[];
}): ReactNode {
  const t = useTranslation('core');

  if (salesChannelIds.length === 0) {
    return <span className="text-sm text-muted-foreground">{t('methodSalesChannels.all')}</span>;
  }
  // Without the list there are ids and no names; a count is the honest cell.
  if (options.status !== 'ready') {
    return (
      <span className="text-sm text-muted-foreground">
        {t('methodSalesChannels.count', { count: salesChannelIds.length })}
      </span>
    );
  }
  const byId = new Map(options.channels.map((ch) => [ch.id, ch]));
  const known = salesChannelIds.flatMap((id) => {
    const ch = byId.get(id);
    return ch ? [ch] : [];
  });
  const unlisted = salesChannelIds.length - known.length;
  return (
    <ul className="flex flex-wrap gap-1">
      {known.map((ch) => (
        <li key={ch.id}>
          <Badge variant="outline">
            {ch.active ? ch.label : t('methodSalesChannels.inactiveOption', { channel: ch.label })}
          </Badge>
        </li>
      ))}
      {unlisted > 0 ? (
        <li>
          <Badge variant="outline">{t('methodSalesChannels.unlisted', { count: unlisted })}</Badge>
        </li>
      ) : null}
    </ul>
  );
}
