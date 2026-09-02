import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  ChannelMemberEntityType,
  SalesChannelListResponse,
  SalesChannelSummary,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { DefaultChannelBadge } from './DefaultChannelBadge.js';

/**
 * The channels an entity belongs to, editable from the entity's own editor
 * (feature 005 / T065).
 *
 * Loads the entity's current channels and the platform's full channel list in
 * parallel on mount. The Add control offers only channels the entity is not
 * already in; Remove tries `fallbackToDefault: false` first and, on
 * `ENTITY_WOULD_HAVE_ZERO_CHANNELS`, asks the operator whether to rebind to the
 * system default. The mutation goes through the centralised
 * `/api/v1/admin/sales-channels/:code/:entityType/:entityId` routes, so an
 * entity editor never needs membership endpoints of its own.
 *
 * ## Why the calls are rebuilt rather than the client moved (feature 091, P7a)
 *
 * `catalog`'s product editor imported this file by path — one of the three
 * admin keys in `backend/scripts/ledgers/cross-module-imports/catalog.ts`. It
 * lives in this module's package now and reaches that screen as a
 * `product.editor.channels` contribution. Its four reads and writes are HTTP
 * paths whose payload types are already `@endora-commerce/contracts`', so they
 * are rebuilt from the published `apiClient` here (P2's exit) rather than
 * dragging that module's admin API client along, which at the time would have
 * been a package reaching back into the admin application. Batch 14 moved the
 * client into this package as `../api/sales-channels-client.ts`; this file goes
 * on building its own requests, because a zone contribution rendered inside
 * another module's screen has no business carrying a client whose only other
 * readers are two screens it never renders with.
 *
 * **P7b deleted the copy.** One stood at
 * `admin/src/modules/sales_channels/components/` for the length of P7a, serving
 * `organizations`' detail screen; that screen is a zone mount now, nothing
 * imported the file, and it is gone. Nothing in this estate compares two copies
 * of one component, so the retiring condition was written here rather than left
 * to be remembered.
 *
 * `DefaultChannelBadge` beside it is the other half of that copy and **went
 * the same way in batch 14**, which is what the note that stood here said would
 * happen: this module's own two screens moved into this package, they import the
 * sibling file, and the `admin/src` copy is deleted.
 *
 * The `entityId` guard below is unreachable under a zone — all three mounts
 * have an id before they mount — and stays as the component's own contract.
 */

export interface EntityChannelMembershipProps {
  entityType: ChannelMemberEntityType;
  entityId: string | null | undefined;
  /** When set, called after every successful add / remove / fallback so the parent can refetch. */
  onChanged?: () => void;
}

interface ChannelsForEntityResponse {
  entityType: ChannelMemberEntityType;
  entityId: string;
  channels: SalesChannelSummary[];
}

const BASE = '/api/v1/admin/sales-channels';

export function EntityChannelMembership({
  entityType,
  entityId,
  onChanged,
}: EntityChannelMembershipProps): ReactNode {
  const t = useTranslation('sales_channels');
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [allChannels, setAllChannels] = useState<SalesChannelSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerCode, setPickerCode] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    if (!entityId) return;
    setLoading(true);
    setError(null);
    try {
      const [forEntity, all] = await Promise.all([
        apiClient.get<ChannelsForEntityResponse>(
          `${BASE}/by-entity/${entityType}/${encodeURIComponent(entityId)}`,
        ),
        apiClient.get<SalesChannelListResponse>(`${BASE}?activeOnly=true`),
      ]);
      setChannels(forEntity.channels);
      setAllChannels(all.items);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : 'Failed to load channel memberships.',
      );
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const candidates = useMemo(
    () => allChannels.filter((c) => !channels.some((m) => m.id === c.id)),
    [allChannels, channels],
  );

  const handleAdd = useCallback(async (): Promise<void> => {
    if (!entityId || !pickerCode) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.put(
        `${BASE}/${encodeURIComponent(pickerCode)}/${entityType}/${encodeURIComponent(entityId)}`,
        {},
      );
      setPickerCode('');
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Add failed.');
    } finally {
      setBusy(false);
    }
  }, [pickerCode, entityType, entityId, refresh, onChanged]);

  const handleRemove = useCallback(
    async (code: string): Promise<void> => {
      if (!entityId) return;
      const path = `${BASE}/${encodeURIComponent(code)}/${entityType}/${encodeURIComponent(entityId)}`;
      setBusy(true);
      setError(null);
      try {
        try {
          await apiClient.delete(path);
        } catch (err) {
          if (
            err instanceof ApiError &&
            err.envelope.error.code === 'ENTITY_WOULD_HAVE_ZERO_CHANNELS'
          ) {
            if (
              window.confirm(
                `${err.envelope.error.message}\n\nRebind this ${entityType} to the system default channel and continue?`,
              )
            ) {
              await apiClient.delete(`${path}?fallbackToDefault=true`);
            } else {
              return;
            }
          } else {
            throw err;
          }
        }
        await refresh();
        onChanged?.();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Remove failed.');
      } finally {
        setBusy(false);
      }
    },
    [entityType, entityId, refresh, onChanged],
  );

  if (!entityId) return null;

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">{t('membership.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('membership.loading')}</p>
        ) : (
          <>
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('membership.empty', { entityType })}
              </p>
            ) : (
              <ul className="grid gap-2">
                {channels.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between rounded-md border border-input p-2"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs">{c.code}</span>
                      <DefaultChannelBadge systemDefault={c.systemDefault} />
                      {!c.active && (
                        <Badge variant="outline" className="text-[10px]">
                          {t('status.inactive')}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {c.name['en-US'] ?? c.name['en'] ?? Object.values(c.name)[0] ?? ''}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleRemove(c.code)}
                    >
                      {t('membership.action.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {candidates.length > 0 && (
              <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                <Select
                  value={pickerCode}
                  onChange={(e) => setPickerCode(e.target.value)}
                  disabled={busy}
                >
                  <option value="">{t('membership.action.pickChannel')}</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code}
                      {c.systemDefault ? t('membership.defaultSuffix') : ''}
                    </option>
                  ))}
                </Select>
                <Button onClick={() => void handleAdd()} disabled={busy || !pickerCode}>
                  {t('membership.action.add')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
