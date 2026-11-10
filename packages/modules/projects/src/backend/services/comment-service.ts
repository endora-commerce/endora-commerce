import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type CreateProjectCommentBody,
  type ProjectComment as ProjectCommentView,
  type ProjectCommentKind,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ProjectComment } from '../entities/project-comment.entity.js';
import { ProjectReference } from '../entities/project-reference.entity.js';
import { newlyMentioned, type ProjectMentionService, type SavedProjectMentions } from './mention-service.js';
import { actingAdminUserId, isUuid, type ProjectAccess } from './project-access.js';
import { lockProject } from './project-service.js';
import { projectNotificationText, tellAfterCommit, type ProjectNotifier } from './project-notifier.js';
import { storedReferencesOf, type ProjectReferenceService, type ProjectReferenceSource } from './reference-service.js';

export interface ProjectCommentServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: Pick<ProjectAccess, 'loadVisible' | 'canSeeAs' | 'assertVisibleUnderLock'>;
  /** `admin_users`' port — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  notifier: ProjectNotifier;
  references: Pick<ProjectReferenceService, 'rowsFor' | 'resolveMany'>;
  mentions: Pick<ProjectMentionService, 'tell'>;
}

function commentNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This note or message does not belong to this project.');
}

/**
 * Notes and the internal message thread of a Project
 * (`specs/163-projects-and-tasks/spec.md` FR-025, FR-026; research R-13;
 * `contracts/admin-api.md` §2.4) — CRM's `opportunity-comment-service.ts`, the
 * model, with one rule of Projects' own: a message tells **every Member**
 * except its author.
 *
 * - **A note is its author's.** Only the author edits or deletes it — holding
 *   `projects:write`, or every permission there is, does not make somebody
 *   else's note theirs (403 `PROJECT_NOTE_NOT_AUTHOR`). A deleted note is kept,
 *   marked, and no longer listed.
 * - **A message is nobody's to change** (409 `PROJECT_MESSAGE_IMMUTABLE`).
 * - **Somebody newly mentioned** in either is told once
 *   (`mention-service.ts`); in a message that entry stands instead of the
 *   Member's, not beside it.
 * - **Nobody is told who may not see the Project** — every recipient passes
 *   `ProjectAccess.canSeeAs`.
 *
 * Every read and write starts from `ProjectAccess.loadVisible`; comments,
 * Members and read markers are then read by that Project's id only. Every write
 * locks the Project in its Command and asks again there whether the caller may
 * still see it (`lockProject`, T144 F3; issue #471), so a visibility change
 * between the check and the write is refused as if the Project did not exist.
 * The read marker is not a write on the Project and takes no lock. Every write
 * is a Command recorded against `project` — **without the text**: the audit
 * trail is not tenant-scoped, so it says that something was written, by whom
 * and how long it was. Both kinds are internal: no storefront route reads them.
 */
export class ProjectCommentService {
  constructor(private readonly deps: ProjectCommentServiceDeps) {}

  /** One kind, oldest first. Deleted notes are not listed. */
  async list(projectId: string, kind: ProjectCommentKind): Promise<ProjectCommentView[]> {
    const project = await this.deps.access.loadVisible(projectId);
    const rows = await this.deps
      .emFactory()
      .find(
        ProjectComment,
        { projectId: project.id, kind, deletedAt: null },
        { orderBy: { createdAt: 'asc', id: 'asc' } },
      );
    return this.#render(rows);
  }

  /**
   * The caller has read the thread up to and including one of its messages.
   * Answers what is left unread for them. The marker is theirs alone and only
   * moves forward.
   */
  async markMessagesRead(projectId: string, throughMessageId: string): Promise<{ unreadMessageCount: number }> {
    const reader = actingAdminUserId();
    if (reader === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator reads the messages of a project.');
    }
    const project = await this.deps.access.loadVisible(projectId);
    if (!isUuid(throughMessageId)) throw commentNotFound();
    const em = this.deps.emFactory();
    // command-coverage-ignore: a per-administrator read marker — view state of
    // the person reading, not an audited change to the Project (CRM's rule,
    // and `admin_notifications`' for a bell entry's read state).
    const marked = (await em.execute(
      `insert into "project_message_reads" ("project_id", "admin_user_id", "last_read_at")
       select c."project_id", ?, c."created_at"
         from "project_comments" c
        where c."id" = ? and c."project_id" = ? and c."kind" = 'message'
       on conflict ("project_id", "admin_user_id") do update
          set "last_read_at" = greatest("project_message_reads"."last_read_at", excluded."last_read_at")
       returning "project_id"`,
      [reader, throughMessageId, project.id],
    )) as Array<{ project_id: string }>;
    if (marked.length === 0) throw commentNotFound();
    return { unreadMessageCount: await this.#unreadCount(project.id, reader) };
  }

  async add(projectId: string, input: CreateProjectCommentBody): Promise<ProjectCommentView> {
    const author = this.#author();
    const project = await this.deps.access.loadVisible(projectId);
    const written = await this.deps.commandBus.run({
      action: input.kind === 'note' ? 'projects.project.note_add' : 'projects.project.message_add',
      objectType: 'project',
      objectId: project.id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        await lockProject(tx, this.deps.access, project.id);
        const comment = tx.create(ProjectComment, {
          projectId: project.id,
          kind: input.kind,
          authorAdminUserId: author,
          body: input.body,
        });
        await this.#saveReferences(tx, { projectId: project.id, kind: 'comment', sourceId: comment.id }, comment.body);
        return {
          result: comment,
          before: null,
          // Never the text: the audit trail is not tenant-scoped.
          after: {
            commentId: comment.id,
            kind: comment.kind,
            authorAdminUserId: author,
            length: comment.body.length,
          },
        };
      },
    });

    // After the commit: the comment exists whatever becomes of the bell.
    const mentioned = await this.#tellMentioned({
      projectId: project.id,
      number: project.number,
      adminUserIds: newlyMentioned(null, written.body),
    });
    if (written.kind === 'message') {
      for (const recipient of await this.#members(project.id)) {
        // Told once: a mentioned Member has their entry already.
        if (recipient === author || mentioned.includes(recipient)) continue;
        // One at a time, as CRM does: a bell that cannot be written for one
        // Member costs the others nothing.
        await tellAfterCommit(project.id, async () => {
          if (!(await this.deps.access.canSeeAs(recipient, project.id))) return;
          await this.deps.notifier.notify({
            kind: 'projects.project.message',
            targetAdminUserId: recipient,
            projectId: project.id,
            ...projectNotificationText.message(project.number),
          });
        });
      }
    }
    return this.#renderOne(written);
  }

  /** Edit a note. Its author only; a message is refused whoever asks. */
  async update(projectId: string, commentId: string, body: string): Promise<ProjectCommentView> {
    const project = await this.deps.access.loadVisible(projectId);
    const saved: { mentions: SavedProjectMentions | null } = { mentions: null };
    const note = await this.deps.commandBus.run({
      action: 'projects.project.note_update',
      objectType: 'project',
      objectId: project.id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        await lockProject(tx, this.deps.access, project.id);
        const row = await this.#loadOwnNote(tx, project.id, commentId, 'edited');
        if (row.body === body) return { result: row, skipAudit: true };
        const before = { commentId: row.id, length: row.body.length };
        saved.mentions = {
          projectId: project.id,
          number: project.number,
          adminUserIds: newlyMentioned(row.body, body),
        };
        row.body = body;
        row.editedAt = new Date();
        await this.#saveReferences(tx, { projectId: project.id, kind: 'comment', sourceId: row.id }, body);
        return { result: row, before, after: { commentId: row.id, length: row.body.length } };
      },
    });
    if (saved.mentions) await this.#tellMentioned(saved.mentions);
    return this.#renderOne(note);
  }

  /** Delete a note: the row is kept and marked, no longer listed, and mentions nothing any more. */
  async delete(projectId: string, commentId: string): Promise<void> {
    const project = await this.deps.access.loadVisible(projectId);
    await this.deps.commandBus.run({
      action: 'projects.project.note_delete',
      objectType: 'project',
      objectId: project.id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        await lockProject(tx, this.deps.access, project.id);
        const row = await this.#loadOwnNote(tx, project.id, commentId, 'deleted');
        row.deletedAt = new Date();
        await this.#saveReferences(tx, { projectId: project.id, kind: 'comment', sourceId: row.id }, null);
        return {
          result: undefined,
          before: { commentId: row.id, length: row.body.length },
          after: { commentId: row.id, deleted: true },
        };
      },
    });
  }

  /**
   * Replace the stored references of one source with those its text carries
   * now. **Call it inside the Command that saves the text, with that Command's
   * EntityManager, for a Project loaded through `ProjectAccess`** — the rows are
   * written by that Project's id only.
   */
  async #saveReferences(
    em: EntityManager,
    source: ProjectReferenceSource,
    text: string | null | undefined,
  ): Promise<void> {
    await em.nativeDelete(ProjectReference, storedReferencesOf(source));
    for (const row of this.deps.references.rowsFor(source, text)) em.create(ProjectReference, row);
  }

  /** The administrator writing. The routes are admin-gated, so there always is one. */
  #author(): string {
    const author = actingAdminUserId();
    if (author === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator can write on a project.');
    }
    return author;
  }

  /**
   * The note at `(projectId, commentId)`, for its author to change. In this
   * order: the comment under the Project (404 — also one already deleted), a
   * message (409, whoever asks), and only then whose note it is (403).
   */
  async #loadOwnNote(
    em: EntityManager,
    projectId: string,
    commentId: string,
    verb: 'edited' | 'deleted',
  ): Promise<ProjectComment> {
    if (!isUuid(commentId)) throw commentNotFound();
    const comment = await em.findOne(ProjectComment, { id: commentId, projectId, deletedAt: null });
    if (!comment) throw commentNotFound();
    if (comment.kind === 'message') {
      throw new HttpError(409, ERROR_CODES.PROJECT_MESSAGE_IMMUTABLE, `A message cannot be ${verb} once it is sent.`);
    }
    if (comment.authorAdminUserId !== actingAdminUserId()) {
      throw new HttpError(403, ERROR_CODES.PROJECT_NOTE_NOT_AUTHOR, `Only the author of a note can have it ${verb}.`);
    }
    return comment;
  }

  /** The Members of a Project, by administrator id. */
  async #members(projectId: string): Promise<string[]> {
    const rows = (await this.deps
      .emFactory()
      .execute(
        `select m."admin_user_id" from "project_members" m where m."project_id" = ? order by m."added_at", m."id"`,
        [projectId],
      )) as Array<{ admin_user_id: string }>;
    return rows.map((row) => row.admin_user_id);
  }

  /** Messages somebody else wrote since the reader's marker, or since the module's read baseline. */
  async #unreadCount(projectId: string, reader: string): Promise<number> {
    const rows = (await this.deps.emFactory().execute(
      `select count(*)::int as "n" from "project_comments" c
        where c."project_id" = ? and c."kind" = 'message' and c."author_admin_user_id" <> ?
          and c."created_at" > coalesce(
            (select r."last_read_at" from "project_message_reads" r where r."project_id" = ? and r."admin_user_id" = ?),
            (select b."unread_since" from "project_message_read_baselines" b where b."id" = 1),
            '-infinity'::timestamptz)`,
      [projectId, reader, projectId, reader],
    )) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  /** Tell the people a committed save newly mentions, and answer who was addressed. */
  async #tellMentioned(saved: SavedProjectMentions): Promise<string[]> {
    let addressed: string[] = [];
    if (saved.adminUserIds.length === 0) return addressed;
    await tellAfterCommit(saved.projectId, async () => {
      addressed = await this.deps.mentions.tell(saved);
    });
    return addressed;
  }

  async #renderOne(row: ProjectComment): Promise<ProjectCommentView> {
    const [rendered] = await this.#render([row]);
    if (!rendered) throw new Error('projects: a written comment produced no rendering.');
    return rendered;
  }

  async #render(rows: readonly ProjectComment[]): Promise<ProjectCommentView[]> {
    if (rows.length === 0) return [];
    const [authors, references] = await Promise.all([
      this.deps.adminUsers.findByIds([...new Set(rows.map((row) => row.authorAdminUserId))]),
      // One resolution for the whole page: one port call per kind, however many comments.
      this.deps.references.resolveMany(rows.map((row) => row.body)),
    ]);
    const names = new Map(
      authors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );
    return rows.map((row, index) => ({
      id: row.id,
      kind: row.kind,
      author: { id: row.authorAdminUserId, name: names.get(row.authorAdminUserId) ?? '' },
      body: row.body,
      references: references[index] ?? [],
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
