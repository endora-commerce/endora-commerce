/**
 * AttributeSetService — admin-only CRUD for Attribute Sets and their
 * relationship with Product Attributes (feature 002,
 * data-model.md §2.1, §2.2; contracts/catalog-002.contract.md).
 *
 * Composition pattern matches `category-admin.service.ts`:
 *   - constructor takes `emFactory: () => EntityManager`,
 *   - each call forks a fresh EM,
 *   - returns DTOs (matching the published Zod schemas) so route handlers
 *     are a thin wrapper.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';

import {
  ERROR_CODES,
  type AttributeSet as AttributeSetDto,
  type AttributeSetDetail as AttributeSetDetailDto,
  type AttributeSetAssignedAttribute as AttributeSetAssignedAttributeDto,
  type CreateAttributeSetRequest,
  type UpdateAttributeSetRequest,
  type AssignAttributesRequest,
} from '@b2b/contracts';

import { HttpError } from '../../../http/error-envelope.js';
import { AttributeSet } from '../entities/attribute-set.entity.js';
import { ProductAttribute } from '../entities/product-attribute.entity.js';
import {
  assertCodeNotImmutable,
  assertNotInUse,
  AttributeSetValidationError,
} from './attribute-set-validations.js';

export class AttributeSetService {
  constructor(private readonly emFactory: () => EntityManager) {}

  // -- READ ------------------------------------------------------------------

  async listSets(): Promise<AttributeSetDto[]> {
    const em = this.emFactory();
    const conn = em.getConnection();
    const rows = (await conn.execute(
      `select
         s.id,
         s.code,
         s.name,
         s.description,
         s.is_system,
         s.created_at,
         s.updated_at,
         (select count(*)::int from attribute_set_attributes a where a.attribute_set_id = s.id) as attribute_count,
         (select count(*)::int from products p where p.attribute_set_id = s.id) as product_count
       from attribute_sets s
       order by s.is_system desc, s.code asc`,
    )) as Array<{
      id: string;
      code: string;
      name: Record<string, string>;
      description: Record<string, string> | null;
      is_system: boolean;
      created_at: Date | string;
      updated_at: Date | string;
      attribute_count: number;
      product_count: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      isSystem: r.is_system,
      attributeCount: r.attribute_count,
      productCount: r.product_count,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  async getSetDetail(id: string): Promise<AttributeSetDetailDto> {
    const em = this.emFactory();
    const set = await em.findOne(AttributeSet, { id });
    if (!set) {
      throw new HttpError(
        404,
        ERROR_CODES.ATTRIBUTE_SET_NOT_FOUND,
        `Attribute Set ${id} not found.`,
      );
    }

    const attrs = await this.#listAssignedAttributes(em, id);
    const counts = await this.#computeCounts(em, id);

    return this.#toDetailDto(set, attrs, counts);
  }

  // -- WRITE -----------------------------------------------------------------

  async createSet(input: CreateAttributeSetRequest): Promise<AttributeSetDetailDto> {
    const em = this.emFactory();

    // If the caller provided an initial attribute set, validate the IDs
    // exist BEFORE we insert the new set — keeps the operation atomic
    // even though we flush twice (set, then bridge rows).
    let initialAttributes: ProductAttribute[] = [];
    if (input.attributeIds && input.attributeIds.length > 0) {
      initialAttributes = await em.find(ProductAttribute, {
        id: { $in: input.attributeIds },
      });
      if (initialAttributes.length !== input.attributeIds.length) {
        const found = new Set(initialAttributes.map((a) => a.id));
        const missing = input.attributeIds.filter((id) => !found.has(id));
        throw new HttpError(
          404,
          ERROR_CODES.ATTRIBUTE_NOT_FOUND,
          `Attribute(s) not found: ${missing.join(', ')}.`,
        );
      }
    }

    const set = em.create(AttributeSet, {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      isSystem: false,
    });

    try {
      await em.persistAndFlush(set);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.ATTRIBUTE_SET_CODE_TAKEN,
          `Attribute Set with code "${input.code}" already exists.`,
        );
      }
      throw err;
    }

    if (initialAttributes.length > 0) {
      await this.#insertAssignments(
        em,
        set.id,
        initialAttributes.map((a, idx) => ({ attributeId: a.id, position: idx })),
      );
    }

    const attrs = await this.#listAssignedAttributes(em, set.id);
    const counts = await this.#computeCounts(em, set.id);
    return this.#toDetailDto(set, attrs, counts);
  }

  async updateSet(
    id: string,
    input: UpdateAttributeSetRequest,
  ): Promise<AttributeSetDto> {
    const em = this.emFactory();
    const set = await em.findOne(AttributeSet, { id });
    if (!set) {
      throw new HttpError(
        404,
        ERROR_CODES.ATTRIBUTE_SET_NOT_FOUND,
        `Attribute Set ${id} not found.`,
      );
    }

    // System set rule: `code` is immutable; `name` and `description` may
    // still be edited. The pure helper raises a typed error which we map
    // to HTTP 409.
    try {
      assertCodeNotImmutable({ isSystem: set.isSystem, code: set.code }, input.code);
    } catch (err) {
      if (err instanceof AttributeSetValidationError) {
        throw new HttpError(409, ERROR_CODES.SYSTEM_ATTRIBUTE_SET_IMMUTABLE, err.message);
      }
      throw err;
    }

    if (input.code !== undefined) set.code = input.code;
    if (input.name !== undefined) set.name = input.name;
    if (input.description !== undefined) set.description = input.description;

    try {
      await em.flush();
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.ATTRIBUTE_SET_CODE_TAKEN,
          `Attribute Set with code "${input.code}" already exists.`,
        );
      }
      throw err;
    }

    const counts = await this.#computeCounts(em, set.id);
    return {
      id: set.id,
      code: set.code,
      name: set.name,
      description: set.description ?? null,
      isSystem: set.isSystem,
      attributeCount: counts.attributeCount,
      productCount: counts.productCount,
      createdAt: set.createdAt.toISOString(),
      updatedAt: set.updatedAt.toISOString(),
    };
  }

  async deleteSet(id: string): Promise<void> {
    const em = this.emFactory();
    const set = await em.findOne(AttributeSet, { id });
    if (!set) {
      throw new HttpError(
        404,
        ERROR_CODES.ATTRIBUTE_SET_NOT_FOUND,
        `Attribute Set ${id} not found.`,
      );
    }

    // The system Default set is never deletable, even when nothing
    // references it (the contract test expects this branch precedence
    // — see specs/002-catalog-module/contracts/catalog-002.contract.md).
    if (set.isSystem) {
      throw new HttpError(
        409,
        ERROR_CODES.SYSTEM_ATTRIBUTE_SET_IMMUTABLE,
        `Attribute Set "${set.code}" is systemic and cannot be deleted.`,
      );
    }

    const { productCount } = await this.#computeCounts(em, id);
    try {
      assertNotInUse(productCount);
    } catch (err) {
      if (err instanceof AttributeSetValidationError) {
        throw new HttpError(409, ERROR_CODES.ATTRIBUTE_SET_IN_USE, err.message, [
          { path: 'productCount', issue: String(productCount) },
        ]);
      }
      throw err;
    }

    await em.removeAndFlush(set);
  }

  async assignAttributes(
    id: string,
    input: AssignAttributesRequest,
  ): Promise<AttributeSetDetailDto> {
    const em = this.emFactory();
    const set = await em.findOne(AttributeSet, { id });
    if (!set) {
      throw new HttpError(
        404,
        ERROR_CODES.ATTRIBUTE_SET_NOT_FOUND,
        `Attribute Set ${id} not found.`,
      );
    }

    // Validate every attribute id exists (single round-trip query).
    const attributeIds = input.assignments.map((a) => a.attributeId);
    const found = await em.find(ProductAttribute, { id: { $in: attributeIds } });
    if (found.length !== attributeIds.length) {
      const foundIds = new Set(found.map((a) => a.id));
      const missing = attributeIds.filter((aid) => !foundIds.has(aid));
      throw new HttpError(
        404,
        ERROR_CODES.ATTRIBUTE_NOT_FOUND,
        `Attribute(s) not found: ${missing.join(', ')}.`,
      );
    }

    // Default position when omitted: append at the end of the current
    // assignments. We compute the next-position once per call rather
    // than per-assignment to avoid a roundtrip per row.
    const conn = em.getConnection();
    const rows = (await conn.execute(
      `select coalesce(max(position), -1) + 1 as next_position
       from attribute_set_attributes where attribute_set_id = ?`,
      [id],
    )) as Array<{ next_position: number }>;
    let runningTail = rows[0]?.next_position ?? 0;
    const resolved = input.assignments.map((a) => {
      if (a.position === undefined) {
        const pos = runningTail;
        runningTail += 1;
        return { attributeId: a.attributeId, position: pos };
      }
      return { attributeId: a.attributeId, position: a.position };
    });

    await this.#insertAssignments(em, id, resolved);

    const attrs = await this.#listAssignedAttributes(em, id);
    const counts = await this.#computeCounts(em, id);
    return this.#toDetailDto(set, attrs, counts);
  }

  async unassignAttribute(id: string, attributeId: string): Promise<void> {
    const em = this.emFactory();
    const set = await em.findOne(AttributeSet, { id });
    if (!set) {
      throw new HttpError(
        404,
        ERROR_CODES.ATTRIBUTE_SET_NOT_FOUND,
        `Attribute Set ${id} not found.`,
      );
    }
    const conn = em.getConnection();
    // DELETE is idempotent — a missing assignment is a no-op (matches
    // the "DELETE returns 204 even if it wasn't there" REST convention).
    await conn.execute(
      `delete from attribute_set_attributes
       where attribute_set_id = ? and product_attribute_id = ?`,
      [id, attributeId],
    );
  }

  // -- INTERNAL HELPERS ------------------------------------------------------

  async #listAssignedAttributes(
    em: EntityManager,
    setId: string,
  ): Promise<AttributeSetAssignedAttributeDto[]> {
    const conn = em.getConnection();
    const rows = (await conn.execute(
      `select pa.id, pa.key, pa.label, pa.value_type, pa.display_as_slider, asa.position
       from attribute_set_attributes asa
       join product_attributes pa on pa.id = asa.product_attribute_id
       where asa.attribute_set_id = ?
       order by asa.position asc, pa.key asc`,
      [setId],
    )) as Array<{
      id: string;
      key: string;
      label: Record<string, string>;
      value_type: string;
      display_as_slider: boolean;
      position: number;
    }>;

    // The contract exposes the DB value type for Attribute-Set-attached
    // attributes (consumers care about validation shape, not the API
    // affordance). Admin UI calls `dbTypeToApi` separately when building
    // the editor form for a single attribute.
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      valueType: r.value_type as AttributeSetAssignedAttributeDto['valueType'],
      position: r.position,
    }));
  }

  async #computeCounts(
    em: EntityManager,
    setId: string,
  ): Promise<{ attributeCount: number; productCount: number }> {
    const conn = em.getConnection();
    const [row] = (await conn.execute(
      `select
         (select count(*)::int from attribute_set_attributes where attribute_set_id = ?) as attribute_count,
         (select count(*)::int from products where attribute_set_id = ?) as product_count`,
      [setId, setId],
    )) as Array<{ attribute_count: number; product_count: number }>;
    return {
      attributeCount: row?.attribute_count ?? 0,
      productCount: row?.product_count ?? 0,
    };
  }

  async #insertAssignments(
    em: EntityManager,
    setId: string,
    assignments: Array<{ attributeId: string; position: number }>,
  ): Promise<void> {
    if (assignments.length === 0) return;
    const conn = em.getConnection();
    const values = assignments.map(() => '(?, ?, ?)').join(', ');
    const params = assignments.flatMap((a) => [setId, a.attributeId, a.position]);
    await conn.execute(
      `insert into attribute_set_attributes (attribute_set_id, product_attribute_id, position) values ${values}
       on conflict (attribute_set_id, product_attribute_id) do update set position = excluded.position`,
      params,
    );
  }

  #toDetailDto(
    set: AttributeSet,
    attributes: AttributeSetAssignedAttributeDto[],
    counts: { attributeCount: number; productCount: number },
  ): AttributeSetDetailDto {
    return {
      id: set.id,
      code: set.code,
      name: set.name,
      description: set.description ?? null,
      isSystem: set.isSystem,
      attributeCount: counts.attributeCount,
      productCount: counts.productCount,
      createdAt: set.createdAt.toISOString(),
      updatedAt: set.updatedAt.toISOString(),
      attributes,
    };
  }

  // Validations are kept in their pure module so they're unit-testable
  // without an EM; the service layer simply re-exports them so callers
  // can invoke them in custom flows.
  static readonly validations = {
    assertCodeNotImmutable,
    assertNotInUse,
    isValidationError: (err: unknown): err is AttributeSetValidationError =>
      err instanceof AttributeSetValidationError,
  };
}
