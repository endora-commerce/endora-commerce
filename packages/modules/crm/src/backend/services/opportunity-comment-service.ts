import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  OPPORTUNITY_READ_PORT_NOTES_MAX,
  type AdminUserReadPort,
  type CreateOpportunityCommentRequest,
  type CustomFieldValuePort,
  type OpportunityComment,
  type OpportunityCommentKind,
  type OpportunityNotePage,
  type OpportunityNoteQuery,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { orgConstraintFor, orgScopeSql, reachesNoOrganization } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'util';
import { NOTE_CURSOR_INSTANT_SQL, encodeNoteCursor, noteListBounds } from '../domain/note-page.js';
import type { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityComment } from '../entities/crm-opportunity-comment.entity.js';
import { CrmOpportunityReference } from '../entities/crm-opportunity-reference.entity.js';
import type { AdminReach } from './admin-reach.js';
import { crmNotificationText, tellAfterCommit, type CrmNotifier } from './crm-notifier.js';
import { newlyMentioned, type MentionService, type SavedMentions } from './mention-service.js';
import { withCallerOptions, type CallerOptions } from '../commands/caller-options.js';
import {
  changedCustomFieldKeys,
  mergeOpportunityCustomFields,
  refuseMessageCustomFields,
} from './opportunity-custom-fields.js';
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
  /**
   * `custom_fields`' validator for a note's values (`opportunity_note`, issue
   * #2005) — lazy, resolved per call. It validates and merges; the note's own
   * Command writes.
   */
  customFields: CustomFieldValuePort;
}

/** How many times an edit re-validates a note's values that changed under it. */
const MAX_NOTE_CUSTOM_FIELD_REVALIDATIONS = 3;

/** One row of the notes listing's statement. */
interface NoteRow {
  id: string;
  opportunity_id: string;
  organization_id: string;
  author_admin_user_id: string;
  body: string;
  created_at: Date | string;
  edited_at: Date | string | null;
  custom_field_values: Record<string, unknown> | null;
  /** `created_at` at full precision, as a cursor carries it. */
  cursor_at: string;
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
 * this module's admin routes reads this table — except the notes listing of
 * `opportunityReadPort` ({@link listNotes}, issue #1905), which another module
 * reaches only under its caller's tenant scope and which never lists a message.
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

  /**
   * The notes of many Opportunities, one keyset page at a time, oldest first —
   * `opportunityReadPort.listNotes` (issue #1905). No message, no deleted note.
   *
   * One statement over `crm_opportunity_comments c` joined to its Opportunity,
   * which is the row that carries the tenant column: SQL the entity filter
   * never sees, so the reach is written here from the constraint the ambient
   * context implies (`orgConstraintFor`, which throws without a context), with
   * the platform's predicate for it (`orgScopeSql`) — the rule
   * `analytics-service.ts` and `tag-service.ts` read Opportunities by. A
   * reader who reaches no Organization runs no statement. Checks no
   * permission: the port's caller is the gate.
   */
  async listNotes(query: OpportunityNoteQuery): Promise<OpportunityNotePage> {
    const bounds = noteListBounds(query, OPPORTUNITY_READ_PORT_NOTES_MAX);
    if (bounds === null) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'The notes query carries an invalid instant or a cursor this port did not issue.',
      );
    }
    const empty: OpportunityNotePage = { items: [], nextCursor: null };
    const constraint = orgConstraintFor();
    if (bounds.limit === 0 || reachesNoOrganization(constraint)) return empty;
    // A malformed id names nothing, as everywhere on this port.
    if (query.organizationId !== undefined && !isUuid(query.organizationId)) return empty;
    if (query.authorAdminUserId !== undefined && !isUuid(query.authorAdminUserId)) return empty;

    const where = [`c."kind" = 'note'`, `c."deleted_at" is null`];
    const params: unknown[] = [];
    const reach = orgScopeSql('o."organization_id"', constraint);
    where.push(reach.sql);
    params.push(...reach.params);
    if (query.organizationId !== undefined) {
      where.push(`o."organization_id" = ?`);
      params.push(query.organizationId);
    }
    if (query.authorAdminUserId !== undefined) {
      where.push(`c."author_admin_user_id" = ?`);
      params.push(query.authorAdminUserId);
    }
    if (bounds.createdFrom !== null) {
      where.push(`c."created_at" >= ?`);
      params.push(bounds.createdFrom);
    }
    if (bounds.createdBefore !== null) {
      where.push(`c."created_at" < ?`);
      params.push(bounds.createdBefore);
    }
    if (bounds.after !== null) {
      where.push(`(c."created_at", c."id") > (?::timestamptz, ?::uuid)`);
      params.push(bounds.after.createdAt, bounds.after.id);
    }
    // One row past the page says whether there is a next one.
    params.push(bounds.limit + 1);
    const rows = await this.deps
      .emFactory()
      .getConnection()
      .execute<NoteRow[]>(
        `select c."id", c."opportunity_id", o."organization_id", c."author_admin_user_id", c."body",
                c."created_at", c."edited_at", c."custom_field_values", ${NOTE_CURSOR_INSTANT_SQL} as "cursor_at"
           from "crm_opportunity_comments" c
           join "crm_opportunities" o on o."id" = c."opportunity_id"
          where ${where.join(' and ')}
          order by c."created_at", c."id"
          limit ?`,
        params,
        'all',
      );
    const page = rows.slice(0, bounds.limit);
    const last = page.at(-1);
    const names = await this.#authorNames(page.map((row) => row.author_admin_user_id));
    return {
      items: page.map((row) => ({
        id: row.id,
        opportunityId: row.opportunity_id,
        organizationId: row.organization_id,
        author: { id: row.author_admin_user_id, name: names.get(row.author_admin_user_id) ?? '' },
        body: row.body,
        createdAt: new Date(row.created_at),
        editedAt: row.edited_at === null ? null : new Date(row.edited_at),
        customFieldValues: { ...(row.custom_field_values ?? {}) },
      })),
      nextCursor:
        rows.length > bounds.limit && last !== undefined
          ? encodeNoteCursor({ createdAt: last.cursor_at, id: last.id })
          : null,
    };
  }

  /**
   * The notes `list` would answer, counted: no message and no deleted note.
   * For the detail read, which has loaded the Opportunity through the scoped
   * EntityManager already.
   */
  async noteCount(opportunityId: string): Promise<number> {
    return this.deps.emFactory().count(CrmOpportunityComment, { opportunityId, kind: 'note', deletedAt: null });
  }

  /**
   * The messages of an Opportunity the administrator asking has not read:
   * the ones `list` answers (no row marked deleted), written by somebody else,
   * after the point they have read up to — the later of their marker and the
   * instant unread messages started being counted on this installation
   * (`CrmMessageReadBaseline`). A marker older than that instant therefore
   * un-reads nothing, and reading only ever lowers the number (#222);
   * `greatest` skips a null, so having no marker counts from the baseline. A
   * message one wrote oneself is never unread. `0` for a caller that is no
   * administrator.
   *
   * Accepted limitation (#222): `created_at` is stamped before commit, so a
   * message that commits after a later-stamped one was already read through
   * is never counted unread for that reader. Closing it would need a
   * commit-ordered sequence or per-message read rows.
   *
   * For the detail read, which has loaded the Opportunity through the scoped
   * EntityManager already. One statement, compared in the database: a marker
   * read into a `Date` would lose the microseconds a stored instant may carry,
   * and the message it was taken from would count as unread for ever.
   */
  async unreadMessageCount(opportunityId: string): Promise<number> {
    const reader = actingAdminUserId();
    if (reader === null) return 0;
    const rows = await this.deps
      .emFactory()
      .getConnection()
      .execute<Array<{ n: number }>>(
        `select count(*)::int as n
           from "crm_opportunity_comments" c
          where c."opportunity_id" = ?
            and c."kind" = 'message'
            and c."deleted_at" is null
            and c."author_admin_user_id" <> ?
            and c."created_at" > greatest(
                  (select r."last_read_at" from "crm_opportunity_message_reads" r
                    where r."opportunity_id" = ? and r."admin_user_id" = ?),
                  (select b."unread_since" from "crm_message_read_baselines" b where b."id" = 1),
                  '-infinity'::timestamptz)`,
        [opportunityId, reader, opportunityId, reader],
        'all',
      );
    return rows[0]?.n ?? 0;
  }

  /**
   * The administrator asking has read the conversation up to and including one
   * of its messages — what opening the *Messages* tab says. Answers what is
   * left unread for them, which is 0 unless something arrived meanwhile.
   *
   * The marker is theirs alone and only ever moves forward: an older tab
   * answering late cannot make read messages unread again.
   *
   * **No Command, on purpose.** The marker is one person's place in a
   * conversation, not a change to the Opportunity: nothing is undone by it, and
   * a Command recorded against the Opportunity would put "somebody opened a
   * tab" into its change history. It is the bookkeeping `admin_notifications`
   * does for a bell entry's `read_at`, written the same way. Reading asks for
   * `crm:read` and nothing more, for the same reason.
   */
  async markMessagesRead(opportunityId: string, throughMessageId: string): Promise<{ unreadMessageCount: number }> {
    const reader = actingAdminUserId();
    if (reader === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator reads the messages of an opportunity.');
    }
    const em = this.deps.emFactory();
    // The parent first: an Opportunity the caller cannot see is a 404, and
    // nothing is written about it.
    const opportunity = await loadOpportunity(em, opportunityId);
    if (!isUuid(throughMessageId)) throw commentNotFound();
    // command-coverage-ignore: a per-administrator read marker — view state of
    // the person reading, not an audited change to the Opportunity. The same
    // escape `admin_notifications` takes for a bell entry's read state.
    const marked = await em.getConnection().execute<Array<{ opportunity_id: string }>>(
      `insert into "crm_opportunity_message_reads" ("opportunity_id", "admin_user_id", "last_read_at")
       select c."opportunity_id", ?, c."created_at"
         from "crm_opportunity_comments" c
        where c."id" = ? and c."opportunity_id" = ? and c."kind" = 'message'
       on conflict ("opportunity_id", "admin_user_id") do update
          set "last_read_at" = greatest("crm_opportunity_message_reads"."last_read_at", excluded."last_read_at")
       returning "opportunity_id"`,
      [reader, throughMessageId, opportunity.id],
      'all',
    );
    // Not a message of this Opportunity: a note, another Opportunity's, or nothing.
    if (marked.length === 0) throw commentNotFound();
    return { unreadMessageCount: await this.unreadMessageCount(opportunity.id) };
  }

  /**
   * `crm.opportunity.note_add` / `.message_add` — `POST …/comments` and
   * `opportunityCommandPort.addComment`; `caller` is the port's `source` and
   * `extensions`, absent on the route. The author is the ambient
   * administrator, so with none it is refused 403 (research R-21.3).
   *
   * A note's custom-field values (`opportunity_note`, issue #2005) are
   * validated here, before the Command — which reads no other module's port
   * (research N-S1) — with the administrator's rules: a `required` definition
   * is asked for on every note, also when none are sent. They are written by
   * the Command that creates the note, and its audit entry names their keys,
   * never the values. A message is no host: a non-empty bag is refused 422.
   */
  async add(
    opportunityId: string,
    input: CreateOpportunityCommentRequest,
    caller: CallerOptions = {},
  ): Promise<OpportunityComment> {
    const author = this.#author();
    if (input.kind === 'message') refuseMessageCustomFields(input.customFieldValues);
    // The parent first: an Opportunity the caller cannot see is a 404.
    await loadOpportunity(this.deps.emFactory(), opportunityId);
    const customFieldValues =
      input.kind === 'note'
        ? await mergeOpportunityCustomFields(this.deps.customFields, {}, input.customFieldValues ?? {}, 'opportunity_note')
        : {};
    const changedCustomFields = changedCustomFieldKeys({}, customFieldValues);

    const written = await this.deps.commandBus.run(withCallerOptions({
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
          customFieldValues,
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
            // The keys a note was given values for — never the values (audit-state.md).
            ...(changedCustomFields.length > 0 ? { changedCustomFields } : {}),
          },
        };
      },
    }, caller));

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

  /**
   * Edit a note — its text and, merged key by key into what it holds, its
   * custom-field values (issue #2005; absent leaves them as they are). Its
   * author only; a message is refused whoever asks.
   *
   * The values are validated before the Command, against the bag read here;
   * the Command writes the result only if the note still holds that bag once
   * it is loaded again, and otherwise this is done again — the rule an
   * Opportunity's own edit follows (research N-S1).
   */
  async update(
    opportunityId: string,
    commentId: string,
    body: string,
    customFieldPatch?: Record<string, unknown>,
  ): Promise<OpportunityComment> {
    const saved: { mentions: SavedMentions | null } = { mentions: null };
    let validatedAgainst: Record<string, unknown> = {};
    let customFieldValues: Record<string, unknown> | null = null;
    if (customFieldPatch !== undefined) {
      // The note as its author may change it — the refusals in their order — before any value is looked at.
      const { note } = await this.#loadOwnNote(this.deps.emFactory(), opportunityId, commentId, 'edited');
      validatedAgainst = { ...(note.customFieldValues ?? {}) };
      customFieldValues = await mergeOpportunityCustomFields(
        this.deps.customFields,
        validatedAgainst,
        customFieldPatch,
        'opportunity_note',
      );
    }
    for (let attempt = 0; ; attempt += 1) {
      const stale: { current: Record<string, unknown> | null } = { current: null };
      const comment = await this.deps.commandBus.run({
        action: 'crm.opportunity.note_update',
        objectType: 'crm_opportunity',
        objectId: opportunityId,
        run: async ({ em }) => {
          const { note, opportunity } = await this.#loadOwnNote(em, opportunityId, commentId, 'edited', true);
          const valuesBefore = { ...(note.customFieldValues ?? {}) };
          if (customFieldValues !== null && !isDeepStrictEqual(valuesBefore, validatedAgainst)) {
            stale.current = valuesBefore;
            return { result: note, skipAudit: true };
          }
          const valuesAfter = customFieldValues ?? valuesBefore;
          const changedCustomFields = changedCustomFieldKeys(valuesBefore, valuesAfter);
          if (note.body === body && changedCustomFields.length === 0) return { result: note, skipAudit: true };
          const before = { commentId: note.id, length: note.body.length };
          if (note.body !== body) {
            // Who this edit adds, against the text it replaces — worked out here,
            // from the row the Command holds, and told after the commit.
            saved.mentions = {
              opportunityId: opportunity.id,
              organizationId: opportunity.organizationId,
              number: opportunity.number,
              adminUserIds: newlyMentioned(note.body, body),
            };
            note.body = body;
            await this.#saveReferences(
              em,
              { opportunityId: note.opportunityId, kind: 'comment', sourceId: note.id },
              body,
            );
          }
          if (changedCustomFields.length > 0) note.customFieldValues = valuesAfter;
          note.editedAt = new Date();
          return {
            result: note,
            before,
            after: {
              commentId: note.id,
              length: note.body.length,
              // The keys whose value changed — never the values (audit-state.md).
              ...(changedCustomFields.length > 0 ? { changedCustomFields } : {}),
            },
          };
        },
      });
      if (stale.current === null) {
        if (saved.mentions) await this.#tellMentioned(saved.mentions);
        const [rendered] = await this.#render([comment]);
        if (!rendered) throw new Error('crm: an edited note produced no rendering.');
        return rendered;
      }
      if (attempt + 1 >= MAX_NOTE_CUSTOM_FIELD_REVALIDATIONS) {
        throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The note was updated concurrently.');
      }
      validatedAgainst = stale.current;
      customFieldValues = await mergeOpportunityCustomFields(
        this.deps.customFields,
        validatedAgainst,
        customFieldPatch,
        'opportunity_note',
      );
    }
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
    lock = false,
  ): Promise<{ note: CrmOpportunityComment; opportunity: CrmOpportunity }> {
    const opportunity = await loadOpportunity(em, opportunityId);
    if (!isUuid(commentId)) throw commentNotFound();
    // Inside the Command the note row is locked, so the re-check of its stored values against the
    // ones validated before the run cannot race a concurrent edit (as the Opportunity edit locks).
    const comment = await em.findOne(
      CrmOpportunityComment,
      { id: commentId, opportunityId: opportunity.id, deletedAt: null },
      lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {},
    );
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

  /** Each author's name as the thread shows it, by administrator id — one port call. */
  async #authorNames(adminUserIds: readonly string[]): Promise<Map<string, string>> {
    if (adminUserIds.length === 0) return new Map();
    const authors = await this.deps.adminUsers.findByIds([...new Set(adminUserIds)]);
    return new Map(authors.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]));
  }

  async #render(rows: readonly CrmOpportunityComment[]): Promise<OpportunityComment[]> {
    if (rows.length === 0) return [];
    const [names, references] = await Promise.all([
      this.#authorNames(rows.map((row) => row.authorAdminUserId)),
      // One resolution for the whole page: two port calls, however many comments.
      this.deps.references.resolveMany(rows.map((row) => row.body)),
    ]);
    return rows.map((row, index) => ({
      id: row.id,
      kind: row.kind,
      author: { id: row.authorAdminUserId, name: names.get(row.authorAdminUserId) ?? '' },
      // The text as stored, and beside it what its tokens name for this reader.
      body: row.body,
      references: references[index] ?? [],
      editedAt: row.editedAt ? row.editedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      customFieldValues: { ...(row.customFieldValues ?? {}) },
    }));
  }
}
