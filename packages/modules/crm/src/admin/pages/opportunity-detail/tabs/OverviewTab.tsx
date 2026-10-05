import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import type {
  OpportunityDetail,
  OpportunityTransitionResult,
  PropagationOutcome,
} from '@endora-commerce/contracts';
import { formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { Button } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi, type OrderStatusOption } from '../../../api.js';
import { LinkedDocuments } from '../../../components/LinkedDocuments.js';
import { salesChannelLabel } from '../../../components/LookupPickers.js';
import { OpportunityEditForm } from '../../../components/OpportunityEditForm.js';
import { PropagationOutcomes } from '../../../components/PropagationOutcomes.js';
import { StatusControl } from '../../../components/StatusControl.js';
import { calendarDateLabel, moneyLabel, NO_VALUE } from '../../../lib/labels.js';
import type { OpportunityTabProps } from '../tabs.js';

/**
 * The *Overview* tab of an Opportunity: its status and the moves allowed from
 * it, what became of the linked Orders, the linked Orders themselves, and the
 * Opportunity's own details.
 *
 * The outcomes of the last move are kept **here**, between the control that
 * produces them and the section that shows them: a move's answer carries every
 * Order's outcome, applied ones included, while the Opportunity itself only
 * remembers the ones still unresolved. Showing both is what tells a Sales Rep
 * "three Orders moved, one did not" rather than only the exception.
 */
export function OverviewTab(props: OpportunityTabProps): ReactNode {
  const { opportunity, onChange, reload } = props;
  const t = useTranslation('crm');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const statusHeadingId = useId();
  const detailsHeadingId = useId();

  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);
  const [salesChannelName, setSalesChannelName] = useState<string | null>(null);
  /** Outcomes of the moves and retries made during this visit, newest move first. */
  const [recent, setRecent] = useState<PropagationOutcome[]>([]);
  const [outcomesShown, setOutcomesShown] = useState(false);
  const [editing, setEditing] = useState(false);
  /** Spoken once an edit is saved; the details below are the visible confirmation. */
  const [editNotice, setEditNotice] = useState('');

  // Order status names are `orders`' and need `orders:read`. Without them the
  // codes are shown — less friendly, still true.
  useEffect(() => {
    let alive = true;
    crmApi
      .listOrderStatuses()
      .then((statuses) => {
        if (alive) setOrderStatuses(statuses);
      })
      .catch(() => {
        if (alive) setOrderStatuses([]);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  const salesChannelId = opportunity.salesChannelId;
  useEffect(() => {
    if (!salesChannelId) {
      setSalesChannelName(null);
      return undefined;
    }
    let alive = true;
    crmApi
      .lookupSalesChannels()
      .then((channels) => {
        if (!alive) return;
        const channel = channels.find((item) => item.id === salesChannelId);
        setSalesChannelName(channel ? salesChannelLabel(channel, language) : null);
      })
      .catch(() => {
        if (alive) setSalesChannelName(null);
      });
    return (): void => {
      alive = false;
    };
  }, [salesChannelId, language]);

  const unresolvedIds = useMemo(
    () => new Set(opportunity.unresolvedPropagations.map((outcome) => outcome.id)),
    [opportunity.unresolvedPropagations],
  );

  // This visit's outcomes first, then the refusals left open by earlier ones.
  const outcomes = useMemo(() => {
    const seen = new Set(recent.map((outcome) => outcome.id));
    return [
      ...recent,
      ...opportunity.unresolvedPropagations.filter((outcome) => !seen.has(outcome.id)),
    ];
  }, [recent, opportunity.unresolvedPropagations]);

  useEffect(() => {
    if (outcomes.length > 0) setOutcomesShown(true);
  }, [outcomes.length]);

  const onMoved = (result: OpportunityTransitionResult): void => {
    setRecent(result.propagation);
    onChange(result.opportunity);
  };

  const onRetried = async (previousId: string, outcome: PropagationOutcome): Promise<void> => {
    await reload();
    setRecent((previous) =>
      previous.some((item) => item.id === previousId)
        ? previous.map((item) => (item.id === previousId ? outcome : item))
        : [outcome, ...previous],
    );
  };

  const onDismissed = async (id: string): Promise<void> => {
    await reload();
    setRecent((previous) => previous.filter((item) => item.id !== id));
  };

  const onEdited = (next: OpportunityDetail): void => {
    setEditing(false);
    if (next !== opportunity) {
      onChange(next);
      setEditNotice(t('opportunity.edit.saved'));
    }
  };

  const contact = opportunity.customerAccount;

  return (
    <div className="divide-y divide-border [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
      <section aria-labelledby={statusHeadingId} className="space-y-3">
        <h2 id={statusHeadingId} className="text-sm font-semibold tracking-tight">
          {t('opportunity.section.status')}
        </h2>
        <StatusControl
          opportunity={opportunity}
          canWrite={canWrite}
          onMoved={onMoved}
          reload={reload}
        />
      </section>

      {outcomesShown || outcomes.length > 0 ? (
        <PropagationOutcomes
          opportunityId={opportunity.id}
          outcomes={outcomes}
          unresolvedIds={unresolvedIds}
          orderStatuses={orderStatuses}
          language={language}
          canWrite={canWrite}
          onRetried={onRetried}
          onDismissed={onDismissed}
        />
      ) : null}

      <LinkedDocuments
        opportunity={opportunity}
        orderStatuses={orderStatuses}
        language={language}
        canWrite={canWrite}
        reload={reload}
      />

      {editing ? (
        <section>
          <OpportunityEditForm
            opportunity={opportunity}
            onSaved={onEdited}
            onReloaded={onChange}
            onCancel={(): void => setEditing(false)}
          />
        </section>
      ) : (
        <section aria-labelledby={detailsHeadingId} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={detailsHeadingId} className="text-sm font-semibold tracking-tight">
              {t('opportunity.section.details')}
            </h2>
            {canWrite ? (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
                onClick={(): void => {
                  setEditNotice('');
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden="true" className="size-4" />
                {t('opportunity.edit.open')}
              </Button>
            ) : null}
          </div>
          <p role="status" className="sr-only">
            {editNotice}
          </p>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t('opportunity.field.organization')}
              </dt>
              <dd>
                <Link
                  to={`/organizations/${opportunity.organization.id}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {opportunity.organization.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('opportunity.field.contact')}</dt>
              <dd>
                {contact ? (
                  <>
                    <span>{contact.name}</span>
                    <span className="block text-xs text-muted-foreground">{contact.email}</span>
                  </>
                ) : (
                  NO_VALUE
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t('opportunity.field.salesChannel')}
              </dt>
              <dd>{salesChannelName ?? NO_VALUE}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('opportunity.field.value')}</dt>
              <dd className="tabular-nums">
                {moneyLabel(opportunity.value, opportunity.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t('opportunity.field.expectedCloseDate')}
              </dt>
              <dd>{calendarDateLabel(opportunity.expectedCloseDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('opportunity.field.source')}</dt>
              <dd>{t(`opportunity.source.${opportunity.source}`)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('opportunity.field.created')}</dt>
              <dd>{formatDateTime(opportunity.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('opportunity.field.updated')}</dt>
              <dd>{formatDateTime(opportunity.updatedAt)}</dd>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs text-muted-foreground">
                {t('opportunity.field.description')}
              </dt>
              <dd className="whitespace-pre-wrap break-words">
                {opportunity.description ? opportunity.description : NO_VALUE}
              </dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}

export default OverviewTab;
