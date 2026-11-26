import { z, type ZodType } from 'zod';
import {
  CloseProjectBodySchema,
  CreateProjectBodySchema,
  CreateProjectCommentBodySchema,
  CreateProjectLinkBodySchema,
  ERROR_CODES,
  MoveProjectBodySchema,
  SetProjectMembersBodySchema,
  SetProjectOrganizationsBodySchema,
  UpdateProjectBodySchema,
  type AggregateCommandOptions,
  type CreateProjectBody,
  type CreateProjectCommentBody,
  type CreateProjectLinkBody,
  type CustomFieldMerge,
  type ProjectCloseInput,
  type ProjectCommandPort,
  type ProjectMemberInput,
  type ProjectRecord,
  type ProjectUpdatePatch,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assertCallerSource, type CallerOptions } from '../commands/caller-options.js';
import type { ProjectCommentService } from './comment-service.js';
import type { LinkService } from './link-service.js';
import type { MoveService } from './move-service.js';
import type { ProjectAccess } from './project-access.js';
import { projectRecordOf } from './project-read-port.js';
import type { ProjectReadService } from './project-read-service.js';
import type { ProjectService } from './project-service.js';

/**
 * `projectCommandPort` (`specs/186-aggregate-ports/` US7, issue #1828) — the
 * Project aggregate's write port. The contract, the refusals and the options
 * are `ProjectCommandPort` in `@endora-commerce/contracts`.
 *
 * **It checks no permission.** The caller is the gate. Each method validates
 * `source` before it reads anything (issue #1922), parses its input with the
 * admin route's schema (a refusal is `422 VALIDATION_FAILED`), and runs the
 * service method the route runs — the one that builds the Command and does
 * what the route does before it (the workflow, the gate, the stage guards) and
 * after its commit (Stage Tasks, mentions, a message's Members told, a deleted
 * Project's Tasks), so both paths reach the same effects without either moving
 * (research R-22.1). The caller's `source` and `extensions` are added to those
 * Commands by `withCallerOptions`, inside the services, never by a second
 * Command.
 *
 * The answer is the published record, read after the write under the
 * Organization rule alone (`ProjectAccess.rowAfterWrite`), so a write that took
 * the Project out of the caller's own visibility still answers it (R-22.6).
 */

export interface ProjectCommandServiceDeps {
  readonly projects: Pick<
    ProjectService,
    'createProject' | 'updateProject' | 'setCustomFieldValues' | 'applyOrganizations' | 'applyMembers' | 'delete'
  >;
  readonly moves: Pick<MoveService, 'moveProject' | 'closeProject' | 'reopenProject'>;
  readonly links: Pick<LinkService, 'link' | 'remove'>;
  readonly comments: Pick<ProjectCommentService, 'write'>;
  readonly access: Pick<ProjectAccess, 'rowAfterWrite' | 'inReachAfterWrite'>;
  readonly read: Pick<ProjectReadService, 'summary'>;
}

/** The admin bodies without their version, which travels as `options.expectedVersion`. */
const updatePatchSchema = UpdateProjectBodySchema.pick({ title: true, description: true, value: true, startOn: true });
const organizationsInputSchema = SetProjectOrganizationsBodySchema.pick({ organizationIds: true });
const membersInputSchema = SetProjectMembersBodySchema.pick({ members: true });
const moveInputSchema = MoveProjectBodySchema.pick({ toStageId: true });
const [completedSchema, lostSchema] = CloseProjectBodySchema.options;
const closeInputSchema = z.discriminatedUnion('outcome', [
  completedSchema.omit({ version: true }),
  lostSchema.omit({ version: true }),
]);
const expectedVersionSchema = z.number().int().positive().optional();

/**
 * Parses a port input with the admin route's schema; a refusal is the
 * platform's `422 VALIDATION_FAILED` with a field error per issue.
 */
function parseOrRefuse<T>(schema: ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpError(
    422,
    ERROR_CODES.VALIDATION_FAILED,
    'The Project write is invalid.',
    parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), issue: issue.message })),
  );
}

export class ProjectCommandService implements ProjectCommandPort {
  constructor(private readonly deps: ProjectCommandServiceDeps) {}

  async create(input: CreateProjectBody, options: AggregateCommandOptions = {}): Promise<ProjectRecord> {
    const caller = callerOf(options);
    const body = parseOrRefuse(CreateProjectBodySchema, input);
    return this.#recordAfterWrite(await this.deps.projects.createProject(body, caller));
  }

  async update(id: string, patch: ProjectUpdatePatch, options: AggregateCommandOptions = {}): Promise<ProjectRecord> {
    const caller = callerOf(options);
    const body = parseOrRefuse(updatePatchSchema, patch ?? {});
    const version = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const visible = await this.deps.projects.updateProject(id, { ...body, version }, caller);
    return this.#recordAfterWrite(visible.id);
  }

  async setCustomFieldValues(
    id: string,
    merge: CustomFieldMerge,
    options: AggregateCommandOptions = {},
  ): Promise<ProjectRecord> {
    const caller = callerOf(options);
    if (typeof merge !== 'function') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The Project write is invalid.', [
        { path: 'merge', issue: 'Expected a function.' },
      ]);
    }
    const version = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    await this.deps.projects.setCustomFieldValues(id, merge, version, caller);
    return this.#recordAfterWrite(id);
  }

  async setOrganizations(
    id: string,
    input: { readonly organizationIds: readonly string[] },
    options: AggregateCommandOptions = {},
  ): Promise<ProjectRecord | null> {
    const caller = callerOf(options);
    const { organizationIds } = parseOrRefuse(organizationsInputSchema, input);
    const version = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const visible = await this.deps.projects.applyOrganizations(id, organizationIds, version, caller);
    // The route's `{ outOfReach: true }`: the change committed, and took the
    // Project out of the caller's own reach.
    if (!(await this.deps.access.inReachAfterWrite(visible.id))) return null;
    return this.#recordAfterWrite(visible.id);
  }

  async setMembers(
    id: string,
    input: { readonly members: readonly ProjectMemberInput[] },
    options: AggregateCommandOptions = {},
  ): Promise<ProjectRecord> {
    const caller = callerOf(options);
    const { members } = parseOrRefuse(membersInputSchema, input);
    const version = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const visible = await this.deps.projects.applyMembers(id, members, version, caller);
    return this.#recordAfterWrite(visible.id);
  }

  async moveToStage(
    id: string,
    input: { readonly toStageId: string },
    options: AggregateCommandOptions = {},
  ): Promise<ProjectRecord> {
    const caller = callerOf(options);
    const { toStageId } = parseOrRefuse(moveInputSchema, input);
    const version = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const written = await this.deps.moves.moveProject(id, { toStageId, version }, caller);
    return this.#recordAfterWrite(written.projectId);
  }

  async close(id: string, input: ProjectCloseInput, options: AggregateCommandOptions = {}): Promise<ProjectRecord> {
    const caller = callerOf(options);
    const body = parseOrRefuse(closeInputSchema, input);
    const version = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const visible = await this.deps.moves.closeProject(id, { ...body, version }, caller);
    return this.#recordAfterWrite(visible.id);
  }

  async reopen(id: string, options: AggregateCommandOptions = {}): Promise<ProjectRecord> {
    const caller = callerOf(options);
    const version = parseOrRefuse(expectedVersionSchema, options.expectedVersion);
    const visible = await this.deps.moves.reopenProject(id, { version }, caller);
    return this.#recordAfterWrite(visible.id);
  }

  async link(id: string, input: CreateProjectLinkBody, options: AggregateCommandOptions = {}): Promise<{ linkId: string }> {
    const caller = callerOf(options);
    const body = parseOrRefuse(CreateProjectLinkBodySchema, input);
    return { linkId: await this.deps.links.link(id, body, caller) };
  }

  async unlink(id: string, linkId: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.deps.links.remove(id, typeof linkId === 'string' ? linkId : '', caller);
  }

  async addComment(
    id: string,
    input: CreateProjectCommentBody,
    options: AggregateCommandOptions = {},
  ): Promise<{ commentId: string }> {
    const caller = callerOf(options);
    const body = parseOrRefuse(CreateProjectCommentBodySchema, input);
    const comment = await this.deps.comments.write(id, body, caller);
    return { commentId: comment.id };
  }

  async delete(id: string, options: AggregateCommandOptions = {}): Promise<void> {
    const caller = callerOf(options);
    await this.deps.projects.delete(id, caller);
  }

  async #recordAfterWrite(id: string): Promise<ProjectRecord> {
    return projectRecordOf(await this.deps.access.rowAfterWrite(id), this.deps.read);
  }
}

/**
 * The caller's options as the Commands take them. `source` is refused here,
 * first, so nothing is read or written for a malformed one (issue #1922).
 */
function callerOf(options: AggregateCommandOptions): CallerOptions {
  assertCallerSource(options ?? {});
  return { source: options?.source, extensions: options?.extensions };
}
