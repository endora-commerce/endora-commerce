import { useCallback, useRef, type ReactNode } from 'react';
import type { ProjectComment } from '@endora-commerce/contracts';
import { CommentThread } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../../../api.js';
import { useProjectComments, useProjectReferences } from '../../../lib/references.js';
import type { ProjectTabProps } from '../tabs.js';

/**
 * The *Messages* tab (User Story 7, FR-025): the Project's internal thread. A
 * message cannot be changed once sent, and sending one notifies every Member
 * except its author.
 *
 * **Opening the tab reads the messages** — CRM's rule: once the thread is on
 * screen the server is told how far it was read, up to the last message shown,
 * and the tab's unread count is what the server answers. It is told again only
 * when a message of somebody else's appears; one's own are never unread.
 */
export function MessagesTab(props: ProjectTabProps): ReactNode {
  const t = useTranslation('projects');
  const { me } = useAuth();
  const myId = me?.adminUser.id ?? null;
  const projectId = props.project.id;
  // The answer arrives later: it meets the Project then on screen.
  const latest = useRef(props);
  latest.current = props;
  /** The newest message of somebody else's the server was told about. */
  const toldAbout = useRef<string | null>(null);

  const onEntries = useCallback(
    (entries: readonly ProjectComment[]): void => {
      const last = entries[entries.length - 1];
      const newestOfOthers = [...entries].reverse().find((entry) => entry.author.id !== myId);
      if (!last || !newestOfOthers || toldAbout.current === newestOfOthers.id) return;
      toldAbout.current = newestOfOthers.id;
      projectsApi
        .markMessagesRead(projectId, last.id)
        .then(({ unreadMessageCount }) => {
          const { project, onChange } = latest.current;
          if (project.id !== projectId || project.unreadMessageCount === unreadMessageCount) return;
          onChange({ ...project, unreadMessageCount });
        })
        .catch(() => {
          // The messages were shown; only the count is behind. It is said
          // again with the next message, or the next visit.
          toldAbout.current = null;
        });
    },
    [projectId, myId],
  );

  const { kinds, lookups } = useProjectReferences({
    projectId,
    hasOrganizations: props.project.organizations.length > 0,
  });
  const api = useProjectComments(projectId, 'message');

  return (
    <CommentThread
      kind="message"
      api={api}
      canWrite={props.project.permissions.canWrite}
      referenceKinds={kinds}
      lookups={lookups}
      onEntries={onEntries}
      copy={{
        title: t('tabs.messages'),
        empty: t('comments.messages.empty'),
        hint: t('comments.messages.hint'),
        composerLabel: t('comments.messages.composer.label'),
        composerPlaceholder: t('comments.messages.composer.placeholder'),
        composerSubmit: t('comments.messages.composer.submit'),
        composerHint: t('comments.messages.composerHint'),
        added: t('comments.messages.added'),
        // A message cannot be deleted; the question is never asked.
        deleteBody: t('comments.delete.body'),
      }}
    />
  );
}

export default MessagesTab;
