import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChannelMemberEntityType, SalesChannelSummary } from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { salesChannelsClient } from '../api/sales-channels-client';
import { DefaultChannelBadge } from './DefaultChannelBadge';

/**
 * EntityChannelMembership — feature 005 / T065.
 *
 * Drop-in widget for entity edit pages (Product, Customer,
 * Promotion, …). Shows the channels the entity belongs to and lets
 * the operator add or remove memberships from the entity side. The
 * underlying mutation goes through the centralised
 * `/api/v1/admin/sales-channels/:code/:entityType/:entityId` routes
 * (Phase 5b), so the entity edit page never needs its own membership
 * endpoints.
 *
 * Behaviour:
 *   - Loads the entity's current channels and the platform's full
 *     channel list in parallel on mount.
 *   - The Add control shows only channels the entity is not already
 *     in.
 *   - Remove triggers `fallbackToDefault: false` first; on
 *     `ENTITY_WOULD_HAVE_ZERO_CHANNELS`, prompts the operator to
 *     rebind to Default.
 *
 * The widget renders nothing while the entity has no id (e.g. on a
 * newly-created entity that hasn't been saved yet).
 */

export interface EntityChannelMembershipProps {
  entityType: ChannelMemberEntityType;
  entityId: string | null | undefined;
  /** When set, called after every successful add / remove / fallback so the parent can refetch. */
  onChanged?: () => void;
}

export function EntityChannelMembership({
  entityType,
  entityId,
  onChanged,
}: EntityChannelMembershipProps): ReactNode {
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
        salesChannelsClient.listChannelsForEntity(entityType, entityId),
        salesChannelsClient.list({ activeOnly: true }),
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
    () =>
      allChannels.filter(
        (c) => !channels.some((m) => m.id === c.id),
      ),
    [allChannels, channels],
  );

  const handleAdd = useCallback(async (): Promise<void> => {
    if (!entityId || !pickerCode) return;
    setBusy(true);
    setError(null);
    try {
      await salesChannelsClient.addEntityToChannel(pickerCode, entityType, entityId);
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
      setBusy(true);
      setError(null);
      try {
        try {
          await salesChannelsClient.removeEntityFromChannel(code, entityType, entityId, {
            fallbackToDefault: false,
          });
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
              await salesChannelsClient.removeEntityFromChannel(code, entityType, entityId, {
                fallbackToDefault: true,
              });
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
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Sales channels</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading memberships…</p>
        ) : (
          <>
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This {entityType} is not in any channel. Add at least one to make it
                visible to a storefront.
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
                          Inactive
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
                      Remove
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
                  <option value="">Add to channel…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code}
                      {c.systemDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </Select>
                <Button onClick={() => void handleAdd()} disabled={busy || !pickerCode}>
                  Add
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
