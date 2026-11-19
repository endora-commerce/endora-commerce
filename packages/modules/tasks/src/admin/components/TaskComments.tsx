import { useId, useMemo, type ReactNode } from 'react';
import type { TaskComment } from '@endora-commerce/contracts';
import { CommentThread, type CommentThreadApi, type RecordComment } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { momentLabel } from '../lib/labels.js';
import { useTaskReferences } from '../lib/references.js';

/** A Task's comment as the kit's thread reads one: a note, its author named even once removed. */
function asRecordComment(comment: TaskComment, formerAuthor: string): RecordComment {
  return {
    id: comment.id,
    kind: 'note',
    author: comment.author ?? { id: '', name: formerAuthor },
    body: comment.body,
    references: comment.references,
    editedAt: comment.editedAt,
    deletedAt: comment.deletedAt,
    createdAt: comment.createdAt,
  };
}

/**
 * A Task's comments (`specs/165-task-management/` User Story 4, FR-025,
 * research R-6; `contracts/admin-surfaces.md` §2): the kit's `CommentThread`,
 * notes only, with the reference triggers of the description.
 *
 * **Whoever may see the Task may comment** — `tasks:read` is enough — except
 * on someone else's private Task, which is read only (`canComment`). A comment
 * is its author's: the thread offers *Edit* and *Delete* on the reader's own
 * only, and the server says so too. A deleted comment keeps its place, marked.
 */
export function TaskComments(props: {
  taskId: string;
  canComment: boolean;
  /** A comment was added or deleted — the history has an entry more. */
  onChange?: () => void;
}): ReactNode {
  const { taskId, canComment, onChange } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const headingId = useId();
  const { kinds, lookups } = useTaskReferences(taskId);
  const formerAuthor = tCore('history.actor.deleted');

  // Stable between renders: the thread reads again when its adapter changes.
  const api = useMemo(
    (): CommentThreadApi => ({
      list: async () => (await tasksApi.listComments(taskId)).map((comment) => asRecordComment(comment, formerAuthor)),
      add: async (body) => asRecordComment(await tasksApi.addComment(taskId, body), formerAuthor),
      update: async (commentId, body) => asRecordComment(await tasksApi.updateComment(taskId, commentId, body), formerAuthor),
      remove: (commentId) => tasksApi.removeComment(taskId, commentId),
    }),
    [taskId, formerAuthor],
  );

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-base font-semibold">
        {t('detail.comments')}
      </h2>
      <CommentThread
        kind="note"
        keepDeleted
        formatTime={(iso): string => momentLabel(iso, language)}
        api={api}
        canWrite={canComment}
        referenceKinds={kinds}
        lookups={lookups}
        {...(onChange ? { onCountChange: onChange } : {})}
        copy={{
          title: t('detail.comments'),
          empty: t('comments.empty'),
          // Who reads the thread is the one rule the screen does not show (UX audit WORK-11).
          hint: t('comments.hintReadOnly'),
          composerLabel: t('comments.composer.label'),
          composerPlaceholder: t('comments.composer.placeholder'),
          composerSubmit: t('comments.composer.submit'),
          added: t('comments.added'),
          deleteBody: t('comments.delete.body'),
        }}
      />
    </section>
  );
}
