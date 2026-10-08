import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AssetsLibraryPort,
  type OpportunityAttachment,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { refuseActiveContent } from './attachment-active-content.js';
import { loadOpportunity } from './opportunity-access.js';
import { actingAdminUserId } from './opportunity-assignment-service.js';

export interface UploadedAttachmentFile {
  filename: string;
  /** What the request said the file is; the media library reads the content itself. */
  declaredMime: string;
  bytes: Uint8Array;
}

export interface OpportunityAttachmentUploadServiceDeps {
  emFactory: () => EntityManager;
  /** The media library's port — lazy, resolved per call, never captured. */
  assetsLibrary: AssetsLibraryPort;
  /** Attaching a file of the library to an Opportunity: the existing Command. */
  attach: (
    opportunityId: string,
    assetId: string,
  ) => Promise<{ attachment: OpportunityAttachment; created: boolean }>;
}

/**
 * Upload a file and attach it to an Opportunity, in one request
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §7a; research
 * N-F1).
 *
 * **Why CRM has an upload of its own.** The media library's upload endpoint
 * asks for the library's `assets.write`, which the people working an
 * Opportunity need not hold — so a Sales Rep could list, download and remove
 * attachments and not add one. This path is gated by `crm:write` and reaches
 * the library through `assetsLibraryPort.upload`, the seam `pwa` already
 * stores an icon through: the same upload pipeline as the library's own route,
 * so the allowed types, the size limit, the content sniffing and the storage
 * backend are the library's and are not restated here.
 *
 * **Order.** The Opportunity is loaded through the tenant-scoped EntityManager
 * before a byte is stored: one the caller cannot see is 404 and leaves nothing
 * behind. The file is then stored `private` — an attachment is never a file
 * with a public address — and attached by the attachment service's own
 * Command, which audits it against the Opportunity. The library audits its
 * half (`asset.upload`).
 *
 * **A stored file that could not be attached is taken back.** The two writes
 * are in two modules and cannot share a transaction, so a failure of the
 * second is compensated: the asset is soft-deleted, and the library purges it.
 * Left in place it would be a private file belonging to nothing, which anybody
 * holding `crm:write` and its id could attach.
 */
export class OpportunityAttachmentUploadService {
  constructor(private readonly deps: OpportunityAttachmentUploadServiceDeps) {}

  /** 404 unless the caller may see the Opportunity. Called before the request body is read. */
  async assertReachable(opportunityId: string): Promise<void> {
    await loadOpportunity(this.deps.emFactory(), opportunityId);
  }

  async upload(opportunityId: string, file: UploadedAttachmentFile): Promise<OpportunityAttachment> {
    if (actingAdminUserId() === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator can attach a file to an opportunity.');
    }
    await this.assertReachable(opportunityId);
    // Before a byte is stored: a document a browser would run is not an attachment.
    refuseActiveContent({ filename: file.filename, mimeType: file.declaredMime });

    const { bytes } = file;
    const asset = await this.deps.assetsLibrary.upload({
      filename: file.filename,
      declaredMime: file.declaredMime,
      stream: (async function* () {
        yield bytes;
      })(),
      // The real size, known because the file was read whole: it is what lets
      // the library hold the file to its size limit as that limit is set now.
      declaredSize: bytes.byteLength,
      folderId: null,
      label: null,
      visibility: 'private',
    });

    let attached = false;
    try {
      const { attachment } = await this.deps.attach(opportunityId, asset.id);
      attached = true;
      return attachment;
    } finally {
      if (!attached) await this.deps.assetsLibrary.softDelete(asset.id);
    }
  }
}
