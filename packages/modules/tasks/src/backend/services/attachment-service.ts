import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type AssetReadPort,
  type AssetsLibraryPort,
  type TaskAttachment as TaskAttachmentView,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { TaskAttachment } from '../entities/task-attachment.entity.js';
import { recordTaskValueChange } from './task-audit-state.js';
import { asDownloadLink, refuseActiveContent } from './attachment-active-content.js';
import { actingAdminUserId, isUuid, type TaskAccess } from './task-access.js';

export interface TaskAttachmentServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  access: Pick<TaskAccess, 'loadVisible' | 'assertMayChange' | 'visibleIds'>;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  assets: AssetReadPort;
  assetsLibrary: AssetsLibraryPort;
  adminUsers: AdminUserReadPort;
}

export interface UploadedTaskFile {
  filename: string;
  /** What the request said the file is; the asset library reads the content itself. */
  declaredMime: string;
  bytes: Uint8Array;
}

const UNKNOWN_MIME_TYPE = 'application/octet-stream';

function attachmentNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This attachment does not belong to this task.');
}

/**
 * One answer for a file the caller cannot attach because, to them, it is not
 * there: it does not exist, it was deleted, or it is attached to a Task they
 * may not see. The three are indistinguishable on purpose.
 */
function fileUnavailable(): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The file does not exist in the media library.');
}

function adminName(admin: { firstName: string; lastName: string; email: string }): string {
  return `${admin.firstName} ${admin.lastName}`.trim() || admin.email;
}

/**
 * Files attached to a Task (`specs/165-task-management/` FR-008, research R-7;
 * `contracts/admin-api.md` §2) — Projects' `attachment-service.ts`, the model.
 *
 * **The bytes are the asset library's.** An attachment is an asset id held by
 * value; name, type and size are read through `assetReadPort`, and the library
 * refuses to delete a file a Task uses (`task-asset-references.ts`). **An
 * attachment is private, live and never active content.**
 *
 * **The download link is resolved here**, through `assetReadPort.resolveUrls`
 * in one batch per list (issue #545), because the library's own admin API is
 * behind the library's permissions; it is handed out only under a Task the
 * caller may see — and a file attached to a Task the caller may not see cannot
 * be attached elsewhere to obtain one.
 *
 * **The upload stores first and attaches second**, two writes in two modules
 * that cannot share a transaction: when attaching fails the stored file is
 * soft-deleted again, so no private file is left belonging to nothing.
 *
 * Every read and write starts from `TaskAccess.loadVisible`; attachments are
 * read by that Task's id, or by asset to ask which Tasks hold a file (answered
 * through `visibleIds`). Every write is a Command against `task`
 * (`tasks.attachment.add`, `tasks.attachment.remove`, data-model §7).
 */
export class TaskAttachmentService {
  constructor(private readonly deps: TaskAttachmentServiceDeps) {}

  /** Oldest first. */
  async list(taskId: string): Promise<TaskAttachmentView[]> {
    const task = await this.deps.access.loadVisible(taskId);
    const rows = await this.deps
      .emFactory()
      .find(TaskAttachment, { taskId: task.id }, { orderBy: { createdAt: 'asc', id: 'asc' } });
    return this.#render(rows);
  }

  /**
   * Attach a file of the library. Attaching one the Task already has answers
   * the attachment that exists and writes nothing (`created: false`).
   */
  async add(taskId: string, assetId: string): Promise<{ attachment: TaskAttachmentView; created: boolean }> {
    const uploader = this.#uploader();
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);
    const em = this.deps.emFactory();

    const existing = await em.findOne(TaskAttachment, { taskId: task.id, assetId });
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
      // The file's visibility refuses a well-formed request, so this is the
      // module's attachment refusal, not `VALIDATION_FAILED` (issue #642).
      // `code` is the refusal token that picks the sentence; `reason` is the
      // member a screen reads, as the size and active-content refusals carry.
      throw new HttpError(
        422,
        ERROR_CODES.TASK_ATTACHMENT_REFUSED,
        'An attachment must be a private file. Upload it to the media library as private.',
        { code: 'not_private', reason: 'not_private', assetId, visibility: asset.visibility },
      );
    }
    refuseActiveContent({ filename: asset.filename, mimeType: asset.mimeType });

    let row: TaskAttachment;
    try {
      row = await this.deps.commandBus.run({
        action: 'tasks.attachment.add',
        objectType: 'task',
        objectId: task.id,
        run: async ({ em: tx }) => {
          const created = (tx as EntityManager).create(TaskAttachment, {
            taskId: task.id,
            assetId,
            addedByAdminUserId: uploader,
          });
          // A file's name is free text: it goes to the Task's own store (#470).
          const values = recordTaskValueChange(tx as EntityManager, task.id, {
            before: null,
            after: { fileName: asset.filename },
          });
          return {
            result: created,
            before: null,
            after: { attachmentId: created.id, assetId, ...values },
          };
        },
      });
    } catch (error) {
      rethrowIfModuleDisabled(error);
      // Two requests attaching one file to one Task: the unique key refused the
      // second at commit. The Command reads no other module, so a unique
      // violation can be nothing else.
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
      const winner = await this.deps.emFactory().findOneOrFail(TaskAttachment, { taskId: task.id, assetId });
      return { attachment: await this.#renderOne(winner), created: false };
    }
    return { attachment: await this.#renderOne(row), created: true };
  }

  /** Remove the attachment. The file stays in the library, and may now be deleted there. */
  async remove(taskId: string, attachmentId: string): Promise<void> {
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);
    await this.deps.commandBus.run({
      action: 'tasks.attachment.remove',
      objectType: 'task',
      objectId: task.id,
      run: async ({ em }) => {
        const tx = em as EntityManager;
        if (!isUuid(attachmentId)) throw attachmentNotFound();
        const row = await tx.findOne(TaskAttachment, { id: attachmentId, taskId: task.id });
        if (!row) throw attachmentNotFound();
        const before = { attachmentId: row.id, assetId: row.assetId };
        tx.remove(row);
        return { result: undefined, before, after: null };
      },
    });
  }

  /** 404 unless the caller may see the Task, 403 for someone else's private one. Before the body is read. */
  async assertWritable(taskId: string): Promise<void> {
    const task = await this.deps.access.loadVisible(taskId);
    this.deps.access.assertMayChange(task);
  }

  /**
   * Upload a file and attach it, in one request, under `tasks:write` alone:
   * the library's own upload asks for `assets.write`, which the people doing
   * the work need not hold. The bytes go through `assetsLibraryPort.upload` —
   * the library's pipeline, so its allowed types, its size limit and its
   * content sniffing decide — stored `private`, then attached by {@link add}.
   * A stored file that could not be attached is taken back.
   */
  async upload(taskId: string, file: UploadedTaskFile): Promise<TaskAttachmentView> {
    this.#uploader();
    await this.assertWritable(taskId);
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
      const { attachment } = await this.add(taskId, asset.id);
      attached = true;
      return attachment;
    } finally {
      if (!attached) await this.deps.assetsLibrary.softDelete(asset.id);
    }
  }

  #uploader(): string {
    const uploader = actingAdminUserId();
    if (uploader === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator can attach a file to a task.');
    }
    return uploader;
  }

  /**
   * A file already attached to a Task the caller may not see is, to the
   * caller, not there: knowing its id must not be enough to attach it to one's
   * own Task and be handed a link to it.
   */
  async #refuseAFileHeldOutOfSight(em: EntityManager, assetId: string): Promise<void> {
    const elsewhere = await em.find(TaskAttachment, { assetId }, { fields: ['taskId'] });
    if (elsewhere.length === 0) return;
    const holders = [...new Set(elsewhere.map((attachment) => attachment.taskId))];
    const visible = await this.deps.access.visibleIds(holders);
    if (visible.size !== holders.length) throw fileUnavailable();
  }

  async #renderOne(row: TaskAttachment): Promise<TaskAttachmentView> {
    const [rendered] = await this.#render([row]);
    if (!rendered) throw new Error('tasks: an attachment produced no rendering.');
    return rendered;
  }

  /** **Only with rows of a Task the caller may see**: this is where a signed link to each file is made. */
  async #render(rows: readonly TaskAttachment[]): Promise<TaskAttachmentView[]> {
    if (rows.length === 0) return [];
    const [assets, uploaders] = await Promise.all([
      this.deps.assets.findByIds([...new Set(rows.map((row) => row.assetId))], { liveOnly: true }),
      this.deps.adminUsers.findByIds([...new Set(rows.map((row) => row.addedByAdminUserId))]),
    ]);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const names = new Map(uploaders.map((admin) => [admin.id, adminName(admin)]));
    // One batched read for every file that is still there, and none for one
    // that is gone. `resolveUrls` answers the URL the asset detail carries —
    // signed and expiring for a private file — without the detail's "used by"
    // list, which asked every reference descriptor about each file (#545).
    const live = assets.map((asset) => asset.id);
    const resolved = live.length > 0 ? await this.deps.assets.resolveUrls(live) : new Map<string, string>();
    const urls = new Map<string, string>();
    for (const [assetId, url] of resolved) urls.set(assetId, asDownloadLink(url, assetId));
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
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
