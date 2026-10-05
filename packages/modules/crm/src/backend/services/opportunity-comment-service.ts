import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type CreateOpportunityCommentRequest,
  type OpportunityComment,
  type OpportunityCommentKind,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { randomUUID } from 'crypto';
import { CrmOpportunityComment } from '../entities/crm-opportunity-comment.entity.js';
import type { CrmNotifier } from './crm-notifier.js';
import { isUuid, loadOpportunity } from './opportunity-access.js';
import { actingAdminUserId } from './opportunity-assignment-service.js';

export interface OpportunityCommentServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** `admin_users`' port — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  notifier: CrmNotifier;
}

/** How much of a message a bell entry quotes. */
const EXCERPT_LENGTH = 200;

function commentNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This note or message does not belong to this opportunity.');
}

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat;
}

/**
 * Notes and internal messages on an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §6; research
 * R-10).
 *
 * One table, two kinds, two behaviours:
 *
 * - **a note is its author's.** Only the author edits or deletes it — holding
 *   `crm:write`, or every permission there is, does not make somebody else's
 *   note theirs. A deleted note is kept, marked, and no longer listed;
 * - **a message is nobody's to change.** Once sent it is neither edited nor
 *   deleted, by anybody; and it tells the Opportunity's assignee and everybody
 *   who has already written in the thread, except its author.
 *
 * **Both are internal.** There is no customer-visible flag, and nothing outside
 * this module's admin routes reads this table.
 *
 * A comment is a child of an Opportunity and carries no tenant column, so
 * every method loads the Opportunity through the scoped EntityManager first
 * and addresses the comment by `(opportunityId, id)`. Every write is a Command
 * recorded against the Opportunity, with the text — the audit trail is where a
 * deleted note's wording survives.
 */
export class OpportunityCommentService {
  constructor(private readonly deps: OpportunityCommentServiceDeps) {}

  /** One kind, oldest first. Deleted notes are not listed. */
  async list(opportunityId: string, kind: OpportunityCommentKind): Promise<OpportunityComment[]> {
    const em = this.deps.emFactory();
    const opportunity = await loadOpportunity(em, opportunityId);
    const rows = await em.find(
      CrmOpportunityComment,
      { opportunityId: opportunity.id, kind, deletedAt: null },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return this.#render(rows);
  }

  async add(opportunityId: string, input: CreateOpportunityCommentRequest): Promise<OpportunityComment> {
    const author = this.#author();
    // The parent first: an Opportunity the caller cannot see is a 404.
    await loadOpportunity(this.deps.emFactory(), opportunityId);

    const written = await this.deps.commandBus.run({
      action: input.kind === 'note' ? 'crm.opportunity.note_add' : 'crm.opportunity.message_add',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, opportunityId);
        // Who is in the conversation is read before this message joins it.
        const recipients =
          input.kind === 'message'
            ? await this.#messageRecipients(em, opportunity.id, opportunity.assignedAdminUserId ?? null, author)
            : [];
        const comment = em.create(CrmOpportunityComment, {
          id: randomUUID(),
          opportunityId: opportunity.id,
          kind: input.kind,
          authorAdminUserId: author,
          body: input.body,
        });
        return {
          result: { comment, recipients, number: opportunity.number, title: opportunity.title },
          before: null,
          after: { commentId: comment.id, kind: comment.kind, body: comment.body },
        };
      },
    });

    // After the commit: the message exists whatever becomes of the bell.
    for (const recipient of written.recipients) {
      await this.deps.notifier.notify({
        kind: 'crm.opportunity.message',
        targetAdminUserId: recipient,
        opportunityId,
        title: `New message on opportunity ${written.number} "${written.title}"`,
        body: excerpt(written.comment.body),
      });
    }
    const [rendered] = await this.#render([written.comment]);
    if (!rendered) throw new Error('crm: a written comment produced no rendering.');
    return rendered;
  }

  /** Edit a note. Its author only; a message is refused whoever asks. */
  async update(opportunityId: string, commentId: string, body: string): Promise<OpportunityComment> {
    const comment = await this.deps.commandBus.run({
      action: 'crm.opportunity.note_update',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const note = await this.#loadOwnNote(em, opportunityId, commentId, 'edited');
        const before = { commentId: note.id, body: note.body };
        if (note.body === body) return { result: note, skipAudit: true };
        note.body = body;
        note.editedAt = new Date();
        return { result: note, before, after: { commentId: note.id, body: note.body } };
      },
    });
    const [rendered] = await this.#render([comment]);
    if (!rendered) throw new Error('crm: an edited note produced no rendering.');
    return rendered;
  }

  /**
   * Delete a note. The row is kept and marked, so what was written stays true
   * in the history; it is no longer listed and cannot be edited.
   */
  async delete(opportunityId: string, commentId: string): Promise<void> {
    await this.deps.commandBus.run({
      action: 'crm.opportunity.note_delete',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const note = await this.#loadOwnNote(em, opportunityId, commentId, 'deleted');
        note.deletedAt = new Date();
        return {
          result: undefined,
          before: { commentId: note.id, body: note.body },
          after: { commentId: note.id, deleted: true },
        };
      },
    });
  }

  /** The administrator writing. The routes are admin-gated, so there always is one. */
  #author(): string {
    const author = actingAdminUserId();
    if (author === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator can write on an opportunity.');
    }
    return author;
  }

  /**
   * The note at `(opportunityId, commentId)`, for its author to change. In this
   * order: the Opportunity as the caller may see it (404), the comment under it
   * (404 — also for one already deleted), a message (409, whoever asks), and
   * only then whose note it is (403).
   */
  async #loadOwnNote(
    em: EntityManager,
    opportunityId: string,
    commentId: string,
    verb: 'edited' | 'deleted',
  ): Promise<CrmOpportunityComment> {
    const opportunity = await loadOpportunity(em, opportunityId);
    if (!isUuid(commentId)) throw commentNotFound();
    const comment = await em.findOne(CrmOpportunityComment, {
      id: commentId,
      opportunityId: opportunity.id,
      deletedAt: null,
    });
    if (!comment) throw commentNotFound();
    if (comment.kind === 'message') {
      throw new HttpError(409, ERROR_CODES.CRM_MESSAGE_IMMUTABLE, `A message cannot be ${verb} once it is sent.`);
    }
    if (comment.authorAdminUserId !== actingAdminUserId()) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, `Only the author of a note can have it ${verb}.`);
    }
    return comment;
  }

  /** The assignee and everybody who already wrote a message here — each once, never the author. */
  async #messageRecipients(
    em: EntityManager,
    opportunityId: string,
    assigneeAdminUserId: string | null,
    author: string,
  ): Promise<string[]> {
    const earlier = await em.find(
      CrmOpportunityComment,
      { opportunityId, kind: 'message' },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    const recipients = new Set<string>();
    if (assigneeAdminUserId) recipients.add(assigneeAdminUserId);
    for (const message of earlier) recipients.add(message.authorAdminUserId);
    recipients.delete(author);
    return [...recipients];
  }

  async #render(rows: readonly CrmOpportunityComment[]): Promise<OpportunityComment[]> {
    if (rows.length === 0) return [];
    const authors = await this.deps.adminUsers.findByIds([...new Set(rows.map((row) => row.authorAdminUserId))]);
    const names = new Map(
      authors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      author: { id: row.authorAdminUserId, name: names.get(row.authorAdminUserId) ?? '' },
      body: row.body,
      // Reference tokens are resolved by the references story; the text is
      // returned as stored until then.
      references: [],
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
