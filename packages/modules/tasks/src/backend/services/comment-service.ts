import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type TaskComment as TaskCommentView,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import { TaskComment } from '../entities/task-comment.entity.js';
import { TaskReference } from '../entities/task-reference.entity.js';
import { TASK_AUDIT_OBJECT_TYPE } from './task-history-service.js';
import { actingAdminUserId, isUuid, type TaskAccess, type TaskRow } from './task-access.js';
import { newlyMentioned, type TaskAudience, type TaskMentionService } from './mention-service.js';
import { tellAfterCommit, type TaskNotifier } from './task-notifier.js';
import { referenceRowsFor, type TaskReferenceService } from './reference-service.js';

export interface TaskCommentServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: Pick<TaskAccess, 'loadVisible' | 'assertMayChange'>;
  /** `admin_users`' port — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  /** Whether somebody else may see the Task — asked of every recipient. */
  audience: TaskAudience;
  notifier: Pick<TaskNotifier, 'commented'>;
  references: Pick<TaskReferenceService, 'resolveMany'>;
  mentions: Pick<TaskMentionService, 'tell'>;
}

function commentNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This comment does not belong to this Task.');
}

/**
 * The comments of a Task (`specs/165-task-management/` User Story 4, FR-025,
 * FR-026, research R-6; `contracts/admin-api.md` §2) — Projects'
 * `comment-service.ts`, the model, with notes only.
 *
 * - **Anybody who may see the Task may comment on it** (`tasks:read` on the
 *   route); a Task they may not see is 404 as one that does not exist, and
 *   someone else's private Task — read by a holder of `tasks:see_private` — is
 *   read only (`TaskAccess.assertMayChange`, 403 `TASK_PRIVATE_READ_ONLY`).
 * - **A comment is its author's.** Only the author edits or deletes it —
 *   holding every permission there is does not make somebody else's comment
 *   theirs (403). A deleted comment keeps its place in the thread, emptied and
 *   marked, and is changed no more.
 * - **Its references** are the comment's own rows of `task_references`
 *   (`source_kind = 'comment'`, `source_id` the comment), replaced inside the
 *   Command that saves the text and removed with it; on read they are resolved
 *   per reader, one call per kind for the whole thread.
 * - **Who is told, after the commit:** somebody a save newly mentions gets the
 *   mention (`mention-service.ts`); a new comment also tells every assignee and
 *   the Creator, except its author and except whoever was just told of the
 *   mention — nobody gets both for one comment (R-6). Every recipient must
 *   still be able to see the Task ({@link TaskAudience}); an edit tells only
 *   the newly mentioned.
 *
 * Every read starts from `TaskAccess.loadVisible` and is keyed by that Task's
 * id. Every write is a Command recorded against the Task — **without the
 * text**: the audit trail is not tenant-scoped, so it says that a comment was
 * written, by whom and how long it was.
 */
export class TaskCommentService {
  constructor(private readonly deps: TaskCommentServiceDeps) {}

  /** The thread, oldest first — a deleted comment in its place, empty. */
  async list(taskId: string): Promise<TaskCommentView[]> {
    const task = await this.deps.access.loadVisible(taskId);
    const rows = await this.deps
      .emFactory()
      .find(TaskComment, { taskId: task.id }, { orderBy: { createdAt: 'asc', id: 'asc' } });
    return this.#render(rows);
  }

  async add(taskId: string, body: string, caller: CallerOptions = {}): Promise<TaskCommentView> {
    const author = this.#author();
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);
    const written = await this.deps.commandBus.run(withCallerOptions({
      action: 'tasks.comment.add',
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task.id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        const comment = tx.create(TaskComment, { taskId: task.id, authorAdminUserId: author, body });
        await this.#saveReferences(tx, task.id, comment.id, body);
        return {
          result: comment,
          before: null,
          // Never the text: the audit trail is not tenant-scoped.
          after: { commentId: comment.id, authorAdminUserId: author, length: body.length },
        };
      },
    }, caller));

    // After the commit: the comment exists whatever becomes of the bell.
    const mentioned = await this.#tellMentioned(task, newlyMentioned(null, written.body));
    for (const recipient of await this.#recipients(task)) {
      // Told once: the mention stands instead of this entry, not beside it.
      if (recipient === author || mentioned.includes(recipient)) continue;
      // One at a time: a bell that cannot be written for one costs the others nothing.
      await tellAfterCommit(task.id, async () => {
        if (!(await this.deps.audience(recipient, task))) return;
        await this.deps.notifier.commented({ targetAdminUserId: recipient, taskId: task.id, number: task.number });
      });
    }
    return this.#renderOne(written);
  }

  /** Edit a comment. Its author only. */
  async update(taskId: string, commentId: string, body: string): Promise<TaskCommentView> {
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);
    const saved: { mentioned: string[] } = { mentioned: [] };
    const comment = await this.deps.commandBus.run({
      action: 'tasks.comment.update',
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task.id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        const row = await this.#loadOwn(tx, task.id, commentId, 'edited');
        if (row.body === body) return { result: row, skipAudit: true };
        const before = { commentId: row.id, length: row.body.length };
        saved.mentioned = newlyMentioned(row.body, body);
        row.body = body;
        row.editedAt = new Date();
        await this.#saveReferences(tx, task.id, row.id, body);
        return { result: row, before, after: { commentId: row.id, length: body.length } };
      },
    });
    await this.#tellMentioned(task, saved.mentioned);
    return this.#renderOne(comment);
  }

  /** Delete a comment: its row stays, emptied and marked, and refers to nothing any more. */
  async delete(taskId: string, commentId: string): Promise<void> {
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);
    await this.deps.commandBus.run({
      action: 'tasks.comment.delete',
      objectType: TASK_AUDIT_OBJECT_TYPE,
      objectId: task.id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        const row = await this.#loadOwn(tx, task.id, commentId, 'deleted');
        const before = { commentId: row.id, length: row.body.length };
        row.body = '';
        row.deletedAt = new Date();
        await this.#saveReferences(tx, task.id, row.id, null);
        return { result: undefined, before, after: { commentId: row.id, deleted: true } };
      },
    });
  }

  /**
   * Replace the stored references of one comment with those its text carries
   * now. **Inside the Command that saves the text, with its EntityManager, for
   * a Task loaded through `TaskAccess`** — the rows are written by that Task's
   * id and that comment's id only.
   */
  async #saveReferences(em: EntityManager, taskId: string, commentId: string, text: string | null): Promise<void> {
    await em.nativeDelete(TaskReference, { taskId, sourceKind: 'comment', sourceId: commentId });
    for (const row of referenceRowsFor({ taskId, kind: 'comment', sourceId: commentId }, text)) {
      em.create(TaskReference, row);
    }
  }

  /** The administrator writing. The routes are admin-gated, so there always is one. */
  #author(): string {
    const author = actingAdminUserId();
    if (author === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator can comment on a Task.');
    }
    return author;
  }

  /**
   * The comment at `(taskId, commentId)`, for its author to change. In this
   * order: the comment under the Task and not deleted (404), and only then
   * whose it is (403).
   */
  async #loadOwn(em: EntityManager, taskId: string, commentId: string, verb: 'edited' | 'deleted'): Promise<TaskComment> {
    if (!isUuid(commentId)) throw commentNotFound();
    const comment = await em.findOne(TaskComment, { id: commentId, taskId, deletedAt: null });
    if (!comment) throw commentNotFound();
    if (comment.authorAdminUserId !== actingAdminUserId()) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, `Only the author of a comment can have it ${verb}.`);
    }
    return comment;
  }

  /** Who a new comment is about to tell: every assignee and the Creator, once each. */
  async #recipients(task: TaskRow): Promise<string[]> {
    const rows = (await this.deps
      .emFactory()
      .execute(`select a."admin_user_id" from "task_assignees" a where a."task_id" = ? order by a."assigned_at", a."admin_user_id"`, [
        task.id,
      ])) as Array<{ admin_user_id: string }>;
    return [...new Set([...rows.map((row) => row.admin_user_id), task.created_by_admin_user_id])];
  }

  /** Tell the people a committed save newly mentions, and answer who was addressed. */
  async #tellMentioned(task: TaskRow, adminUserIds: readonly string[]): Promise<string[]> {
    let addressed: string[] = [];
    if (adminUserIds.length === 0) return addressed;
    await tellAfterCommit(task.id, async () => {
      addressed = await this.deps.mentions.tell(task, adminUserIds);
    });
    return addressed;
  }

  async #renderOne(row: TaskComment): Promise<TaskCommentView> {
    const [rendered] = await this.#render([row]);
    if (!rendered) throw new Error('tasks: a written comment produced no rendering.');
    return rendered;
  }

  async #render(rows: readonly TaskComment[]): Promise<TaskCommentView[]> {
    if (rows.length === 0) return [];
    const [authors, references] = await Promise.all([
      this.deps.adminUsers.findByIds([...new Set(rows.map((row) => row.authorAdminUserId))]),
      // One resolution for the whole thread; a deleted comment refers to nothing.
      this.deps.references.resolveMany(rows.map((row) => (row.deletedAt ? null : row.body))),
    ]);
    const names = new Map(
      authors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );
    return rows.map((row, index) => {
      const name = names.get(row.authorAdminUserId);
      return {
        id: row.id,
        // An author since removed is nobody the reader can be told about.
        author: name === undefined ? null : { id: row.authorAdminUserId, name },
        body: row.deletedAt ? '' : row.body,
        references: references[index] ?? [],
        editedAt: row.editedAt ? row.editedAt.toISOString() : null,
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
