import type { FastifyInstance } from 'fastify';
import {
  ERROR_CODES,
  isUuidShape,
  projectMergeListQuerySchema,
  projectMergePreviewBodySchema,
  projectMergeStartBodySchema,
  projectMergeVersionBodySchema,
  type ProjectMergeListResponse,
  type ProjectMergePreviewResponse,
  type ProjectMergeRecord,
  type ProjectMergeRecordResponse,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { ProjectMergeService } from '../merge/project-merge-service.js';
import { projectNotFound, PROJECTS_WRITE_PERMISSION, type ProjectAccess } from '../services/project-access.js';

export interface ProjectMergeRoutesDeps {
  readonly access: Pick<ProjectAccess, 'findVisible' | 'visibleIds' | 'callerHolds'>;
  readonly merges: () => ProjectMergeService;
  readonly requireAdmin: RequireAdminFactory;
}

/**
 * The Project merge's admin API (`specs/192-organization-merge/` US6, FR-050;
 * `contracts/project-merge.md` §3), mirroring the Organization one.
 *
 * `projects:merge` gates every write and the list; one merge's detail is a
 * `projects:read` read. The actor must also **see and edit both** Projects
 * (FR-050): a Project the actor does not see answers `404 PROJECT_NOT_FOUND`,
 * as a missing one does, and one they see but may not edit (no
 * `projects:write`) the same — a merge writes both. A merge one of whose
 * Projects the actor does not see does not exist for them. The permission is
 * granted to no predefined role.
 */
export async function registerProjectMergeRoutes(app: FastifyInstance, deps: ProjectMergeRoutesDeps): Promise<void> {
  const { access, requireAdmin } = deps;

  /** Both Projects visible to the caller, who may also edit Projects; else 404. */
  const assertPair = async (survivorId: string, loserId: string): Promise<void> => {
    if (!(await access.callerHolds(PROJECTS_WRITE_PERMISSION))) throw projectNotFound();
    if ((await access.findVisible(survivorId)) === null) throw projectNotFound();
    if ((await access.findVisible(loserId)) === null) throw projectNotFound();
  };

  /** A merge both of whose Projects the caller sees, or 404. */
  const visibleMerge = async (mergeId: string): Promise<ProjectMergeRecord> => {
    const notFound = new HttpError(404, ERROR_CODES.NOT_FOUND, 'Merge not found.');
    if (!isUuidShape(mergeId)) throw notFound;
    const record = await deps.merges().get(mergeId);
    if (record === null) throw notFound;
    const visible = await access.visibleIds([record.survivorId, record.loserId]);
    if (!visible.has(record.survivorId) || !visible.has(record.loserId)) throw notFound;
    return record;
  };

  const view = async (record: ProjectMergeRecord) => (await deps.merges().views([record]))[0]!;

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/merge-preview',
    { preHandler: requireAdmin('projects:merge'), schema: { body: projectMergePreviewBodySchema } },
    async (request): Promise<ProjectMergePreviewResponse> => {
      const { loserId } = projectMergePreviewBodySchema.parse(request.body);
      await assertPair(request.params.id, loserId);
      return { data: await deps.merges().preview(request.params.id, loserId) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/merges',
    { preHandler: requireAdmin('projects:merge'), schema: { body: projectMergeStartBodySchema } },
    async (request, reply): Promise<ProjectMergeRecordResponse> => {
      const body = projectMergeStartBodySchema.parse(request.body);
      await assertPair(request.params.id, body.loserId);
      const record = await deps.merges().start(request.params.id, {
        loserId: body.loserId,
        ...(body.fieldChoices ? { fieldChoices: body.fieldChoices } : {}),
        ...(body.customFieldChoices ? { customFieldChoices: body.customFieldChoices } : {}),
        ...(body.acknowledgeIrreversible !== undefined
          ? { acknowledgeIrreversible: body.acknowledgeIrreversible }
          : {}),
      });
      reply.status(202);
      return { data: await view(record) };
    },
  );

  app.get(
    '/api/v1/admin/project-merges',
    { preHandler: requireAdmin('projects:merge') },
    async (request): Promise<ProjectMergeListResponse> => {
      const query = projectMergeListQuerySchema.parse(request.query ?? {});
      const records = await deps.merges().list({
        ...(query.state !== undefined ? { state: query.state } : {}),
        ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      });
      const visible = await access.visibleIds(records.flatMap((record) => [record.survivorId, record.loserId]));
      return {
        data: await deps.merges().views(records.filter((r) => visible.has(r.survivorId) && visible.has(r.loserId))),
      };
    },
  );

  app.get<{ Params: { mergeId: string } }>(
    '/api/v1/admin/project-merges/:mergeId',
    { preHandler: requireAdmin('projects:read') },
    async (request): Promise<ProjectMergeRecordResponse> => ({
      data: await view(await visibleMerge(request.params.mergeId)),
    }),
  );

  app.post<{ Params: { mergeId: string } }>(
    '/api/v1/admin/project-merges/:mergeId/resume',
    { preHandler: requireAdmin('projects:merge'), schema: { body: projectMergeVersionBodySchema } },
    async (request): Promise<ProjectMergeRecordResponse> => {
      const { expectedVersion } = projectMergeVersionBodySchema.parse(request.body);
      await visibleMerge(request.params.mergeId);
      return { data: await view(await deps.merges().resume(request.params.mergeId, expectedVersion)) };
    },
  );

  app.post<{ Params: { mergeId: string } }>(
    '/api/v1/admin/project-merges/:mergeId/cancel',
    { preHandler: requireAdmin('projects:merge'), schema: { body: projectMergeVersionBodySchema } },
    async (request): Promise<ProjectMergeRecordResponse> => {
      const { expectedVersion } = projectMergeVersionBodySchema.parse(request.body);
      await visibleMerge(request.params.mergeId);
      return { data: await view(await deps.merges().cancel(request.params.mergeId, expectedVersion)) };
    },
  );
}
