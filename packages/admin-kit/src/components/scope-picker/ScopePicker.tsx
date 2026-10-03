import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SalesChannelDetail, SalesChannelSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '../../ui/alert.js';
import { Badge } from '../../ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.js';
import { Checkbox } from '../../ui/checkbox.js';
import { Label } from '../../ui/label.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { fetchScopeSalesChannel, listScopeSalesChannels } from './sales-channels-api.js';

/**
 * The sales channels a piece of content is scoped to, and the content languages
 * inside them. The caller passes a value in and gets one back.
 *
 * **Published by feature 091, P8.** It sat under `cms`' admin directory and was
 * rendered by `blog`'s two editors as well as by `cms`' own three, which is
 * `admin-component-contribution.md` Z1 question 1: the consumer decides that it
 * appears, so it is a published component and not a zone contribution.
 *
 * **The requests are built here**, in `./sales-channels-api.js` — the client
 * exit P2 established, which is what makes the move legal under
 * `admin-kit-surface.md` R6 rather than putting `sales_channels`' admin client
 * inside the kit.
 *
 * **Its copy is `core`'s, not `cms`'** (R-1). All four keys it reads had no
 * other reader in the tree and moved to `core` under `scopePicker.*`.
 */
export interface ScopePickerValue {
  salesChannelIds: string[];
  languages: string[];
}

export interface ScopePickerProps {
  value: ScopePickerValue;
  onChange: (value: ScopePickerValue) => void;
}

/**
 * The languages a channel offers, or `null` while that is not known yet.
 *
 * A channel summary carries only its `defaultLanguage`; the full list arrives
 * with the per-channel read. Answering with the default before that read lands
 * is what lost a stored scope on 2026-10-03: a pruning effect took the default
 * as the whole answer and wrote it back, so a page whose language was not the
 * channel default opened with nothing selected and an empty canvas, and a page
 * holding the default and another language lost the other one on its next
 * save. `fallBack` is passed only once the read has failed, where the default
 * is the best answer there will be.
 */
function languagesForChannel(
  channel: SalesChannelSummary,
  detailsByCode: Record<string, SalesChannelDetail>,
  fallBack: boolean,
): string[] | null {
  const detail = detailsByCode[channel.code];
  if (detail?.languages?.length) return detail.languages;
  if (!detail && !fallBack) return null;
  return channel.defaultLanguage ? [channel.defaultLanguage] : [];
}

/** The union of what `channels` offer, sorted, or `null` if any is still unknown. */
function languagesOfChannels(
  channels: SalesChannelSummary[],
  detailsByCode: Record<string, SalesChannelDetail>,
  fallBack: boolean,
): string[] | null {
  const out = new Set<string>();
  for (const channel of channels) {
    const languages = languagesForChannel(channel, detailsByCode, fallBack);
    if (languages === null) return null;
    for (const language of languages) out.add(language);
  }
  return Array.from(out).sort();
}

export function ScopePicker({ value, onChange }: ScopePickerProps): ReactNode {
  const t = useTranslation('core');
  const [channels, setChannels] = useState<SalesChannelSummary[] | null>(null);
  const [detailsByCode, setDetailsByCode] = useState<Record<string, SalesChannelDetail>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listScopeSalesChannels()
      .then((res) => {
        if (live) setChannels(res.items);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!channels) return;
    const missing = channels.filter(
      (channel) => value.salesChannelIds.includes(channel.id) && !detailsByCode[channel.code],
    );
    if (missing.length === 0) return;

    void Promise.all(missing.map((channel) => fetchScopeSalesChannel(channel.code)))
      .then((rows) => {
        if (cancelled) return;
        setDetailsByCode((current) => ({
          ...current,
          ...Object.fromEntries(rows.map((row) => [row.code, row])),
        }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [channels, detailsByCode, value.salesChannelIds]);

  const selectedChannels = useMemo(
    () => channels?.filter((channel) => value.salesChannelIds.includes(channel.id)) ?? null,
    [channels, value.salesChannelIds],
  );

  /** A failed read stops the wait: the defaults are all there is to offer. */
  const fallBack = error !== null;

  /**
   * The languages the selected channels offer, or `null` while any of them is
   * still being read. Nothing is derived from a partial answer.
   */
  const allowedLanguages = useMemo(() => {
    if (selectedChannels === null) return fallBack ? [] : null;
    return languagesOfChannels(selectedChannels, detailsByCode, fallBack);
  }, [detailsByCode, fallBack, selectedChannels]);

  /**
   * What the operator is offered: the channels' languages plus every language
   * the stored scope already holds. The picker never prunes a stored scope on
   * its own — a language the channels no longer offer stays visible and
   * checked, so the operator sees it and is the one who takes it out. Writing a
   * normalised scope back without a user action is exactly how a scope used to
   * be lost before anybody touched it.
   */
  const offeredLanguages = useMemo(() => {
    if (allowedLanguages === null) return null;
    return Array.from(new Set([...allowedLanguages, ...value.languages])).sort();
  }, [allowedLanguages, value.languages]);

  const setChannel = useCallback(
    (channelId: string, checked: boolean) => {
      if (!channels) return;
      const channel = channels.find((item) => item.id === channelId);
      const nextChannels = checked
        ? Array.from(new Set([...value.salesChannelIds, channelId]))
        : value.salesChannelIds.filter((id) => id !== channelId);

      // Languages are pruned against the next channel set only when every
      // channel in it is known; an unknown channel could be the one offering a
      // language the scope holds.
      const nextAllowed = languagesOfChannels(
        channels.filter((item) => nextChannels.includes(item.id)),
        detailsByCode,
        fallBack,
      );

      let nextLanguages =
        nextChannels.length === 0
          ? []
          : nextAllowed === null
            ? value.languages
            : value.languages.filter((language) => nextAllowed.includes(language));

      if (checked && channel && nextLanguages.length === 0) {
        // The channel's first language once known, its default meanwhile —
        // the default is always one of the channel's languages.
        const defaults = languagesForChannel(channel, detailsByCode, true) ?? [];
        if (defaults[0]) nextLanguages = [defaults[0]];
      }

      onChange({ salesChannelIds: nextChannels, languages: nextLanguages });
    },
    [channels, detailsByCode, fallBack, onChange, value.languages, value.salesChannelIds],
  );

  const setLanguage = useCallback(
    (language: string, checked: boolean) => {
      onChange({
        ...value,
        languages: checked
          ? Array.from(new Set([...value.languages, language]))
          : value.languages.filter((item) => item !== language),
      });
    },
    [onChange, value],
  );

  const hasSelectedChannels = value.salesChannelIds.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('scopePicker.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-2">
          {(channels ?? []).map((channel) => (
            <label key={channel.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={value.salesChannelIds.includes(channel.id)}
                onChange={(event) => setChannel(channel.id, event.target.checked)}
              />
              <span>{channel.name['en-US'] ?? channel.code}</span>
              <Badge variant="outline" className="font-mono text-[10px]">
                {channel.code}
              </Badge>
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <Label>{t('scopePicker.languages')}</Label>
          <div className="flex flex-wrap gap-2">
            {!hasSelectedChannels ? (
              <p className="text-sm text-muted-foreground">{t('scopePicker.selectChannel')}</p>
            ) : offeredLanguages === null ? (
              // Loading is said, not shown as a row of unchecked boxes: an
              // empty selection would read as "this content has no language".
              <p className="text-sm text-muted-foreground" role="status">
                {t('scopePicker.loadingLanguages')}
              </p>
            ) : (
              offeredLanguages.map((language) => (
                <label
                  key={language}
                  className="flex items-center gap-2 rounded border px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={value.languages.includes(language)}
                    onChange={(event) => setLanguage(language, event.target.checked)}
                  />
                  <span>{language}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
