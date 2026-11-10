import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type AssetReadPort,
  type AssetsLibraryPort,
  type ProjectAttachment as ProjectAttachmentView,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { ProjectAttachment } from '../entities/project-attachment.entity.js';
import { asDownloadLink, refuseActiveContent } from './attachment-active-content.js';
import { actingAdminUserId, isUuid, type ProjectAccess } from './project-access.js';
import { lockProject } from './project-service.js';

export interface ProjectAttachmentServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: Pick<ProjectAccess, 'loadVisible' | 'visibleIds' | 'assertVisibleUnderLock'>;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  assets: AssetReadPort;
  assetsLibrary: AssetsLibraryPort;
  adminUsers: AdminUserReadPort;
}

export interface UploadedProjectFile {
  filename: string;
  /** What the request said the file is; the asset library reads the content itself. */
  declaredMime: string;
  bytes: Uint8Array;
}

const UNKNOWN_MIME_TYPE = 'application/octet-stream';

function attachmentNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This attachment does not belong to this project.');
}

/**
 * One answer for a file the caller cannot attach because, to them, it is not
 * there: it does not exist, it was deleted, or it is attached to a Project they
 * may not see. The three are indistinguishable on purpose.
 */
function fileUnavailable(): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The file does not exist in the media library.');
}

function adminName(admin: { firstName: string; lastName: string; email: string }): string {
  return `${admin.firstName} ${admin.lastName}`.trim() || admin.email;
}

/**
 * Files attached to a Project (`specs/163-projects-and-tasks/spec.md` FR-027;
 * research R-17; `contracts/admin-api.md` §2.4) — CRM's
 * `opportunity-attachment-service.ts` and its upload service, the model.
 *
 * **The bytes are the asset library's.** An attachment is an asset id held by
 * value; name, type and size are read through `assetReadPort`, and the library
 * refuses to delete a file a Project uses (`project-asset-references.ts`).
 * **An attachment is private, live and never active content** — a public file
 * has a stable address anybody can fetch, and an HTML or SVG file opened from
 * the API's origin runs with the reader's session.
 *
 * **The download link is resolved here**, through `assetsLibraryPort`, because
 * the library's own admin API is behind the library's permissions; it is handed
 * out only under a Project the caller may see — and a file attached to a
 * Project the caller may not see cannot be attached elsewhere to obtain one.
 *
 * **The upload stores first and attaches second**, two writes in two modules
 * that cannot share a transaction: when attaching fails the stored file is
 * soft-deleted again, so no private file is left belonging to nothing.
 *
 * Every read and write starts from `ProjectAccess.loadVisible`; attachments
 * are read by that Project's id, or by asset to ask which Projects hold a file
 * (answered through `visibleIds`). Every write is a Command against `project`
 * that locks the Project and asks again, under the lock, whether the caller may
 * still see it (`lockProject`, T144 F3; issue #471): a visibility change between
 * the check and the write is refused as if the Project did not exist (for an
 * upload, the stored file is then taken back, as for any failed attach).
 */
export class ProjectAttachmentService {
  constructor(private readonly deps: ProjectAttachmentServiceDeps) {}

  /** Oldest first. */
  async list(projectId: string): Promise<ProjectAttachmentView[]> {
    const project = await this.deps.access.loadVisible(projectId);
    const rows = await this.deps
      .emFactory()
      .find(ProjectAttachment, { projectId: project.id }, { orderBy: { addedAt: 'asc', id: 'asc' } });
    return this.#render(rows);
  }

  /**
   * Attach a file of the library. Attaching one the Project already has answers
   * the attachment that exists and writes nothing (`created: false`).
   */
  async add(projectId: string, assetId: string): Promise<{ attachment: ProjectAttachmentView; created: boolean }> {
    const uploader = this.#uploader();
    const project = await this.deps.access.loadVisible(projectId);
    const em = this.deps.emFactory();

    const existing = await em.findOne(ProjectAttachment, { projectId: project.id, assetId });
    if (existing) return { attachment: await this.#renderOne(existing), created: false };

    const asset = await this.deps.assets.findById(assetId, { liveOnly: true });
    if (!asset) throw fileUnavailable();
    // A file the library hides from the caller — held only by records of any
    // module they may not see — is not there to attach, and gets the
    // missing-file answer before the private-file and active-content refusals
    // could tell it apart (`specs/166-asset-reference-visibility/` R-13, FR-006).
    if (!(await this.deps.assets.visibleToCaller([assetId])).has(assetId)) throw fileUnavailable();
    await this.#refuseAFileHeldOutOfSight(em, assetId);
    if (asset.visibility !== 'private') {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'An attachment must be a private file. Upload it to the media library as private.',
      );
    }
    refuseActiveContent({ filename: asset.filename, mimeType: asset.mimeType });

    let row: ProjectAttachment;
    try {
      row = await this.deps.commandBus.run({
        action: 'projects.project.attachment_add',
        objectType: 'project',
        objectId: project.id,
        run: async ({ em: tx }) => {
          await lockProject(tx as EntityManager, this.deps.access, project.id);
          const created = (tx as EntityManager).create(ProjectAttachment, {
            projectId: project.id,
            assetId,
            addedByAdminUserId: uploader,
          });
          return {
            result: created,
            before: null,
            after: { attachmentId: created.id, assetId, fileName: asset.filename },
          };
        },
      });
    } catch (error) {
      // A switched-off owner of anything the Command reaches is the answer for
      // the whole request, never a tolerated failure.
      rethrowIfModuleDisabled(error);
      // Two requests attaching one file to one Project: the unique key refused
      // the second at commit. The Command reads no other module, so a unique
      // violation can be nothing else.
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
      const winner = await this.deps.emFactory().findOneOrFail(ProjectAttachment, { projectId: project.id, assetId });
      return { attachment: await this.#renderOne(winner), created: false };
    }
    return { attachment: await this.#renderOne(row), created: true };
  }

  /** Remove the attachment. The file stays in the library, and may now be deleted there. */
  async remove(projectId: string, attachmentId: string): Promise<void> {
    const project = await this.deps.access.loadVisible(projectId);
    await this.deps.commandBus.run({
      action: 'projects.project.attachment_remove',
      objectType: 'project',
      objectId: project.id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        await lockProject(tx, this.deps.access, project.id);
        if (!isUuid(attachmentId)) throw attachmentNotFound();
        const row = await tx.findOne(ProjectAttachment, {
          id: attachmentId,
          projectId: project.id,
        });
        if (!row) throw attachmentNotFound();
        const before = { attachmentId: row.id, assetId: row.assetId };
        tx.remove(row);
        return { result: undefined, before, after: null };
      },
    });
  }

  /** 404 unless the caller may see the Project. Called before the request body is read. */
  async assertReachable(projectId: string): Promise<void> {
    await this.deps.access.loadVisible(projectId);
  }

  /**
   * Upload a file and attach it, in one request, under `projects:write` alone:
   * the library's own upload asks for `assets.write`, which the people running
   * a Project need not hold. The bytes go through `assetsLibraryPort.upload` —
   * the library's pipeline, so its allowed types, its size limit and its
   * content sniffing decide — stored `private`, then attached by {@link add}.
   * A stored file that could not be attached is taken back.
   */
  async upload(projectId: string, file: UploadedProjectFile): Promise<ProjectAttachmentView> {
    this.#uploader();
    await this.assertReachable(projectId);
    // Before a byte is stored: a document a browser would run is not an attachment.
    refuseActiveContent({ filename: file.filename, mimeType: file.declaredMime });

    const { bytes } = file;
    const asset = await this.deps.assetsLibrary.upload({
      filename: file.filename,
      declaredMime: file.declaredMime,
      stream: (async function* () {
        yield bytes;
      })(),
      declaredSize: bytes.byteLength,
      folderId: null,
      label: null,
      visibility: 'private',
    });

    let attached = false;
    try {
      // Through the method, not a captured reference: the Command is the
      // attachment's own, audited against the Project.
      const { attachment } = await this.add(projectId, asset.id);
      attached = true;
      return attachment;
    } finally {
      if (!attached) await this.deps.assetsLibrary.softDelete(asset.id);
    }
  }

  #uploader(): string {
    const uploader = actingAdminUserId();
    if (uploader === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator can attach a file to a project.');
    }
    return uploader;
  }

  /**
   * A file already attached to a Project the caller may not see is, to the
   * caller, not there: knowing its id must not be enough to attach it to one's
   * own Project and be handed a link to it.
   */
  async #refuseAFileHeldOutOfSight(em: EntityManager, assetId: string): Promise<void> {
    const elsewhere = await em.find(ProjectAttachment, { assetId }, { fields: ['projectId'] });
    if (elsewhere.length === 0) return;
    const holders = [...new Set(elsewhere.map((attachment) => attachment.projectId))];
    const visible = await this.deps.access.visibleIds(holders);
    if (visible.size !== holders.length) throw fileUnavailable();
  }

  async #renderOne(row: ProjectAttachment): Promise<ProjectAttachmentView> {
    const [rendered] = await this.#render([row]);
    if (!rendered) throw new Error('projects: an attachment produced no rendering.');
    return rendered;
  }

  /** **Only with rows of a Project the caller may see**: this is where a signed link to each file is made. */
  async #render(rows: readonly ProjectAttachment[]): Promise<ProjectAttachmentView[]> {
    if (rows.length === 0) return [];
    const [assets, uploaders] = await Promise.all([
      this.deps.assets.findByIds([...new Set(rows.map((row) => row.assetId))], { liveOnly: true }),
      this.deps.adminUsers.findByIds([...new Set(rows.map((row) => row.addedByAdminUserId))]),
    ]);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const names = new Map(uploaders.map((admin) => [admin.id, adminName(admin)]));
    // One call per file that is still there, and none for one that is gone.
    const urls = new Map<string, string>();
    for (const asset of assets) {
      urls.set(asset.id, asDownloadLink((await this.deps.assetsLibrary.getAsset(asset.id)).url, asset.id));
    }
    return rows.map((row) => {
      const asset = assetById.get(row.assetId);
      const size = asset ? Number(asset.sizeBytes) : 0;
      return {
        id: row.id,
        assetId: row.assetId,
        fileName: asset?.filename ?? '',
        mimeType: asset?.mimeType ?? UNKNOWN_MIME_TYPE,
        sizeBytes: Number.isSafeInteger(size) && size >= 0 ? size : 0,
        url: urls.get(row.assetId) ?? null,
        uploadedBy: { id: row.addedByAdminUserId, name: names.get(row.addedByAdminUserId) ?? '' },
        createdAt: row.addedAt.toISOString(),
      };
    });
  }
}
