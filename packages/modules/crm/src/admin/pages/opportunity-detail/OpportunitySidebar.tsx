import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { OpportunityDetail } from '@endora-commerce/contracts';
import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AssigneeSection } from '../../components/AssigneeSection.js';
import { OpportunityValue } from '../../components/OpportunityValue.js';
import { TagsSection } from '../../components/TagsSection.js';
import { calendarDateLabel, NO_VALUE } from '../../lib/labels.js';

/**
 * One fact: a small quiet label above its value. A fact with no value shows the
 * dash every CRM screen uses and *says* "not set" — a dash alone is read as
 * punctuation, or not at all.
 */
function Fact(props: { label: string; children: ReactNode }): ReactNode {
  const t = useTranslation('crm');
  const empty = props.children === null || props.children === undefined || props.children === '';
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="mt-0.5 text-sm [overflow-wrap:anywhere]">
        {empty ? (
          <>
            <span aria-hidden="true" className="text-muted-foreground">
              {NO_VALUE}
            </span>
            <span className="sr-only">{t('opportunity.facts.notSet')}</span>
          </>
        ) : (
          props.children
        )}
      </dd>
    </div>
  );
}

/** A group of facts under a small heading. */
function FactGroup(props: { title: string; children: ReactNode }): ReactNode {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3 py-5 first:pt-0 last:pb-0">
      <h2
        id={headingId}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

export interface OpportunitySidebarProps {
  opportunity: OpportunityDetail;
  /** `crm:write` — without it every fact is read and none can be changed. */
  canWrite: boolean;
  /** The Sales Channel's name, or `null` while it is unknown or there is none. */
  salesChannelName: string | null;
  onChange: (next: OpportunityDetail) => void;
  reload: () => Promise<void>;
}

/**
 * The facts of an Opportunity, beside whichever tab is open (User Story 20):
 * four groups, most-asked first — what it is worth and by when, who it is for
 * and who holds it, how it is classified, and the record itself.
 *
 * **A fact is changed here only where it could already be changed in one
 * gesture**: the value's mode, the assignee, the tags — each through the
 * endpoint it always had. Everything else is edited with the form the header's
 * *Edit* opens; this column adds no way of writing anything.
 *
 * Nothing is behind a hover, and an empty fact is shown as empty instead of
 * being left out, so the column has the same shape for every Opportunity.
 */
export function OpportunitySidebar(props: OpportunitySidebarProps): ReactNode {
  const { opportunity, canWrite, salesChannelName, onChange, reload } = props;
  const t = useTranslation('crm');
  const contact = opportunity.customerAccount;

  return (
    <aside aria-label={t('opportunity.section.details')} className="divide-y divide-border">
      <FactGroup title={t('opportunity.facts.valueAndDeadline')}>
        <OpportunityValue
          opportunity={opportunity}
          canWrite={canWrite}
          onChange={onChange}
          reload={reload}
        />
        <dl className="space-y-3">
          <Fact label={t('opportunity.field.expectedCloseDate')}>
            {opportunity.expectedCloseDate
              ? calendarDateLabel(opportunity.expectedCloseDate)
              : null}
          </Fact>
        </dl>
      </FactGroup>

      <FactGroup title={t('opportunity.facts.customer')}>
        <dl className="space-y-3">
          <Fact label={t('opportunity.field.organization')}>
            <Link
              to={`/organizations/${opportunity.organization.id}`}
              className="-my-3 inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline sm:my-0 sm:min-h-0"
            >
              {opportunity.organization.name}
            </Link>
          </Fact>
          <Fact label={t('opportunity.field.contact')}>
            {contact ? (
              <>
                <span>{contact.name}</span>
                <span className="block text-xs text-muted-foreground">{contact.email}</span>
              </>
            ) : null}
          </Fact>
        </dl>
        <AssigneeSection opportunity={opportunity} canWrite={canWrite} onChange={onChange} />
      </FactGroup>

      <FactGroup title={t('opportunity.facts.classification')}>
        <dl className="space-y-3">
          <Fact label={t('opportunity.field.salesChannel')}>{salesChannelName}</Fact>
          <Fact label={t('opportunity.field.source')}>
            {t(`opportunity.source.${opportunity.source}`)}
          </Fact>
        </dl>
        <TagsSection opportunity={opportunity} canWrite={canWrite} onChange={onChange} />
      </FactGroup>

      <FactGroup title={t('opportunity.facts.record')}>
        <dl className="space-y-3">
          <Fact label={t('opportunity.field.number')}>{opportunity.number}</Fact>
          <Fact label={t('opportunity.field.created')}>
            {formatDateTime(opportunity.createdAt)}
          </Fact>
          <Fact label={t('opportunity.field.updated')}>
            {formatDateTime(opportunity.updatedAt)}
          </Fact>
          {opportunity.closedAt ? (
            <Fact label={t('opportunity.field.closed')}>
              {formatDateTime(opportunity.closedAt)}
            </Fact>
          ) : null}
        </dl>
      </FactGroup>
    </aside>
  );
}
