import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { OpportunityDetail } from '@endora-commerce/contracts';
import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Card, CardContent, Input } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AssigneeSection } from '../../components/AssigneeSection.js';
import { InlineEdit } from '../../components/InlineEdit.js';
import { ContactLookup, SalesChannelLookup } from '../../components/LookupPickers.js';
import { OpportunityValue } from '../../components/OpportunityValue.js';
import { TagsSection } from '../../components/TagsSection.js';
import { calendarDateLabel, NO_VALUE } from '../../lib/labels.js';
import { useOpportunityUpdate } from '../../lib/use-opportunity-update.js';

/** The dash every CRM screen shows for a fact with no value — and says "not set". */
function NotSet(): ReactNode {
  const t = useTranslation('crm');
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        {NO_VALUE}
      </span>
      <span className="sr-only">{t('opportunity.facts.notSet')}</span>
    </>
  );
}

/**
 * One fact: a small quiet label above its value. A fact with no value shows the
 * dash every CRM screen uses and *says* "not set" — a dash alone is read as
 * punctuation, or not at all.
 */
function Fact(props: { label: string; children: ReactNode }): ReactNode {
  const empty = props.children === null || props.children === undefined || props.children === '';
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="mt-0.5 text-sm [overflow-wrap:anywhere]">
        {empty ? <NotSet /> : props.children}
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
  /** Where the page's grid puts the column. */
  className?: string;
}

/**
 * The facts of an Opportunity, in one card beside the stage bar and whichever
 * tab is open (User Story 20): four groups, most-asked first — what it is worth and by when, who it is for
 * and who holds it, how it is classified, and the record itself.
 *
 * **Every fact that can change is changed here, where it is shown**
 * (`specs/158-crm-opportunity-inline-editing/`, FR-001): the value and its
 * mode, the expected close date, the contact person, the assignee, the Sales
 * Channel and the tags — each in place, with its own *Save* and *Cancel*, and
 * through the endpoint it always had. What cannot change — the Organization,
 * the source, the number and the dates of the record — is read only.
 *
 * Nothing is behind a hover, and an empty fact is shown as empty instead of
 * being left out, so the column has the same shape for every Opportunity.
 */
export function OpportunitySidebar(props: OpportunitySidebarProps): ReactNode {
  const { opportunity, canWrite, salesChannelName, onChange, reload, className } = props;
  const t = useTranslation('crm');
  const contact = opportunity.customerAccount;
  const update = useOpportunityUpdate(opportunity, onChange);

  return (
    <aside aria-label={t('opportunity.section.details')} className={className}>
      <Card>
        <CardContent className="divide-y divide-border">
      <FactGroup title={t('opportunity.facts.valueAndDeadline')}>
        <OpportunityValue
          opportunity={opportunity}
          canWrite={canWrite}
          onChange={onChange}
          reload={reload}
        />
        <InlineEdit<string>
          label={t('opportunity.field.expectedCloseDate')}
          canEdit={canWrite}
          display={opportunity.expectedCloseDate ? calendarDateLabel(opportunity.expectedCloseDate) : <NotSet />}
          initial={(): string => opportunity.expectedCloseDate ?? ''}
          unchanged={(draft): boolean => draft === (opportunity.expectedCloseDate ?? '')}
          save={(draft): Promise<void> => update({ expectedCloseDate: draft === '' ? null : draft })}
          editor={({ id, draft, setDraft, busy, errorId }): ReactNode => (
            <Input
              id={id}
              type="date"
              value={draft}
              disabled={busy}
              aria-invalid={errorId !== undefined}
              aria-describedby={errorId}
              onChange={(event): void => setDraft(event.target.value)}
            />
          )}
        />
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
        </dl>
        <InlineEdit<string | null>
          label={t('opportunity.field.contact')}
          canEdit={canWrite}
          display={
            contact ? (
              <>
                <span>{contact.name}</span>
                <span className="block text-xs text-muted-foreground">{contact.email}</span>
              </>
            ) : (
              <NotSet />
            )
          }
          initial={(): string | null => contact?.id ?? null}
          unchanged={(draft): boolean => draft === (contact?.id ?? null)}
          save={(draft): Promise<void> => update({ customerAccountId: draft })}
          editor={({ id, draft, setDraft, busy }): ReactNode => (
            <ContactLookup
              id={id}
              ariaLabel={t('opportunity.field.contact')}
              organizationId={opportunity.organization.id}
              value={draft}
              disabled={busy}
              onChange={setDraft}
              placeholder={t('opportunity.picker.contactPlaceholder')}
              emptyMessage={t('opportunity.picker.contactEmpty')}
              {...(contact && draft === contact.id ? { selectedLabel: contact.name } : {})}
            />
          )}
        />
        <AssigneeSection opportunity={opportunity} canWrite={canWrite} onChange={onChange} />
      </FactGroup>

      <FactGroup title={t('opportunity.facts.classification')}>
        <InlineEdit<string | null>
          label={t('opportunity.field.salesChannel')}
          canEdit={canWrite}
          display={salesChannelName ?? <NotSet />}
          initial={(): string | null => opportunity.salesChannelId}
          unchanged={(draft): boolean => draft === opportunity.salesChannelId}
          save={(draft): Promise<void> => update({ salesChannelId: draft })}
          editor={({ id, draft, setDraft, busy }): ReactNode => (
            <SalesChannelLookup
              id={id}
              ariaLabel={t('opportunity.field.salesChannel')}
              value={draft}
              disabled={busy}
              onChange={setDraft}
              placeholder={t('opportunity.picker.salesChannelPlaceholder')}
              emptyMessage={t('opportunity.picker.salesChannelEmpty')}
            />
          )}
        />
        <dl className="space-y-3">
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
        </CardContent>
      </Card>
    </aside>
  );
}
