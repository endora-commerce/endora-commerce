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
import type { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityComment } from '../entities/crm-opportunity-comment.entity.js';
import { CrmOpportunityReference } from '../entities/crm-opportunity-reference.entity.js';
import type { AdminReach } from './admin-reach.js';
import { crmNotificationText, tellAfterCommit, type CrmNotifier } from './crm-notifier.js';
import { newlyMentioned, type MentionService, type SavedMentions } from './mention-service.js';
import { isUuid, loadOpportunity } from './opportunity-access.js';
import { actingAdminUserId } from './opportunity-assignment-service.js';
import { storedReferencesOf, type ReferenceService, type ReferenceSource } from './reference-service.js';

export interface OpportunityCommentServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** `admin_users`' port — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
  notifier: CrmNotifier;
  /** The Products and Orders a text mentions: stored on write, resolved on read. */
  references: ReferenceService;
  /** Whether another administrator may reach an Organization. */
  canReach: AdminReach;
  /** Who a text mentions, and telling them (User Story 18). */
  mentions: MentionService;
}

function commentNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This note or message does not belong to this opportunity.');
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
 * **Somebody mentioned in either is told that they were** — once per save, and
 * only if the text it replaces did not mention them already (User Story 18). In
 * a message that entry stands instead of the participant's, not beside it.
 *
 * **Both are internal.** There is no customer-visible flag, and nothing outside
 * this module's admin routes reads this table.
 *
 * A comment is a child of an Opportunity and carries no tenant column, so
 * every method loads the Opportunity through the scoped EntityManager first
 * and addresses the comment by `(opportunityId, id)`. Every write is a Command
 * recorded against the Opportunity — **without the text**: the audit trail is
 * not tenant-scoped, so it says that something was written, by whom and how
 * long it was, and a deleted note's wording survives in its own kept row
 * (research N-R6). The references a text carries are an index of ids, written
 * by the same Command and never part of its audited state.
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
        await this.#saveReferences(
          em,
          { opportunityId: opportunity.id, kind: 'comment', sourceId: comment.id },
          comment.body,
        );
        return {
          result: { comment, recipients, number: opportunity.number, organizationId: opportunity.organizationId },
          before: null,
          // Never the text: the audit trail is not tenant-scoped, and a note
          // or a message is read only under its Opportunity (research N-R6).
          after: {
            commentId: comment.id,
            kind: comment.kind,
            authorAdminUserId: author,
            length: comment.body.length,
          },
        };
      },
    });

    // After the commit: the message exists whatever becomes of the bell. The
    // entry says that there is a message and on which Opportunity, by number —
    // never what it says: a bell is read outside the tenant scope. Somebody who
    // can no longer reach the Organization is not told at all.
    const mentioned = await this.#tellMentioned({
      opportunityId,
      organizationId: written.organizationId,
      number: written.number,
      adminUserIds: newlyMentioned(null, written.comment.body),
    });
    for (const recipient of written.recipients) {
      // Told once: somebody mentioned in the message has their entry already.
      if (mentioned.includes(recipient)) continue;
      await tellAfterCommit(opportunityId, async () => {
        if (!(await this.deps.canReach(recipient, written.organizationId))) return;
        await this.deps.notifier.notify({
          kind: 'crm.opportunity.message',
          targetAdminUserId: recipient,
          opportunityId,
          ...crmNotificationText.message(written.number),
        });
      });
    }
    const [rendered] = await this.#render([written.comment]);
    if (!rendered) throw new Error('crm: a written comment produced no rendering.');
    return rendered;
  }

  /** Edit a note. Its author only; a message is refused whoever asks. */
  async update(opportunityId: string, commentId: string, body: string): Promise<OpportunityComment> {
    const saved: { mentions: SavedMentions | null } = { mentions: null };
    const comment = await this.deps.commandBus.run({
      action: 'crm.opportunity.note_update',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const { note, opportunity } = await this.#loadOwnNote(em, opportunityId, commentId, 'edited');
        const before = { commentId: note.id, length: note.body.length };
        if (note.body === body) return { result: note, skipAudit: true };
        // Who this edit adds, against the text it replaces — worked out here,
        // from the row the Command holds, and told after the commit.
        saved.mentions = {
          opportunityId: opportunity.id,
          organizationId: opportunity.organizationId,
          number: opportunity.number,
          adminUserIds: newlyMentioned(note.body, body),
        };
        note.body = body;
        note.editedAt = new Date();
        await this.#saveReferences(
          em,
          { opportunityId: note.opportunityId, kind: 'comment', sourceId: note.id },
          body,
        );
        return { result: note, before, after: { commentId: note.id, length: note.body.length } };
      },
    });
    if (saved.mentions) await this.#tellMentioned(saved.mentions);
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
        const { note } = await this.#loadOwnNote(em, opportunityId, commentId, 'deleted');
        note.deletedAt = new Date();
        // A deleted note mentions nothing any more.
        await this.#saveReferences(
          em,
          { opportunityId: note.opportunityId, kind: 'comment', sourceId: note.id },
          null,
        );
        return {
          result: undefined,
          before: { commentId: note.id, length: note.body.length },
          after: { commentId: note.id, deleted: true },
        };
      },
    });
  }

  /**
   * Replace the stored references of one source with those its text carries
   * now. **Call it inside the Command that saves the text, with that
   * Command's EntityManager and an Opportunity that was loaded through the
   * scoped one** — the rows carry no tenant column of their own.
   */
  async #saveReferences(em: EntityManager, source: ReferenceSource, text: string | null | undefined): Promise<void> {
    await em.nativeDelete(CrmOpportunityReference, storedReferencesOf(source));
    for (const row of this.deps.references.rowsFor(source, text)) em.create(CrmOpportunityReference, row);
  }

  /**
   * Tell the people a committed save newly mentions, and answer who was
   * addressed. A bell that cannot be written costs the save nothing
   * (`tellAfterCommit`), and then nobody counts as addressed.
   */
  async #tellMentioned(saved: SavedMentions): Promise<string[]> {
    let addressed: string[] = [];
    if (saved.adminUserIds.length === 0) return addressed;
    await tellAfterCommit(saved.opportunityId, async () => {
      addressed = await this.deps.mentions.tell(saved);
    });
    return addressed;
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
  ): Promise<{ note: CrmOpportunityComment; opportunity: CrmOpportunity }> {
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
    return { note: comment, opportunity };
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
    const [authors, references] = await Promise.all([
      this.deps.adminUsers.findByIds([...new Set(rows.map((row) => row.authorAdminUserId))]),
      // One resolution for the whole page: two port calls, however many comments.
      this.deps.references.resolveMany(rows.map((row) => row.body)),
    ]);
    const names = new Map(
      authors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );
    return rows.map((row, index) => ({
      id: row.id,
      kind: row.kind,
      author: { id: row.authorAdminUserId, name: names.get(row.authorAdminUserId) ?? '' },
      // The text as stored, and beside it what its tokens name for this reader.
      body: row.body,
      references: references[index] ?? [],
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
