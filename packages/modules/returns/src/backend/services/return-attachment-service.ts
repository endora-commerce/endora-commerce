import { Readable } from 'node:stream';
import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  RETURN_ATTACHMENT_LIMITS,
  isUuidShape,
  type AssetByteStream,
  type ObjectStoragePort,
  type ReturnAttachmentDto,
  type ReturnAttachmentType,
  type ReturnUploadDto,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseAttachment } from '../entities/return-case-attachment.entity.js';
import { sniffAttachmentType } from './attachment-sniff.js';
import type { ReturnCaseScope, ReturnCustomerContext } from './return-case-scope.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import type { CaseAttachmentClaims, ClaimedUpload } from './return-case-service.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import { attachmentDtoOf } from './return-case-service.js';

/** How long an unclaimed upload waits for its filing (180 research R-12). */
export const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export interface ReturnAttachmentServiceDeps {
  emFactory: () => EntityManager;
  /** `assets_library`'s object store: bytes under `returns/…`, no asset row (research R-12). */
  storage: Pick<ObjectStoragePort, 'getActive' | 'getForBackend'>;
  commandBus: Pick<CommandBus, 'run'>;
  graphService: Pick<ReturnStatusGraphService, 'loadGraph'>;
  /** The buyer's case scope: the filer, or a member holding `returns.view_organization`. */
  scope: ReturnCaseScope;
  now?: () => Date;
}

/** A file as the route read it from the multipart body. */
export interface IncomingFile {
  readonly type: ReturnAttachmentType;
  readonly filename: string;
  readonly bytes: Buffer;
  readonly returnCaseItemId?: string | undefined;
}

/** What a file route streams back. */
export interface ServedAttachment {
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly stream: AssetByteStream;
}

/**
 * ReturnAttachmentService — the files a customer sends for a case
 * (`specs/180-off-platform-complaints/` FR-B20 – FR-B24, research R-12).
 *
 * The bytes go to the deployment's object store through `objectStoragePort`, under
 * `returns/<organizationId>/<attachmentId>`, private, and **no media-library asset is
 * created**: customer evidence must not appear in the operator's library or be served
 * by an id-addressed public route. They are served only through this module's own
 * routes, behind the case's audience (FR-B22).
 *
 * - A *pending upload* (`POST /api/v1/returns/uploads`) is a row with no case and an
 *   expiry; the filing claims it in its own transaction (FR-B24).
 * - A file added to an open case runs Command `return_case.attachment.add`.
 * - The type is the one the bytes say (`attachment-sniff.ts`), never the declared one.
 */
export class ReturnAttachmentService implements CaseAttachmentClaims {
  constructor(private readonly deps: ReturnAttachmentServiceDeps) {}

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  /** A pending upload of the caller (customer-api.md §C2). */
  async storeUpload(customer: ReturnCustomerContext, file: IncomingFile): Promise<ReturnUploadDto> {
    const organizationId = requireOrganization(customer);
    const mimeType = acceptedType(file.bytes);
    const id = randomUUID();
    const stored = await this.putObject(organizationId, id, mimeType, file.bytes);
    const expiresAt = new Date(this.now().getTime() + PENDING_UPLOAD_TTL_MS);
    try {
      // command-coverage-ignore: a pending upload is a staging row with no case and a
      // 24-hour life (research R-11); the filing that claims it is the audited Command
      // `return_case.create`, and the maintenance sweep deletes it otherwise.
      const em = this.deps.emFactory();
      em.persist(
        em.create(ReturnCaseAttachment, {
          id,
          organizationId,
          customerAccountId: customer.customerAccountId,
          type: file.type,
          filename: sanitizeFilename(file.filename),
          mimeType,
          sizeBytes: file.bytes.length,
          storageBackend: stored.backend,
          storageLocator: stored.locator,
          expiresAt,
        }),
      );
      await em.flush();
    } catch (error) {
      await this.deleteObject(stored.backend, stored.locator);
      throw error;
    }
    return {
      uploadId: id,
      type: file.type,
      filename: sanitizeFilename(file.filename),
      mimeType,
      sizeBytes: file.bytes.length,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** A file added to an open case the caller filed (customer-api.md §C4). */
  async addToCase(caseId: string, customer: ReturnCustomerContext, file: IncomingFile): Promise<ReturnAttachmentDto> {
    const organizationId = requireOrganization(customer);
    if (!isUuidShape(caseId)) throw notFound();
    await this.loadOpenCaseOf(this.deps.emFactory(), caseId, customer.customerAccountId);
    await this.assertLineOf(this.deps.emFactory(), caseId, file.returnCaseItemId);
    await this.assertRoom(this.deps.emFactory(), caseId, 1);
    const mimeType = acceptedType(file.bytes);
    const id = randomUUID();
    const stored = await this.putObject(organizationId, id, mimeType, file.bytes);
    try {
      return await this.deps.commandBus.run<ReturnAttachmentDto>({
        action: 'return_case.attachment.add',
        objectType: 'return_case',
        objectId: caseId,
        run: async ({ em }) => {
          await this.loadOpenCaseOf(em, caseId, customer.customerAccountId);
          await this.assertLineOf(em, caseId, file.returnCaseItemId);
          await this.assertRoom(em, caseId, 1);
          const row = em.create(ReturnCaseAttachment, {
            id,
            returnCaseId: caseId,
            returnCaseItemId: file.returnCaseItemId ?? null,
            organizationId,
            customerAccountId: customer.customerAccountId,
            type: file.type,
            filename: sanitizeFilename(file.filename),
            mimeType,
            sizeBytes: file.bytes.length,
            storageBackend: stored.backend,
            storageLocator: stored.locator,
          });
          em.persist(row);
          await em.flush();
          // Names only: never the file name the customer chose (D-288).
          return { result: attachmentDtoOf(row), before: null, after: { attachmentId: id, type: file.type } };
        },
      });
    } catch (error) {
      await this.deleteObject(stored.backend, stored.locator);
      throw error;
    }
  }

  /**
   * Claim the caller's pending uploads for the case being filed, in the filing's
   * transaction (FR-B24): each must be the caller's own, unclaimed and unexpired — any
   * other id is refused naming it — and together they stay within the per-submission
   * budget. Each claimed row records the line of the new case it shows, if any; an
   * upload named twice keeps its first line.
   */
  async claim(
    em: EntityManager,
    input: { uploads: readonly ClaimedUpload[]; customerAccountId: string; organizationId: string; returnCaseId: string },
  ): Promise<{ count: number; types: ReturnAttachmentType[] }> {
    const lineOf = new Map<string, string | null>();
    for (const u of input.uploads) if (!lineOf.has(u.uploadId)) lineOf.set(u.uploadId, u.returnCaseItemId);
    const ids = [...lineOf.keys()];
    if (ids.length > RETURN_ATTACHMENT_LIMITS.maxFilesPerCase) throw rejected('too_many');
    const rows = await em.find(ReturnCaseAttachment, {
      id: { $in: ids.filter(isUuidShape) },
      organizationId: input.organizationId,
      customerAccountId: input.customerAccountId,
      returnCaseId: null,
      expiresAt: { $gt: this.now() },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      if (!byId.has(id)) throw rejected('unknown_upload', { uploadId: id });
    }
    const total = rows.reduce((sum, r) => sum + (r.sizeBytes ?? 0), 0);
    if (total > RETURN_ATTACHMENT_LIMITS.maxSubmissionBytes) throw rejected('submission_too_large', { maxMb: 30 });
    for (const row of rows) {
      row.returnCaseId = input.returnCaseId;
      row.returnCaseItemId = lineOf.get(row.id) ?? null;
      row.expiresAt = null;
    }
    return { count: rows.length, types: rows.map((r) => r.type) };
  }

  /** A case's file for the buyer, within the case read's scope (customer-api.md §C5). */
  async openForCustomer(caseId: string, attachmentId: string, customer: ReturnCustomerContext): Promise<ServedAttachment> {
    if (!isUuidShape(caseId) || !isUuidShape(attachmentId)) throw notFound();
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, await this.deps.scope.where(customer, { id: caseId }));
    if (!rc) throw notFound();
    return this.open(em, caseId, attachmentId);
  }

  /** A case's file for an administrator (admin-api.md §B3). */
  async openForAdmin(caseId: string, attachmentId: string): Promise<ServedAttachment> {
    if (!isUuidShape(caseId) || !isUuidShape(attachmentId)) throw notFound();
    const em = this.deps.emFactory();
    if (!(await em.findOne(ReturnCase, { id: caseId }))) throw notFound();
    return this.open(em, caseId, attachmentId);
  }

  /** Delete a row's bytes, then the row — erasure and the maintenance sweep (research R-15). */
  async deleteObjectOf(row: Pick<ReturnCaseAttachment, 'storageBackend' | 'storageLocator'>): Promise<void> {
    if (row.storageBackend && row.storageLocator) await this.deleteObject(row.storageBackend, row.storageLocator);
  }

  // --- internals -------------------------------------------------------------------

  private async open(em: EntityManager, caseId: string, attachmentId: string): Promise<ServedAttachment> {
    // A legacy `asset_id` row is neither listed nor served (research R-12).
    const row = await em.findOne(ReturnCaseAttachment, {
      id: attachmentId,
      returnCaseId: caseId,
      storageLocator: { $ne: null },
    });
    if (!row || !row.storageBackend || !row.storageLocator) throw notFound();
    const store = await this.deps.storage.getForBackend(row.storageBackend as never);
    return {
      filename: row.filename ?? 'attachment',
      mimeType: row.mimeType ?? 'application/octet-stream',
      sizeBytes: row.sizeBytes ?? 0,
      stream: await store.open({ locator: row.storageLocator }),
    };
  }

  private async loadOpenCaseOf(em: EntityManager, caseId: string, customerAccountId: string): Promise<ReturnCase> {
    // The filer's only: a colleague who may see the case does not add to it.
    const rc = await em.findOne(ReturnCase, { id: caseId, customerAccountId });
    if (!rc) throw notFound();
    if ((await this.deps.graphService.loadGraph()).isTerminal(rc.statusCode)) {
      // Issue #625 — a finished case refuses a change with its own code.
      throw new HttpError(409, ERROR_CODES.RETURN_CASE_CLOSED, 'Files can no longer be added to a finished case.', {
        returnCaseId: rc.id,
        statusCode: rc.statusCode,
      });
    }
    return rc;
  }

  /** A file added to a line names a line of this case (owner request on 180). */
  private async assertLineOf(em: EntityManager, caseId: string, returnCaseItemId: string | undefined): Promise<void> {
    if (returnCaseItemId === undefined) return;
    const item = isUuidShape(returnCaseItemId)
      ? await em.findOne(ReturnCaseItem, { id: returnCaseItemId, returnCaseId: caseId })
      : null;
    if (!item) throw rejected('unknown_line', { returnCaseItemId });
  }

  private async assertRoom(em: EntityManager, caseId: string, adding: number): Promise<void> {
    const count = await em.count(ReturnCaseAttachment, { returnCaseId: caseId, storageLocator: { $ne: null } });
    if (count + adding > RETURN_ATTACHMENT_LIMITS.maxFilesPerCase) {
      throw rejected('too_many', { max: RETURN_ATTACHMENT_LIMITS.maxFilesPerCase });
    }
  }

  private async putObject(
    organizationId: string,
    id: string,
    mimeType: string,
    bytes: Buffer,
  ): Promise<{ backend: string; locator: string }> {
    const store = await this.deps.storage.getActive();
    const locator = `returns/${organizationId}/${id}`;
    await store.put({ locator, mimeType, visibility: 'private', stream: Readable.from([bytes]), sizeBytes: bytes.length });
    return { backend: store.code, locator };
  }

  private async deleteObject(backend: string, locator: string): Promise<void> {
    const store = await this.deps.storage.getForBackend(backend as never);
    await store.delete({ locator });
  }
}

function notFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
}

function rejected(reason: string, extra: Record<string, unknown> = {}): HttpError {
  const sentences: Record<string, string> = {
    too_large: 'A file may be at most 10 MB.',
    type_not_accepted: 'Only JPEG, PNG and WebP images and PDF files can be attached.',
    unknown_upload: 'This file cannot be attached: upload it again.',
    too_many: 'A case can hold at most 10 files.',
    submission_too_large: 'The files of one submission may be at most 30 MB together.',
    unknown_line: 'This file names a line the case does not have.',
  };
  const status = reason === 'too_large' ? 413 : 422;
  return new HttpError(status, ERROR_CODES.RETURN_ATTACHMENT_REJECTED, sentences[reason] ?? 'This file cannot be attached.', {
    reason,
    ...extra,
  });
}

/** The refusal of a file over the per-file limit, for the route's multipart parser. */
export function tooLarge(): HttpError {
  return rejected('too_large', { maxMb: RETURN_ATTACHMENT_LIMITS.maxFileBytes / (1024 * 1024) });
}

function acceptedType(bytes: Buffer): string {
  const mime = sniffAttachmentType(bytes);
  if (!mime) throw rejected('type_not_accepted');
  return mime;
}

function requireOrganization(customer: ReturnCustomerContext): string {
  if (!customer.organizationId) throw notFound();
  return customer.organizationId;
}

/** A display name safe to store and to echo in a header: no path, no control characters. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return (clean || 'attachment').slice(0, 255);
}
