import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, Trash2 } from 'lucide-react';
import type {
  MegamenuBinding,
  SalesChannelDetail,
  SalesChannelSummary,
} from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  InlineStatus,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { useConfirmDialog, useRemovalFocus } from '@endora-commerce/admin-kit/components';

import { megamenuClient } from '../api/megamenu-client.js';

interface BindingsPanelProps {
  menuId: string;
  bindings: MegamenuBinding[];
  onChanged: () => void;
}

function bindingKey(binding: MegamenuBinding): string {
  return `${binding.salesChannelId}:${binding.language}`;
}

// GET /admin/sales-channels returns a paginated envelope (`items`), not a
// `data` array — reading the wrong key set `channels` to undefined and crashed
// the whole Megamenu editor on `channels.map`.
interface SalesChannelsResponse {
  items: SalesChannelSummary[];
}

/**
 * A megamenu's (sales channel, language) bindings. Every change here applies at once, on its own,
 * outside the editor's header Save — the editor marks the section with the kit's `ImmediateBadge`
 * — so the result of each is said in this section's `InlineStatus` (issue #1512, CONTENT-09;
 * DEC-08), and no button here is filled: the header Save is the screen's one primary (Von Restorff).
 */
export function BindingsPanel({ menuId, bindings, onChanged }: BindingsPanelProps): ReactNode {
  const t = useTranslation('megamenu');
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [pickedChannelId, setPickedChannelId] = useState('');
  const [pickedLanguage, setPickedLanguage] = useState('');
  const [pickedChannelLanguages, setPickedChannelLanguages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Issue #313 — what an activation swapped out, said on the panel rather than in `alert()`.
  const status = useInlineStatus();
  const [busy, setBusy] = useState(false);
  // Removing a binding takes the menu off a storefront scope: asked first, the request runs inside
  // the question, and focus moves to the next row's remove button, else to the add row (WCAG 2.4.3).
  const { confirm, confirmDialog } = useConfirmDialog();
  const removalFocus = useRemovalFocus(bindings, bindingKey, true);

  useEffect(() => {
    apiClient
      .get<SalesChannelsResponse>('/api/v1/admin/sales-channels?pageSize=100')
      .then((res) => setChannels(res.items ?? []))
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
    status.clear();
    try {
      await megamenuClient.addBinding(menuId, {
        salesChannelId: pickedChannelId,
        language: pickedLanguage,
      });
      setPickedChannelId('');
      setPickedLanguage('');
      status.show(t('bindings.added'));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (binding: MegamenuBinding): Promise<void> => {
    setError(null);
    status.clear();
    const scope = { channel: channelById.get(binding.salesChannelId)?.code ?? binding.salesChannelId, language: binding.language };
    const removed = await confirm({
      title: t('bindings.removeConfirm.title'),
      message: t('bindings.removeConfirm.message', scope),
      confirmLabel: t('bindings.removeConfirm.action'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      action: () => megamenuClient.removeBinding(menuId, binding.salesChannelId, binding.language),
      describeError: (err) => (err instanceof Error ? err.message : String(err)),
      returnFocusTo: removalFocus.returnFocusTo(binding),
    });
    if (!removed) return;
    status.show(t('bindings.removed'));
    onChanged();
  };

  const activate = async (binding: MegamenuBinding): Promise<void> => {
    setBusy(true);
    setError(null);
    status.clear();
    try {
      const result = await megamenuClient.activate(menuId, {
        salesChannelId: binding.salesChannelId,
        language: binding.language,
      });
      // Surface a swap so the admin knows what else changed.
      status.show(
        result.previouslyActive
          ? t('bindings.activatedWithPrevious', { name: result.previouslyActive.name })
          : t('bindings.activated'),
      );
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
    status.clear();
    try {
      await megamenuClient.deactivate(menuId, {
        salesChannelId: binding.salesChannelId,
        language: binding.language,
      });
      status.show(t('bindings.deactivated'));
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
      {/* Reflows below `sm` instead of squeezing three controls into one row (WCAG 1.4.10). */}
      <div className="grid gap-2 sm:grid-cols-12">
        <Select
          // Focus lands here once the last binding is removed: *Add binding* is disabled until both are picked.
          ref={(element) => {
            removalFocus.createRef.current = element;
          }}
          className="sm:col-span-5"
          aria-label={t('bindings.salesChannelLabel')}
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
          className="sm:col-span-4"
          aria-label={t('bindings.languageLabel')}
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
          variant="outline"
          className="sm:col-span-3"
          onClick={() => void addBinding()}
          disabled={busy || !pickedChannelId || !pickedLanguage}
        >
          {t('bindings.add')}
        </Button>
      </div>
      {/* Mounted before it has text, so each result is announced when it arrives (WCAG 4.1.3). */}
      <InlineStatus {...status.props} />

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
                      <Button size="sm" variant="outline" onClick={() => void activate(binding)} disabled={busy}>
                        {t('bindings.activate')}
                      </Button>
                    )}
                    <Button
                      ref={removalFocus.targetRef(binding)}
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={t('bindings.remove', {
                        channel: channel?.code ?? binding.salesChannelId,
                        language: binding.language,
                      })}
                      onClick={() => void remove(binding)}
                      disabled={busy}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {confirmDialog}
    </div>
  );
}
