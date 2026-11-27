import type { ReactNode } from 'react';
import { CommentThread } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useCrmReferences, useOpportunityComments, useOrderStatusLabel } from '../../../lib/references.js';
import type { OpportunityTabProps } from '../tabs.js';

/**
 * The *Notes* tab (User Story 4): what the people working an Opportunity want
 * remembered. A note is its author's — only they may edit or delete it. A note
 * carries the operator's `opportunity_note` custom fields (issue #2005), for a
 * reader who holds `custom_fields:read`.
 */
export function NotesTab(props: OpportunityTabProps): ReactNode {
  const t = useTranslation('crm');
  const { hasPermission } = useAuth();
  const { kinds, lookups } = useCrmReferences({
    organizationId: props.opportunity.organization.id,
    opportunityId: props.opportunity.id,
  });
  const api = useOpportunityComments(props.opportunity.id, 'note');
  const orderStatusLabel = useOrderStatusLabel(props.orderStatuses);
  return (
    <CommentThread
      kind="note"
      api={api}
      canWrite={hasPermission('crm:write')}
      referenceKinds={kinds}
      lookups={lookups}
      orderStatusLabel={orderStatusLabel}
      // Issue #2005 — the operator's `opportunity_note` fields, in the composer and on each note.
      // Reading their definitions is `custom_fields`' permission: without it, none are offered.
      {...(hasPermission('custom_fields:read') ? { customFieldEntityType: 'opportunity_note' as const } : {})}
      // The tab's label counts the notes; the page reads that count again.
      onCountChange={props.reload}
      copy={{
        title: t('opportunity.tabs.notes'),
        empty: t('comments.notes.empty'),
        hint: t('comments.notes.hint'),
        composerLabel: t('comments.notes.composer.label'),
        composerPlaceholder: t('comments.notes.composer.placeholder'),
        composerSubmit: t('comments.notes.composer.submit'),
        added: t('comments.notes.added'),
        deleteBody: t('comments.delete.body'),
      }}
    />
  );
}

export default NotesTab;
