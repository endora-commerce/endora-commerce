import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PAGE_BUILDER_CONTENT_MAX_BYTES,
  type AdminProductContent,
  type AdminProductContentLanguageStatus,
  type AdminProductContentList,
  type ProductContentEnvelope,
  uuidSchema,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';

import { updateProductContentCommand } from '../commands/product-content-commands.js';
import { Product } from '../entities/product.entity.js';
import { ProductContentValue } from '../entities/product-content-value.entity.js';
import type { CatalogAttributeView } from './catalog-attribute-read.service.js';
import {
  normalisePageBuilderEnvelope,
  pageBuilderEnvelopeBytes,
  type PageBuilderDocumentSummary,
  type PageBuilderEnvelope,
} from './page-builder-content.js';

/**
 * A product's Page Builder content attributes in the admin (feature 172,
 * `specs/172-product-content-attributes/` contracts/admin-api.md §4–§5,
 * research R-8, R-16).
 *
 * The content a product carries is the rows of `product_content_values` whose
 * attribute is a `page_builder` member of the product's **current** set. A row
 * whose attribute left the set is kept and invisible to every read here
 * (FR-061); a soft-deleted product's rows are kept and unreachable (FR-062,
 * OR-6). Not gated on the CMS: the card shows its status with the CMS off
 * (FR-050) — only the editing canvas is the CMS's.
 */

/** One `attribute_set_attributes` row, as the membership read answers it. */
export interface SetMemberRow {
  custom_field_definition_id: string;
  position: number;
}

/** A content attribute of the product's set. */
export interface ContentAttributeMember {
  /** `product_attributes.id`. */
  attributeId: string;
  key: string;
  label: Record<string, string>;
  labelDefault: string;
  position: number;
}

/**
 * The `page_builder` members of a set, by position then key (FR-020, FR-030).
 * Membership is definition-keyed (feature 061); the identity comes from the
 * composed attribute view.
 */
export function contentAttributeMembers(
  rows: readonly SetMemberRow[],
  views: readonly CatalogAttributeView[],
): ContentAttributeMember[] {
  const byDefinition = new Map(views.map((view) => [view.customFieldDefinitionId, view]));
  const members: ContentAttributeMember[] = [];
  for (const row of rows) {
    const view = byDefinition.get(row.custom_field_definition_id);
    if (!view || view.valueType !== 'page_builder') continue;
    members.push({
      attributeId: view.id,
      key: view.key,
      label: view.label,
      labelDefault: view.labelDefault,
      position: row.position,
    });
  }
  return members.sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
}

/** The stored languages of one value, as the card shows them — never the document. */
export function languageStatuses(
  summary: Readonly<Record<string, PageBuilderDocumentSummary>> | undefined,
): AdminProductContentLanguageStatus[] {
  return Object.entries(summary ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, entry]) => ({ language, filled: true, blocks: entry.blocks, excerpt: entry.excerpt }));
}

/** The attribute read this service needs — the composed view of every product attribute. */
export interface ProductContentAttributeRead {
  listAll(): Promise<CatalogAttributeView[]>;
}

export class ProductContentService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly commandBus: CommandBus,
    private readonly attributeRead: ProductContentAttributeRead,
  ) {}

  /** `GET …/products/:id/content` — the cards: summaries only (research R-3). */
  async list(productId: string): Promise<AdminProductContentList> {
    const em = this.emFactory();
    const product = await this.#product(em, productId);
    const members = await this.#members(em, product.attributeSetId);
    const rows =
      members.length === 0
        ? []
        : await em.find(ProductContentValue, {
            productId,
            productAttributeId: { $in: members.map((member) => member.attributeId) },
          });
    const summaryByAttribute = new Map(rows.map((row) => [row.productAttributeId, row.summary]));
    return {
      productId,
      attributeSetId: product.attributeSetId,
      attributes: members.map((member) => ({
        ...member,
        languages: languageStatuses(summaryByAttribute.get(member.attributeId)),
      })),
    };
  }

  /** `GET …/products/:id/content/:attributeKey` — one envelope, `null` when none is stored. */
  async get(productId: string, attributeKey: string): Promise<AdminProductContent> {
    const em = this.emFactory();
    const product = await this.#product(em, productId);
    const member = (await this.#members(em, product.attributeSetId)).find((m) => m.key === attributeKey);
    if (!member) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `"${attributeKey}" is not a Page Builder content attribute of this product's attribute set.`,
      );
    }
    const row = await em.findOne(
      ProductContentValue,
      { productId, productAttributeId: member.attributeId },
      { populate: ['content'] },
    );
    return { productId, attributeKey, content: row?.content ?? null };
  }

  /**
   * `PUT …/products/:id/content/:attributeKey` — replace one value: normalise
   * (FR-013), hold to the ceiling (FR-012), and write through the audited
   * Command `product.content.update`. `null`, or no language with a block,
   * removes the value.
   */
  async replace(
    productId: string,
    attributeKey: string,
    content: ProductContentEnvelope,
  ): Promise<AdminProductContent> {
    const em = this.emFactory();
    const product = await this.#product(em, productId);
    const member = (await this.#members(em, product.attributeSetId)).find((m) => m.key === attributeKey);
    if (!member) {
      throw new HttpError(
        400,
        ERROR_CODES.ATTRIBUTE_VALUE_REJECTED,
        `"${attributeKey}" is not a Page Builder content attribute of this product's attribute set.`,
        [{ path: 'attributeKey', issue: "not a Page Builder content attribute of this product's attribute set" }],
      );
    }
    const normalised = normalisePageBuilderEnvelope(content as PageBuilderEnvelope | null);
    // The route's schema already holds the ceiling; a caller that does not
    // arrive over HTTP is held to it here.
    if (normalised !== null && pageBuilderEnvelopeBytes(normalised) > PAGE_BUILDER_CONTENT_MAX_BYTES) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        `Product content must not exceed ${PAGE_BUILDER_CONTENT_MAX_BYTES} bytes.`,
      );
    }
    const stored = await this.commandBus.run(
      updateProductContentCommand({
        productId,
        productAttributeId: member.attributeId,
        attributeKey,
        content: normalised,
      }),
    );
    return { productId, attributeKey, content: stored };
  }

  async #product(em: EntityManager, productId: string): Promise<Pick<Product, 'id' | 'attributeSetId'>> {
    // An id that is not a uuid names no product; it must not reach the query.
    if (!uuidSchema.safeParse(productId).success) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    const product = await em.findOne(Product, { id: productId, deletedAt: null }, { fields: ['id', 'attributeSetId'] });
    if (!product) throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    return product;
  }

  async #members(em: EntityManager, attributeSetId: string): Promise<ContentAttributeMember[]> {
    const rows = (await em.execute(
      `select custom_field_definition_id, position from attribute_set_attributes where attribute_set_id = ?`,
      [attributeSetId],
    )) as SetMemberRow[];
    if (rows.length === 0) return [];
    return contentAttributeMembers(rows, await this.attributeRead.listAll());
  }
}
