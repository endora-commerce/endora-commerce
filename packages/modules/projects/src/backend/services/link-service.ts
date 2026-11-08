import { ForeignKeyConstraintViolationException, UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PROJECTS_EVENTS,
  type AdminUserReadPort,
  type CreateProjectLinkBody,
  type ProjectLink,
  type ProjectRecordKind,
  type ProjectRecordLinkEvent,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { randomUUID } from 'crypto';
import { ProjectLink as ProjectLinkEntity } from '../entities/project-link.entity.js';
import { RECORD_OWNER, type LinkedRecordOwners, type LinkedRecordView } from './linked-records.js';
import type { OwnerReadCheck, OwnerReadChecks } from './owner-read-permissions.js';
import { isUuid, type ProjectAccess } from './project-access.js';
import { personName } from './project-read-service.js';
import { lockProject } from './project-service.js';

/**
 * The records linked to a Project — Orders, Quote Requests and Opportunities
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.3, research R-10;
 * spec FR-021 – FR-024).
 *
 * **Every read and write starts from `ProjectAccess.loadVisible`**: a Project
 * the caller may not see answers 404 like a missing one, and its links are
 * read by that Project's id only.
 *
 * A link holds the record by value — the column is polymorphic, so there is no
 * foreign key to the record — and **the owner's read port is the integrity
 * check**: the record is read under the caller's reach, so one the caller may
 * not reach does not exist for them, and one of an Organization the Project
 * does not have is refused. The record's Organization is kept on the link and
 * held there by a foreign key into the Project's Organizations, so that
 * Organization cannot be removed while the record is linked.
 *
 * A record belongs to at most one Project. The unique key is the authority;
 * the look-up before the write only names the Project holding it — and only
 * to a caller who may see that Project.
 *
 * Linking a kind asks first whether its owner is present (503 otherwise —
 * `crm` and `quote_requests` can be switched off), then whether the caller
 * holds the owner's read code (403): the answer shows the record's number,
 * status and amount. Rendering a link asks the same two questions and shows a
 * record it cannot answer for — owner off, code not held, record gone — as
 * unavailable, never failing the screen.
 */

export interface LinkServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: ProjectAccess;
  owners: LinkedRecordOwners;
  mayRead: Pick<OwnerReadChecks, 'orders' | 'quoteRequests' | 'opportunities'>;
  /** `admin_users`' read port — who linked a record. Lazy, resolved per call. */
  adminUsers: AdminUserReadPort;
}

interface LinkRow {
  id: string;
  record_kind: ProjectRecordKind;
  record_id: string;
  linked_by_admin_user_id: string | null;
  linked_at: Date | string;
}

const LINK_COLUMNS = `l."id", l."record_kind", l."record_id", l."linked_by_admin_user_id", l."linked_at"`;

function linkNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This record is not linked to this project.');
}

function recordNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.PROJECT_RECORD_NOT_FOUND, 'That record does not exist or is not available to you.');
}

function organizationMismatch(): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.PROJECT_LINK_ORGANIZATION_MISMATCH,
    'The record belongs to an organization this project does not have.',
  );
}

function alreadyLinked(project: { id: string; number: string; title: string } | null): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.PROJECT_RECORD_ALREADY_LINKED,
    'This record already belongs to a project.',
    project ? { project } : undefined,
  );
}

export class LinkService {
  constructor(private readonly deps: LinkServiceDeps) {}

  /** `GET /projects/:id/links` — oldest first, each as the reader may see its record. */
  async list(projectId: string): Promise<ProjectLink[]> {
    const project = await this.deps.access.loadVisible(projectId);
    const rows = (await this.deps.emFactory().execute(
      `select ${LINK_COLUMNS} from "project_links" l where l."project_id" = ? order by l."linked_at", l."id"`,
      [project.id],
    )) as LinkRow[];
    return this.#render(rows);
  }

  /** `POST /projects/:id/links`. */
  async add(projectId: string, body: CreateProjectLinkBody): Promise<ProjectLink> {
    const project = await this.deps.access.loadVisible(projectId);
    const record = await this.#readable(body.kind, body.recordId);
    if (!(await this.#projectHasOrganization(this.deps.emFactory(), project.id, record.organizationId))) {
      throw organizationMismatch();
    }
    const holder = await this.#holder(body.kind, body.recordId);
    if (holder !== null) throw alreadyLinked(await this.#nameIfVisible(holder));

    let linkId: string;
    try {
      linkId = await this.deps.commandBus.run({
        action: 'projects.project.link_add',
        objectType: 'project',
        objectId: project.id,
        run: async ({ em, actor }) => {
          await lockProject(em as EntityManager, this.deps.access, project.id);
          // Again under the lock: the Organization may have been removed since.
          if (!(await this.#projectHasOrganization(em as EntityManager, project.id, record.organizationId))) {
            throw organizationMismatch();
          }
          const link = em.create(ProjectLinkEntity, {
            projectId: project.id,
            recordKind: body.kind,
            recordId: record.id,
            organizationId: record.organizationId,
            linkedByAdminUserId: actor.actorAdminUserId,
          });
          return {
            result: link.id,
            before: null,
            after: { linkId: link.id, recordKind: body.kind, recordId: record.id, organizationId: record.organizationId },
          };
        },
        event: () => {
          const payload: ProjectRecordLinkEvent = {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            projectId: project.id,
            recordKind: body.kind,
            recordId: record.id,
          };
          return { eventName: PROJECTS_EVENTS.RECORD_LINKED, payload };
        },
      });
    } catch (error) {
      // Two requests linking one record at once: both passed the look-up and
      // the unique key refused the second at its insert. The Command reads no
      // other module's port, so nothing else can be mistaken for this.
      if (error instanceof UniqueConstraintViolationException) {
        const winner = await this.#holder(body.kind, body.recordId);
        throw alreadyLinked(winner === null ? null : await this.#nameIfVisible(winner));
      }
      // The Organization went between the check under the lock and the insert
      // — not reachable while both writes lock the Project, kept as the
      // schema's own answer.
      if (error instanceof ForeignKeyConstraintViolationException) throw organizationMismatch();
      throw error;
    }
    const [rendered] = await this.#render(
      (await this.deps.emFactory().execute(`select ${LINK_COLUMNS} from "project_links" l where l."id" = ?`, [
        linkId,
      ])) as LinkRow[],
    );
    if (!rendered) throw linkNotFound();
    return rendered;
  }

  /**
   * `DELETE /projects/:id/links/:linkId` — asks nothing of the record's owner,
   * so a link to a record that is gone, or whose owner is off, is removed as
   * any other (US6 sc.6).
   */
  async remove(projectId: string, linkId: string): Promise<void> {
    const project = await this.deps.access.loadVisible(projectId);
    if (!isUuid(linkId)) throw linkNotFound();
    let removed: { recordKind: ProjectRecordKind; recordId: string } | null = null;
    await this.deps.commandBus.run({
      action: 'projects.project.link_remove',
      objectType: 'project',
      objectId: project.id,
      run: async ({ em }) => {
        await lockProject(em as EntityManager, this.deps.access, project.id);
        const link = await em.findOne(ProjectLinkEntity, { id: linkId, projectId: project.id });
        if (!link) throw linkNotFound();
        removed = { recordKind: link.recordKind, recordId: link.recordId };
        const before = {
          linkId: link.id,
          recordKind: link.recordKind,
          recordId: link.recordId,
          organizationId: link.organizationId,
        };
        em.remove(link);
        return { result: null, before, after: null };
      },
      event: () => {
        const payload: ProjectRecordLinkEvent = {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          projectId: project.id,
          recordKind: removed!.recordKind,
          recordId: removed!.recordId,
        };
        return { eventName: PROJECTS_EVENTS.RECORD_UNLINKED, payload };
      },
    });
  }

  /** The check a kind's owner reads its records with. */
  #mayRead(kind: ProjectRecordKind): OwnerReadCheck {
    if (kind === 'order') return this.deps.mayRead.orders;
    if (kind === 'quote_request') return this.deps.mayRead.quoteRequests;
    return this.deps.mayRead.opportunities;
  }

  /**
   * The record a link request names, as the caller may see it: its owner
   * present (503), the owner's read code held (403), and the record within the
   * caller's reach (404 — missing and out of reach are one answer).
   */
  async #readable(kind: ProjectRecordKind, recordId: string): Promise<LinkedRecordView> {
    if (!this.deps.owners.isPresent(kind)) throw new ModuleDisabledError(RECORD_OWNER[kind]);
    if (!(await this.#mayRead(kind)())) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Linking this record needs the permission to read records of its kind.');
    }
    const record = await this.deps.owners.find(kind, recordId);
    if (!record) throw recordNotFound();
    return record;
  }

  async #projectHasOrganization(em: EntityManager, projectId: string, organizationId: string): Promise<boolean> {
    const rows = (await em.execute(
      `select 1 as "one" from "project_organizations" po where po."project_id" = ? and po."organization_id" = ?`,
      [projectId, organizationId],
    )) as unknown[];
    return rows.length > 0;
  }

  /** The Project a record is linked to, if any — an id, not yet anything the caller may see. */
  async #holder(kind: ProjectRecordKind, recordId: string): Promise<string | null> {
    const rows = (await this.deps.emFactory().execute(
      `select l."project_id" from "project_links" l where l."record_kind" = ? and l."record_id" = ?`,
      [kind, recordId],
    )) as Array<{ project_id: string }>;
    return rows[0]?.project_id ?? null;
  }

  /** The holder's number and title — only when the caller may see it (US6 sc.2, FR-020). */
  async #nameIfVisible(projectId: string): Promise<{ id: string; number: string; title: string } | null> {
    const visible = await this.deps.access.findVisible(projectId);
    return visible ? { id: visible.id, number: visible.number, title: visible.title } : null;
  }

  /**
   * Links as the reader may see their records: per kind, the owner asked only
   * while present and only for a reader holding its read code. Anything else —
   * owner off, code not held, record gone or out of reach — is unavailable,
   * without number, status, amount or address.
   */
  async #render(rows: readonly LinkRow[]): Promise<ProjectLink[]> {
    const views = new Map<string, LinkedRecordView>();
    for (const kind of ['order', 'quote_request', 'opportunity'] as const) {
      const ids = rows.filter((row) => row.record_kind === kind).map((row) => row.record_id);
      if (ids.length === 0 || !this.deps.owners.isPresent(kind) || !(await this.#mayRead(kind)())) continue;
      for (const [id, view] of await this.deps.owners.findMany(kind, ids)) views.set(`${kind}:${id}`, view);
    }
    const linkerIds = [...new Set(rows.map((row) => row.linked_by_admin_user_id).filter((id): id is string => id !== null))];
    const linkers = new Map(
      (linkerIds.length > 0 ? await this.deps.adminUsers.findByIds(linkerIds) : []).map((admin) => [admin.id, admin]),
    );
    return rows.map((row) => {
      const view = views.get(`${row.record_kind}:${row.record_id}`);
      const linker = row.linked_by_admin_user_id ? linkers.get(row.linked_by_admin_user_id) : undefined;
      return {
        id: row.id,
        kind: row.record_kind,
        recordId: row.record_id,
        available: view !== undefined,
        ...(view
          ? {
              number: view.number,
              status: view.status,
              ...(view.amount !== null ? { amount: view.amount } : {}),
              ...(view.currency !== null ? { currency: view.currency } : {}),
              ...(view.partiallyAgreed !== undefined ? { partiallyAgreed: view.partiallyAgreed } : {}),
              href: view.href,
            }
          : {}),
        linkedBy: linker ? { id: linker.id, name: personName(linker) } : null,
        linkedAt: new Date(row.linked_at).toISOString(),
      };
    });
  }
}
