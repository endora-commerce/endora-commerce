import type { ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { CommentThread } from '../../../components/CommentThread.js';
import type { OpportunityTabProps } from '../tabs.js';

/**
 * The *Notes* tab (User Story 4): what the people working an Opportunity want
 * remembered. A note is its author's — only they may edit or delete it.
 */
export function NotesTab(props: OpportunityTabProps): ReactNode {
  const t = useTranslation('crm');
  return (
    <CommentThread
      opportunityId={props.opportunity.id}
      kind="note"
      copy={{
        title: t('opportunity.tabs.notes'),
        empty: t('comments.notes.empty'),
        hint: t('comments.notes.hint'),
        composerLabel: t('comments.notes.composer.label'),
        composerPlaceholder: t('comments.notes.composer.placeholder'),
        composerSubmit: t('comments.notes.composer.submit'),
        added: t('comments.notes.added'),
      }}
    />
  );
}

export default NotesTab;
