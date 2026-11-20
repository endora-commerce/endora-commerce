import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { OrganizationSalesChannelsResponse } from '@endora-commerce/contracts';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, EditorSection } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { organizationSalesChannelsClient } from '../api/sales-channels.js';
import { SalesChannelChecklist, channelLabel } from '../components/SalesChannelChecklist.js';
import { ImmediateBadge } from '@endora-commerce/admin-kit/components';

/**
 * The stores an Organization's members may sign in and shop on (feature 154,
 * US5; `specs/154-sales-channel-access/contracts/admin-api-and-ui.md` §2).
 *
 * This module's own panel on this module's own page, behind the customer
 * permissions: the assignment is part of the Organization's commercial
 * relationship, so the operator who manages customers manages it without being
 * granted the sales-channel screens. It replaced `sales_channels`' zone
 * contribution here, which added and removed one channel at a time behind
 * `sales_channels:write` — two editors of one assignment on one page would have
 * disagreed about who may change it.
 *
 * An immediate action (spec 180 FR-061; `module-admin-surfaces.md` FR-083 §4,
 * issue #1305): a tick writes at once, so the panel holds no draft and has no
 * Save beside the page's one Save. The API replaces the whole set, so each tick
 * sends the stored set with that one channel added or removed, and the panel
 * shows what the server answers. One write at a time: while one is in flight
 * every box is `aria-disabled` (still focusable, so the focus stays on the box
 * just ticked) and a further tick is ignored. A failed write leaves the stored
 * set showing — the tick is put back — and says why. Unticking the last channel
 * is refused here, with the reason, before the server refuses it too.
 *
 * Removing a channel asks nothing: it deletes one assignment row, which the
 * same tick puts back, and both are audited.
 */
export interface SalesChannelsPanelProps {
  organizationId: string;
}

type Data = OrganizationSalesChannelsResponse['data'];

interface Pending {
  channelId: string;
  adding: boolean;
}

function assignedIn(data: Data): string[] {
  return data.options.filter((o) => data.assignedSalesChannelIds.includes(o.id)).map((o) => o.id);
}

export function SalesChannelsPanel({ organizationId }: SalesChannelsPanelProps): ReactNode {
  const t = useTranslation('organizations');
  const { hasPermission } = useAuth();
  const canManage = hasPermission('customers:manage');
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState<Pending | null>(null);
  const [writeError, setWriteError] = useState<{ channelId: string; message: string | null } | null>(null);
  const [lastRefused, setLastRefused] = useState(false);
  // State lags a second click inside one tick; the ref does not.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    organizationSalesChannelsClient
      .get(organizationId)
      .then((res) => {
        if (!cancelled) setData(res.data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, attempt]);

  const stored = data ? assignedIn(data) : [];
  const shown =
    pending === null
      ? stored
      : pending.adding
        ? [...stored, pending.channelId]
        : stored.filter((id) => id !== pending.channelId);

  const nameOf = (channelId: string): string => {
    const option = data?.options.find((o) => o.id === channelId);
    return option ? channelLabel(option) : channelId;
  };

  const toggle = useCallback(
    async (next: string[]): Promise<void> => {
      if (inFlight.current || data === null) return;
      const current = assignedIn(data);
      const added = next.find((id) => !current.includes(id));
      const removed = current.find((id) => !next.includes(id));
      const channelId = added ?? removed;
      if (channelId === undefined) return;
      setDone(null);
      setWriteError(null);
      if (next.length === 0) {
        setLastRefused(true);
        return;
      }
      setLastRefused(false);
      const step: Pending = { channelId, adding: added !== undefined };
      inFlight.current = true;
      setPending(step);
      try {
        const res = await organizationSalesChannelsClient.replace(organizationId, next);
        setData(res.data);
        setDone(step);
      } catch (err) {
        setWriteError({ channelId, message: err instanceof ApiError ? err.envelope.error.message : null });
      } finally {
        inFlight.current = false;
        setPending(null);
      }
    },
    [data, organizationId],
  );

  // `EditorSection` names its heading `<id>-title` and its description `<id>-description`.
  const sectionId = `org-sales-channels-${organizationId}`;
  const titleId = `${sectionId}-title`;
  const descriptionId = `${sectionId}-description`;
  const errorId = `org-sales-channels-error-${organizationId}`;

  const statusText =
    pending !== null
      ? t(pending.adding ? 'salesChannels.adding' : 'salesChannels.removing', { channel: nameOf(pending.channelId) })
      : done !== null
        ? t(done.adding ? 'salesChannels.added' : 'salesChannels.removed', { channel: nameOf(done.channelId) })
        : null;

  return (
    // Issue #1515 — a section of the Commerce tab's card, not a card of its own.
    <EditorSection
      id={sectionId}
      title={
        <>
          {t('salesChannels.title')}
          <ImmediateBadge className="align-middle" />
        </>
      }
      description={t('salesChannels.description')}
      contentClassName="grid gap-3"
    >
        {loadError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{t('salesChannels.loadError')}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                {t('salesChannels.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : data === null ? (
          <p className="text-sm text-muted-foreground">{t('salesChannels.loading')}</p>
        ) : canManage ? (
          <>
            <SalesChannelChecklist
              options={data.options}
              value={shown}
              onChange={(next) => void toggle(next)}
              pendingId={pending?.channelId ?? null}
              idPrefix={`org-sales-channel-${organizationId}`}
              labelledBy={titleId}
              describedBy={lastRefused || writeError ? `${descriptionId} ${errorId}` : descriptionId}
              invalid={lastRefused}
            />
            {lastRefused ? (
              <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
                {t('salesChannels.atLeastOne')}
              </p>
            ) : writeError ? (
              <Alert id={errorId} variant="destructive">
                <AlertDescription>
                  {t('salesChannels.toggleError', { channel: nameOf(writeError.channelId) })}
                  {writeError.message ? ` ${writeError.message}` : null}
                </AlertDescription>
              </Alert>
            ) : null}
            <p role="status" className="text-xs text-muted-foreground">
              {statusText}
            </p>
          </>
        ) : (
          <SalesChannelChecklist
            options={data.options}
            value={data.assignedSalesChannelIds}
            idPrefix={`org-sales-channel-${organizationId}`}
            labelledBy={titleId}
          />
        )}
    </EditorSection>
  );
}
