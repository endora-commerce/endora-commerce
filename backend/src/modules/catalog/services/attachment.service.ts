/**
 * AttachmentService — admin-only CRUD for AttachmentTypes (global
 * dictionary) and ProductAttachments (per-product wrappers around an
 * Asset). Feature 002 US3, data-model.md §2.5, §2.6.
 *
 * Foundation has no public AssetsService — Asset is imported as an
 * entity directly (research.md R-9 + foundation pattern), and the
 * service layer guards `kind ∈ {pdf, certificate, other}` for
 * attachments (image / video are reserved for the gallery).
 */

import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';

import {
  ERROR_CODES,
  type AssetReadPort,
  type AttachmentType as AttachmentTypeDto,
  type CreateAttachmentTypeRequest,
  type UpdateAttachmentTypeRequest,
  type ProductAttachment as ProductAttachmentDto,
  type CreateAttachmentRequest,
  type UpdateAttachmentRequest,
} from '@endora-commerce/contracts';

import { HttpError } from '../../../http/error-envelope.js';
import type { CommandBus } from '../../../commands/index.js';
import { Product } from '../entities/product.entity.js';
import { AttachmentType } from '../entities/attachment-type.entity.js';
import { ProductAttachment } from '../entities/product-attachment.entity.js';

const ASSET_KINDS_ATTACHMENT = new Set(['pdf', 'certificate', 'other']);

export class AttachmentService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits attachment writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
    /**
     * Feature 075 — `assets_library`'s read port, where `em.findOne(Asset, …)`
     * used to be. The check below is the reason this read exists: an attach
     * that cannot verify the asset would store a dangling id, so with
     * `assets_library` off the port fails closed and the attach is refused.
     */
    private readonly assets?: AssetReadPort,
  ) {}

  #requireAssets(): AssetReadPort {
    if (!this.assets) {
      throw new Error(
        'AttachmentService: the asset read port is not wired — an attachment cannot be verified.',
      );
    }
    return this.assets;
  }

  /** Feature 054 — run an attachment write through the Command Bus. */
  async #audited<T>(
    action: string,
    objectType: string,
    objectId: string,
    write: (em: EntityManager) => Promise<{
      result: T;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>,
  ): Promise<T> {
    if (this.commandBus) {
      return this.commandBus.run({ action, objectType, objectId, run: ({ em }) => write(em) });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush();
    return w.result;
  }

  // -- Attachment Types -----------------------------------------------------

  async listTypes(): Promise<AttachmentTypeDto[]> {
    const em = this.emFactory();
    const rows = (await em.execute(
      `select t.id, t.code, t.name, t.position, t.created_at, t.updated_at,
              (select count(*)::int from product_attachments pa where pa.attachment_type_id = t.id) as usage_count
       from attachment_types t
       order by t.position asc, t.code asc`,
    )) as Array<{
      id: string;
      code: string;
      name: Record<string, string>;
      position: number;
      created_at: Date | string;
      updated_at: Date | string;
      usage_count: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      position: r.position,
      usageCount: r.usage_count,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  async createType(req: CreateAttachmentTypeRequest): Promise<AttachmentTypeDto> {
    const id = randomUUID();
    const t = await this.#audited('attachment_type.create', 'attachment_type', id, async (em) => {
      const created = em.create(AttachmentType, {
        id,
        code: req.code,
        name: req.name,
        ...(req.position !== undefined ? { position: req.position } : {}),
      });
      try {
        await em.flush();
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new HttpError(
            409,
            ERROR_CODES.ATTACHMENT_TYPE_CODE_TAKEN,
            `AttachmentType "${req.code}" already exists.`,
          );
        }
        throw err;
      }
      return { result: created, before: null, after: { code: created.code, name: created.name, position: created.position } };
    });
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      position: t.position,
      usageCount: 0,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async updateType(
    id: string,
    req: UpdateAttachmentTypeRequest,
  ): Promise<AttachmentTypeDto> {
    const t = await this.#audited('attachment_type.update', 'attachment_type', id, async (em) => {
      const row = await em.findOne(AttachmentType, { id });
      if (!row) {
        throw new HttpError(
          404,
          ERROR_CODES.ATTACHMENT_TYPE_NOT_FOUND,
          `AttachmentType ${id} not found.`,
        );
      }
      const before = { code: row.code, name: row.name, position: row.position };
      if (req.code !== undefined) row.code = req.code;
      if (req.name !== undefined) row.name = req.name;
      if (req.position !== undefined) row.position = req.position;
      try {
        await em.flush();
      } catch (err) {
        if (err instanceof UniqueConstraintViolationException) {
          throw new HttpError(
            409,
            ERROR_CODES.ATTACHMENT_TYPE_CODE_TAKEN,
            `AttachmentType "${req.code}" already exists.`,
          );
        }
        throw err;
      }
      return { result: row, before, after: { code: row.code, name: row.name, position: row.position } };
    });
    const usageCount = await this.#computeTypeUsage(this.emFactory(), id);
    return {
      id: t.id,
      code: t.code,
      name: t.name,
      position: t.position,
      usageCount,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  async deleteType(id: string): Promise<void> {
    await this.#audited('attachment_type.delete', 'attachment_type', id, async (em) => {
      const t = await em.findOne(AttachmentType, { id });
      if (!t) {
        throw new HttpError(
          404,
          ERROR_CODES.ATTACHMENT_TYPE_NOT_FOUND,
          `AttachmentType ${id} not found.`,
        );
      }
      const usageCount = await this.#computeTypeUsage(em, id);
      if (usageCount > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.ATTACHMENT_TYPE_IN_USE,
          `AttachmentType "${t.code}" is referenced by ${usageCount} attachment(s); reassign them first.`,
          [{ path: 'usageCount', issue: String(usageCount) }],
        );
      }
      const before = { code: t.code, name: t.name };
      em.remove(t);
      return { result: undefined, before, after: null };
    });
  }

  // -- Product Attachments --------------------------------------------------

  async listAttachments(productId: string): Promise<ProductAttachmentDto[]> {
    const em = this.emFactory();
    await this.#assertProductExists(em, productId);
    const items = await em.find(
      ProductAttachment,
      { productId },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    return items.map((i) => this.#attachmentDto(i));
  }

  async createAttachment(
    productId: string,
    req: CreateAttachmentRequest,
  ): Promise<ProductAttachmentDto> {
    const em = this.emFactory();
    await this.#assertProductExists(em, productId);

    const asset = await this.#requireAssets().findById(req.assetId);
    if (!asset) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Asset ${req.assetId} not found.`);
    }
    if (!ASSET_KINDS_ATTACHMENT.has(asset.kind)) {
      throw new HttpError(
        400,
        ERROR_CODES.ASSET_KIND_NOT_SUPPORTED,
        `Attachments require asset.kind ∈ {pdf, certificate, other}; got "${asset.kind}".`,
      );
    }

    const type = await em.findOne(AttachmentType, { id: req.attachmentTypeId });
    if (!type) {
      throw new HttpError(
        404,
        ERROR_CODES.ATTACHMENT_TYPE_NOT_FOUND,
        `AttachmentType ${req.attachmentTypeId} not found.`,
      );
    }

    const position = req.position ?? (await this.#nextPosition(em, productId));
    const id = randomUUID();
    const attachment = await this.#audited('product_attachment.create', 'product_attachment', id, async (cem) => {
      const created = cem.create(ProductAttachment, {
        id,
        productId,
        assetId: req.assetId,
        attachmentTypeId: req.attachmentTypeId,
        name: req.name,
        description: req.description ?? null,
        position,
      });
      await cem.flush();
      return {
        result: created,
        before: null,
        after: { productId, assetId: req.assetId, attachmentTypeId: req.attachmentTypeId, name: req.name, position },
      };
    });
    return this.#attachmentDto(attachment);
  }

  async updateAttachment(
    productId: string,
    attachmentId: string,
    req: UpdateAttachmentRequest,
  ): Promise<ProductAttachmentDto> {
    const a = await this.#audited('product_attachment.update', 'product_attachment', attachmentId, async (em) => {
      const row = await em.findOne(ProductAttachment, { id: attachmentId, productId });
      if (!row) {
        throw new HttpError(
          404,
          ERROR_CODES.ATTACHMENT_NOT_FOUND,
          `Attachment ${attachmentId} not found under Product ${productId}.`,
        );
      }
      const before = { attachmentTypeId: row.attachmentTypeId, name: row.name, position: row.position };
      if (req.attachmentTypeId !== undefined) {
        const type = await em.findOne(AttachmentType, { id: req.attachmentTypeId });
        if (!type) {
          throw new HttpError(
            404,
            ERROR_CODES.ATTACHMENT_TYPE_NOT_FOUND,
            `AttachmentType ${req.attachmentTypeId} not found.`,
          );
        }
        row.attachmentTypeId = req.attachmentTypeId;
      }
      if (req.name !== undefined) row.name = req.name;
      if (req.description !== undefined) row.description = req.description;
      if (req.position !== undefined) row.position = req.position;
      return {
        result: row,
        before,
        after: { attachmentTypeId: row.attachmentTypeId, name: row.name, position: row.position },
      };
    });
    return this.#attachmentDto(a);
  }

  async deleteAttachment(productId: string, attachmentId: string): Promise<void> {
    await this.#audited('product_attachment.delete', 'product_attachment', attachmentId, async (em) => {
      const a = await em.findOne(ProductAttachment, { id: attachmentId, productId });
      if (!a) {
        throw new HttpError(
          404,
          ERROR_CODES.ATTACHMENT_NOT_FOUND,
          `Attachment ${attachmentId} not found under Product ${productId}.`,
        );
      }
      const before = { productId, assetId: a.assetId };
      // Asset is FK RESTRICT; the row stays. Whoever uploaded it owns the
      // asset's lifecycle (research.md R-9).
      em.remove(a);
      return { result: undefined, before, after: null };
    });
  }

  // -- INTERNALS ------------------------------------------------------------

  async #assertProductExists(em: EntityManager, productId: string): Promise<void> {
    const product = await em.findOne(Product, { id: productId });
    if (!product) {
      throw new HttpError(
        404,
        ERROR_CODES.PRODUCT_NOT_FOUND,
        `Product ${productId} not found.`,
      );
    }
  }

  /**
   * `em.execute`, not `em.getConnection().execute`: the delete path calls this
   * on the Command's `em` to refuse a type that is still referenced, so read on
   * a pooled connection the guard answered from outside the transaction it is
   * guarding (issue #207).
   */
  async #computeTypeUsage(em: EntityManager, typeId: string): Promise<number> {
    const rows = (await em.execute(
      `select count(*)::int as n from product_attachments where attachment_type_id = ?`,
      [typeId],
    )) as Array<{ n: number }>;
    return rows[0]?.n ?? 0;
  }

  async #nextPosition(em: EntityManager, productId: string): Promise<number> {
    const rows = (await em.execute(
      `select coalesce(max(position), -1) + 1 as next_position from product_attachments where product_id = ?`,
      [productId],
    )) as Array<{ next_position: number }>;
    return rows[0]?.next_position ?? 0;
  }

  #attachmentDto(a: ProductAttachment): ProductAttachmentDto {
    return {
      id: a.id,
      productId: a.productId,
      assetId: a.assetId,
      attachmentTypeId: a.attachmentTypeId,
      name: a.name,
      description: a.description ?? null,
      position: a.position,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }
}
