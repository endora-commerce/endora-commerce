import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { OrganizationSalesChannelsResponse } from '@endora-commerce/contracts';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { organizationSalesChannelsClient } from '../api/sales-channels.js';
import { SalesChannelChecklist } from '../components/SalesChannelChecklist.js';
import { ImmediateBadge } from '../components/ImmediateBadge.js';

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
 * *Save* replaces the whole set and is offered only once the draft differs from
 * what is stored; an empty draft is refused here, with the reason, before the
 * server refuses it too.
 */
export interface SalesChannelsPanelProps {
  organizationId: string;
}

type Data = OrganizationSalesChannelsResponse['data'];

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function SalesChannelsPanel({ organizationId }: SalesChannelsPanelProps): ReactNode {
  const t = useTranslation('organizations');
  const { hasPermission } = useAuth();
  const canManage = hasPermission('customers:manage');
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const accept = useCallback((next: Data): void => {
    setData(next);
    setDraft(next.options.filter((o) => next.assignedSalesChannelIds.includes(o.id)).map((o) => o.id));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    organizationSalesChannelsClient
      .get(organizationId)
      .then((res) => {
        if (!cancelled) accept(res.data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, attempt, accept]);

  const changed = data !== null && !sameSet(draft, data.assignedSalesChannelIds);
  const empty = draft.length === 0;

  const save = useCallback(async (): Promise<void> => {
    if (empty) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await organizationSalesChannelsClient.replace(organizationId, draft);
      accept(res.data);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.envelope.error.message : t('salesChannels.saveError'));
    } finally {
      setSaving(false);
    }
  }, [accept, draft, empty, organizationId, t]);

  const titleId = `org-sales-channels-title-${organizationId}`;
  const descriptionId = `org-sales-channels-description-${organizationId}`;
  const errorId = `org-sales-channels-error-${organizationId}`;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle id={titleId} className="text-base">
          {t('salesChannels.title')}
          <ImmediateBadge />
        </CardTitle>
        <CardDescription id={descriptionId}>{t('salesChannels.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
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
              value={draft}
              onChange={(next) => {
                setDraft(next);
                setSaved(false);
              }}
              disabled={saving}
              idPrefix={`org-sales-channel-${organizationId}`}
              labelledBy={titleId}
              describedBy={empty ? `${descriptionId} ${errorId}` : descriptionId}
              invalid={empty}
            />
            {empty ? (
              <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
                {t('salesChannels.atLeastOne')}
              </p>
            ) : null}
            {saveError ? (
              <Alert variant="destructive">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                size="sm"
                disabled={!changed || empty || saving}
                onClick={() => void save()}
              >
                {t('salesChannels.save')}
              </Button>
              <span role="status" className="text-xs text-muted-foreground">
                {saving ? t('salesChannels.saving') : saved ? t('salesChannels.saved') : null}
              </span>
            </div>
          </>
        ) : (
          <SalesChannelChecklist
            options={data.options}
            value={data.assignedSalesChannelIds}
            idPrefix={`org-sales-channel-${organizationId}`}
            labelledBy={titleId}
          />
        )}
      </CardContent>
    </Card>
  );
}
