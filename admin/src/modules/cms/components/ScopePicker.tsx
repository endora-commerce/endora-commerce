import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SalesChannelDetail, SalesChannelSummary } from '@b2b/contracts';
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

export function ScopePicker({
  value,
  onChange,
}: {
  value: CmsScopeValue;
  onChange: (value: CmsScopeValue) => void;
}): ReactNode {
  const t = useTranslation('cms');
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [details, setDetails] = useState<Record<string, SalesChannelDetail>>({});
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
    let live = true;
    const missing = channels.filter(
      (channel) => value.salesChannelIds.includes(channel.id) && !details[channel.id],
    );
    if (missing.length === 0) return;

    Promise.all(missing.map((channel) => salesChannelsClient.getByCode(channel.code)))
      .then((rows) => {
        if (!live) return;
        setDetails((current) => ({
          ...current,
          ...Object.fromEntries(rows.map((row) => [row.id, row])),
        }));
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      live = false;
    };
  }, [channels, details, value.salesChannelIds]);

  const allowedLanguages = useMemo(() => {
    const out = new Set<string>();
    for (const channelId of value.salesChannelIds) {
      const detail = details[channelId];
      if (detail) {
        for (const language of detail.languages) out.add(language);
      }
    }
    return Array.from(out).sort();
  }, [details, value.salesChannelIds]);

  const setChannel = useCallback(
    (channelId: string, checked: boolean) => {
      const nextChannels = checked
        ? Array.from(new Set([...value.salesChannelIds, channelId]))
        : value.salesChannelIds.filter((id) => id !== channelId);
      const nextLanguages =
        nextChannels.length === 0
          ? []
          : value.languages.filter(
              (language) =>
                allowedLanguages.includes(language) || details[channelId]?.languages.includes(language),
            );
      onChange({ salesChannelIds: nextChannels, languages: nextLanguages });
    },
    [allowedLanguages, details, onChange, value.languages, value.salesChannelIds],
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
            {allowedLanguages.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('scope.selectChannel')}</p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
