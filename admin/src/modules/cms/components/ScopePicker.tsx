import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SalesChannelDetail, SalesChannelSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/i18n/useTranslation';
import { salesChannelsClient } from '@/modules/sales_channels/api/sales-channels-client';

export interface CmsScopeValue {
  salesChannelIds: string[];
  languages: string[];
}

function languagesForChannel(
  channel: SalesChannelSummary,
  detailsByCode: Record<string, SalesChannelDetail>,
): string[] {
  const detail = detailsByCode[channel.code];
  if (detail?.languages?.length) return detail.languages;
  return channel.defaultLanguage ? [channel.defaultLanguage] : [];
}

export function ScopePicker({
  value,
  onChange,
}: {
  value: CmsScopeValue;
  onChange: (value: CmsScopeValue) => void;
}): ReactNode {
  const t = useTranslation('cms');
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [detailsByCode, setDetailsByCode] = useState<Record<string, SalesChannelDetail>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    salesChannelsClient
      .list({ activeOnly: true, pageSize: 100 })
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

    void Promise.all(missing.map((channel) => salesChannelsClient.getByCode(channel.code)))
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
        <CardTitle className="text-base">{t('scope.title')}</CardTitle>
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
          <Label>{t('fields.languages')}</Label>
          <div className="flex flex-wrap gap-2">
            {allowedLanguages.map((language) => (
              <label key={language} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                <Checkbox
                  checked={value.languages.includes(language)}
                  onChange={(event) => setLanguage(language, event.target.checked)}
                />
                <span>{language}</span>
              </label>
            ))}
            {!hasSelectedChannels ? (
              <p className="text-sm text-muted-foreground">{t('scope.selectChannel')}</p>
            ) : allowedLanguages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('scope.loadingLanguages')}</p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
