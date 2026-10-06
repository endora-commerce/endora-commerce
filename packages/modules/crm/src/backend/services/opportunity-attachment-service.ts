import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type AssetReadPort,
  type AssetsLibraryPort,
  type OpportunityAttachment,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityAttachment } from '../entities/crm-opportunity-attachment.entity.js';
import { asDownloadLink, refuseActiveContent } from './attachment-active-content.js';
import { isUuid, loadOpportunity } from './opportunity-access.js';
import { actingAdminUserId } from './opportunity-assignment-service.js';

export interface OpportunityAttachmentServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /** Ports of other modules — lazy, resolved per call, never captured. */
  assets: AssetReadPort;
  assetsLibrary: AssetsLibraryPort;
  adminUsers: AdminUserReadPort;
}

const UNKNOWN_MIME_TYPE = 'application/octet-stream';

function attachmentNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'This attachment does not belong to this opportunity.');
}

/**
 * One answer for a file the caller cannot attach because, to them, it is not
 * there: it does not exist, it was deleted, or it is already attached to an
 * Opportunity they may not see. The three are indistinguishable on purpose.
 */
function fileUnavailable(): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'The file does not exist in the media library.');
}

/**
 * Files attached to an Opportunity
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §7; research
 * R-15, N-B16).
 *
 * **The bytes are the media library's.** The administrator uploads there first
 * and hands this module the asset's id; an attachment is that id, held by
 * value, with the file name as it was at that moment. Name, type and size are
 * read through `assetReadPort`; deletion of the file is refused by the library
 * while an attachment points at it (`crm-asset-references.ts`).
 *
 * **An attachment is a private file.** The library uploads as `public` unless
 * told otherwise, and a public file has a stable URL anybody can fetch — so a
 * file that is not `private` is refused here, and the screen uploads with
 * `visibility: 'private'`. The port says nothing about what a file was
 * uploaded *for*, so that is all this module can hold it to.
 *
 * **The download link is resolved here**, through `assetsLibraryPort`, because
 * the library's own admin API is gated on the library's permissions and the
 * people working an Opportunity need not hold them. It is a signed link that
 * expires within minutes, so a screen reads the list again before it opens
 * one. It is handed out only under an Opportunity that was loaded through the
 * tenant-scoped EntityManager — and a file already attached to an Opportunity
 * the caller cannot see cannot be attached elsewhere to obtain one.
 *
 * Every write is a Command recorded against the Opportunity.
 */
export class OpportunityAttachmentService {
  constructor(private readonly deps: OpportunityAttachmentServiceDeps) {}

  /** Oldest first. */
  async list(opportunityId: string): Promise<OpportunityAttachment[]> {
    const em = this.deps.emFactory();
    const opportunity = await loadOpportunity(em, opportunityId);
    const rows = await em.find(
      CrmOpportunityAttachment,
      { opportunityId: opportunity.id },
      { orderBy: { createdAt: 'asc', id: 'asc' } },
    );
    return this.#render(rows);
  }

  /**
   * Attach a file of the library. Attaching one the Opportunity already has
   * answers the attachment that exists and writes nothing (`created: false`).
   */
  async add(
    opportunityId: string,
    assetId: string,
  ): Promise<{ attachment: OpportunityAttachment; created: boolean }> {
    const uploader = actingAdminUserId();
    if (uploader === null) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator can attach a file to an opportunity.');
    }
    const em = this.deps.emFactory();
    // The parent first: an Opportunity the caller cannot see is a 404 before
    // the file is looked at.
    const visible = await loadOpportunity(em, opportunityId);

    const existing = await em.findOne(CrmOpportunityAttachment, { opportunityId: visible.id, assetId });
    if (existing) return { attachment: await this.#renderOne(existing), created: false };

    const asset = await this.deps.assets.findById(assetId, { liveOnly: true });
    if (!asset) throw fileUnavailable();
    await this.#refuseAFileHeldOutOfReach(em, assetId);
    if (asset.visibility !== 'private') {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'An attachment must be a private file. Upload it to the media library as private.',
      );
    }
    // The same refusal as the upload's: a file of the library is held to it too.
    refuseActiveContent({ filename: asset.filename, mimeType: asset.mimeType });

    let row: CrmOpportunityAttachment;
    try {
      row = await this.deps.commandBus.run({
        action: 'crm.opportunity.attachment_add',
        objectType: 'crm_opportunity',
        objectId: visible.id,
        run: async ({ em: tx }) => {
          const opportunity = await loadOpportunity(tx, opportunityId);
          const created = tx.create(CrmOpportunityAttachment, {
            opportunityId: opportunity.id,
            assetId,
            fileName: asset.filename.slice(0, 255),
            uploadedByAdminUserId: uploader,
          });
          return {
            result: created,
            before: null,
            after: { attachmentId: created.id, assetId, fileName: created.fileName },
          };
        },
      });
    } catch (error) {
      // Two requests attaching one file to one Opportunity: the unique
      // constraint refused the second at commit. The Command reads no other
      // module's port, so a unique violation can be nothing else.
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
      const winner = await this.deps
        .emFactory()
        .findOneOrFail(CrmOpportunityAttachment, { opportunityId: visible.id, assetId });
      return { attachment: await this.#renderOne(winner), created: false };
    }
    return { attachment: await this.#renderOne(row), created: true };
  }

  /** Remove the link. The file stays in the library, and may now be deleted there. */
  async remove(opportunityId: string, attachmentId: string): Promise<void> {
    await this.deps.commandBus.run({
      action: 'crm.opportunity.attachment_remove',
      objectType: 'crm_opportunity',
      objectId: opportunityId,
      run: async ({ em }) => {
        const opportunity = await loadOpportunity(em, opportunityId);
        if (!isUuid(attachmentId)) throw attachmentNotFound();
        const row = await em.findOne(CrmOpportunityAttachment, {
          id: attachmentId,
          opportunityId: opportunity.id,
        });
        if (!row) throw attachmentNotFound();
        const before = { attachmentId: row.id, assetId: row.assetId, fileName: row.fileName };
        em.remove(row);
        return { result: undefined, before, after: null };
      },
    });
  }

  /**
   * A file already attached to an Opportunity the caller cannot see is, to the
   * caller, not there. Without this, knowing a file's id would be enough to
   * attach it to one's own Opportunity and be handed a link to it.
   *
   * The attachments are read unfiltered — a child carries no tenant column —
   * and their Opportunities through the scoped EntityManager: one that does
   * not come back is one out of reach.
   */
  async #refuseAFileHeldOutOfReach(em: EntityManager, assetId: string): Promise<void> {
    const elsewhere = await em.find(CrmOpportunityAttachment, { assetId });
    if (elsewhere.length === 0) return;
    const holders = [...new Set(elsewhere.map((attachment) => attachment.opportunityId))];
    const reachable = await em.count(CrmOpportunity, { id: { $in: holders } });
    if (reachable !== holders.length) throw fileUnavailable();
  }

  async #renderOne(row: CrmOpportunityAttachment): Promise<OpportunityAttachment> {
    const [rendered] = await this.#render([row]);
    if (!rendered) throw new Error('crm: an attachment produced no rendering.');
    return rendered;
  }

  /**
   * **Call it only with rows of an Opportunity the caller may see**: this is
   * where a signed link to each file is produced.
   */
  async #render(rows: readonly CrmOpportunityAttachment[]): Promise<OpportunityAttachment[]> {
    if (rows.length === 0) return [];
    const [assets, uploaders] = await Promise.all([
      this.deps.assets.findByIds([...new Set(rows.map((row) => row.assetId))], { liveOnly: true }),
      this.deps.adminUsers.findByIds([...new Set(rows.map((row) => row.uploadedByAdminUserId))]),
    ]);
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const names = new Map(
      uploaders.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );
    // One call per file that is still there, and none for one that is gone —
    // so the library is never asked for something it would have to refuse.
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
        // The library's current name when the file is there; the name it had
        // when it was attached when it is not.
        fileName: asset?.filename ?? row.fileName,
        mimeType: asset?.mimeType ?? UNKNOWN_MIME_TYPE,
        sizeBytes: Number.isSafeInteger(size) && size >= 0 ? size : 0,
        url: urls.get(row.assetId) ?? null,
        uploadedBy: { id: row.uploadedByAdminUserId, name: names.get(row.uploadedByAdminUserId) ?? '' },
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
