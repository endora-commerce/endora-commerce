import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, Trash2 } from 'lucide-react';
import type {
  MegamenuBinding,
  SalesChannelDetail,
  SalesChannelSummary,
} from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { apiClient } from '@/lib/api-client';
import { megamenuClient } from '../api/megamenu-client';

interface BindingsPanelProps {
  menuId: string;
  bindings: MegamenuBinding[];
  onChanged: () => void;
}

interface SalesChannelsResponse {
  data: SalesChannelSummary[];
}

export function BindingsPanel({ menuId, bindings, onChanged }: BindingsPanelProps): ReactNode {
  const t = useTranslation('megamenu');
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [pickedChannelId, setPickedChannelId] = useState('');
  const [pickedLanguage, setPickedLanguage] = useState('');
  const [pickedChannelLanguages, setPickedChannelLanguages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiClient
      .get<SalesChannelsResponse>('/api/v1/admin/sales-channels')
      .then((res) => setChannels(res.data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!pickedChannelId) {
      setPickedChannelLanguages([]);
      return;
    }
    const channel = channels.find((c) => c.id === pickedChannelId);
    if (!channel) return;
    apiClient
      .get<{ data: SalesChannelDetail }>(
        `/api/v1/admin/sales-channels/${encodeURIComponent(channel.code)}`,
      )
      .then((res) => setPickedChannelLanguages(res.data.languages))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [channels, pickedChannelId]);

  const channelById = useMemo(
    () => new Map(channels.map((c) => [c.id, c])),
    [channels],
  );

  const availableLanguages = pickedChannelLanguages;

  const addBinding = async (): Promise<void> => {
    if (!pickedChannelId || !pickedLanguage) return;
    setBusy(true);
    setError(null);
    try {
      await megamenuClient.addBinding(menuId, {
        salesChannelId: pickedChannelId,
        language: pickedLanguage,
      });
      setPickedChannelId('');
      setPickedLanguage('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (binding: MegamenuBinding): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await megamenuClient.removeBinding(menuId, binding.salesChannelId, binding.language);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (binding: MegamenuBinding): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await megamenuClient.activate(menuId, {
        salesChannelId: binding.salesChannelId,
        language: binding.language,
      });
      if (result.previouslyActive) {
        // Surface the swap so the admin knows what happened. A modal
        // would be nicer; an alert keeps the surface light.
        // eslint-disable-next-line no-alert
        window.alert(
          t('bindings.activatedWithPrevious', { name: result.previouslyActive.name }),
        );
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (binding: MegamenuBinding): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await megamenuClient.deactivate(menuId, {
        salesChannelId: binding.salesChannelId,
        language: binding.language,
      });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid grid-cols-12 gap-2">
        <Select
          className="col-span-5"
          value={pickedChannelId}
          onChange={(event) => {
            setPickedChannelId(event.target.value);
            setPickedLanguage('');
          }}
          disabled={busy}
        >
          <option value="">{t('bindings.salesChannelPlaceholder')}</option>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.code}
            </option>
          ))}
        </Select>
        <Select
          className="col-span-4"
          value={pickedLanguage}
          onChange={(event) => setPickedLanguage(event.target.value)}
          disabled={busy || !pickedChannelId}
        >
          <option value="">{t('bindings.languagePlaceholder')}</option>
          {availableLanguages.map((lang: string) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          className="col-span-3"
          onClick={() => void addBinding()}
          disabled={busy || !pickedChannelId || !pickedLanguage}
        >
          {t('bindings.add')}
        </Button>
      </div>

      {bindings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('bindings.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.channel')}</TableHead>
              <TableHead>{t('columns.language')}</TableHead>
              <TableHead>{t('columns.active')}</TableHead>
              <TableHead className="text-right">{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bindings.map((binding) => {
              const channel = channelById.get(binding.salesChannelId);
              return (
                <TableRow key={`${binding.salesChannelId}-${binding.language}`}>
                  <TableCell className="font-mono text-xs">{channel?.code ?? binding.salesChannelId}</TableCell>
                  <TableCell className="font-mono text-xs">{binding.language}</TableCell>
                  <TableCell>
                    {binding.active ? (
                      <Badge>
                        <CheckCircle2 className="mr-1 h-3 w-3" /> {t('state.active')}
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <Circle className="mr-1 h-3 w-3" /> {t('state.staged')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {binding.active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void deactivate(binding)}
                        disabled={busy}
                      >
                        {t('bindings.deactivate')}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => void activate(binding)} disabled={busy}>
                        {t('bindings.activate')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void remove(binding)}
                      disabled={busy}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
