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

function languagesForChannel(
  channel: SalesChannelSummary,
  detailsByCode: Record<string, SalesChannelDetail>,
): string[] {
  const detail = detailsByCode[channel.code];
  if (detail?.languages?.length) return detail.languages;
  return channel.defaultLanguage ? [channel.defaultLanguage] : [];
}

export function ScopePicker({ value, onChange }: ScopePickerProps): ReactNode {
  const t = useTranslation('core');
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
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
    () => channels.filter((channel) => value.salesChannelIds.includes(channel.id)),
    [channels, value.salesChannelIds],
  );

  const allowedLanguages = useMemo(() => {
    const out = new Set<string>();
    for (const channel of selectedChannels) {
      for (const language of languagesForChannel(channel, detailsByCode)) {
        out.add(language);
      }
    }
    return Array.from(out).sort();
  }, [detailsByCode, selectedChannels]);

  useEffect(() => {
    if (value.salesChannelIds.length === 0 || allowedLanguages.length === 0) return;

    const allowed = new Set(allowedLanguages);
    const pruned = value.languages.filter((language) => allowed.has(language));
    if (pruned.length === value.languages.length) return;

    onChange({
      salesChannelIds: value.salesChannelIds,
      languages: pruned,
    });
  }, [allowedLanguages, onChange, value.languages, value.salesChannelIds]);

  const setChannel = useCallback(
    (channelId: string, checked: boolean) => {
      const channel = channels.find((item) => item.id === channelId);
      const nextChannels = checked
        ? Array.from(new Set([...value.salesChannelIds, channelId]))
        : value.salesChannelIds.filter((id) => id !== channelId);

      const nextAllowed = new Set<string>();
      for (const selected of channels) {
        if (!nextChannels.includes(selected.id)) continue;
        for (const language of languagesForChannel(selected, detailsByCode)) {
          nextAllowed.add(language);
        }
      }

      let nextLanguages =
        nextChannels.length === 0
          ? []
          : value.languages.filter((language) => nextAllowed.has(language));

      if (checked && channel && nextLanguages.length === 0) {
        const defaults = languagesForChannel(channel, detailsByCode);
        if (defaults[0]) nextLanguages = [defaults[0]];
      }

      onChange({ salesChannelIds: nextChannels, languages: nextLanguages });
    },
    [channels, detailsByCode, onChange, value.languages, value.salesChannelIds],
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
          {channels.map((channel) => (
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
            {allowedLanguages.map((language) => (
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
            ))}
            {!hasSelectedChannels ? (
              <p className="text-sm text-muted-foreground">{t('scopePicker.selectChannel')}</p>
            ) : allowedLanguages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('scopePicker.loadingLanguages')}</p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
