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

import { randomUUID } from 'node:crypto';
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
import type { CommandBus } from '../../../commands/index.js';
import { AttributeSet } from '../entities/attribute-set.entity.js';
import type {
  CatalogAttributeReadService,
  CatalogAttributeView,
} from './catalog-attribute-read.service.js';
import {
  assertCodeNotImmutable,
  assertNotInUse,
  AttributeSetValidationError,
} from './attribute-set-validations.js';

/** Result of an attribute-set write closure: the caller value + audit snapshot. */
interface AttributeSetWrite<T> {
  result: T;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  skipAudit?: boolean;
}

export class AttributeSetService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits attribute-set writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
    /**
     * Feature 061 — composed attribute read model. Set membership is stored by
     * definition id, but the API keeps accepting/returning attribute
     * (extension) ids — this service maps between the two at the boundary.
     */
    private readonly attributeRead?: CatalogAttributeReadService,
  ) {}

  #requireAttributeRead(): CatalogAttributeReadService {
    if (!this.attributeRead) {
      throw new Error(
        'AttributeSetService: CatalogAttributeReadService is not wired — attribute reads are unavailable.',
      );
    }
    return this.attributeRead;
  }

  /**
   * Feature 054 — run a write through the Command Bus (co-transactional audit)
   * or a plain forked em (bus-less tests). All raw SQL inside `write` MUST pass
   * `em.getTransactionContext()` so the bridge writes/reads join the command's
   * transaction (undefined in the bus-less path = the pre-054 pool behavior).
   */
  async #audited<T>(
    action: string,
    objectId: string,
    write: (em: EntityManager) => Promise<AttributeSetWrite<T>>,
  ): Promise<T> {
    if (this.commandBus) {
      return this.commandBus.run({
        action,
        objectType: 'attribute_set',
        objectId,
        run: async ({ em }) => {
          const w = await write(em);
          return {
            result: w.result,
            before: w.before,
            after: w.after,
            ...(w.skipAudit ? { skipAudit: true } : {}),
          };
        },
      });
    }
    const em = this.emFactory();
    const w = await write(em);
    await em.flush();
    return w.result;
  }

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
    // Validate the initial attribute ids exist BEFORE creating the set.
    // Input ids are attribute (extension) ids; membership persists definition ids.
    let initialAttributes: CatalogAttributeView[] = [];
    if (input.attributeIds && input.attributeIds.length > 0) {
      const all = await this.#requireAttributeRead().listAll();
      initialAttributes = input.attributeIds
        .map((id) => all.find((v) => v.id === id))
        .filter((v): v is CatalogAttributeView => v !== undefined);
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

    // The set create + its audit are co-transactional (Command Bus).
    const id = randomUUID();
    const set = await this.#audited('attribute_set.create', id, async (em) => {
      const created = em.create(AttributeSet, {
        id,
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
      });
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
      return {
        result: created,
        before: null,
        after: {
          code: created.code,
          name: created.name,
          description: created.description ?? null,
        },
      };
    });

    // Bridge assignments run AFTER the set commits (matches the pre-054
    // two-step): the set FK target now exists, and a set with no attributes is
    // a valid state — so a later failure orphans nothing.
    const em = this.emFactory();
    if (initialAttributes.length > 0) {
      await this.#insertAssignments(
        em,
        set.id,
        initialAttributes.map((a, idx) => ({
          definitionId: a.customFieldDefinitionId,
          position: idx,
        })),
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
    const set = await this.#audited('attribute_set.update', id, async (em) => {
      const s = await em.findOne(AttributeSet, { id });
      if (!s) {
        throw new HttpError(
          404,
          ERROR_CODES.ATTRIBUTE_SET_NOT_FOUND,
          `Attribute Set ${id} not found.`,
        );
      }
      // System set rule: `code` is immutable; `name` and `description` may
      // still be edited. The pure helper raises a typed error → HTTP 409.
      try {
        assertCodeNotImmutable({ isSystem: s.isSystem, code: s.code }, input.code);
      } catch (err) {
        if (err instanceof AttributeSetValidationError) {
          throw new HttpError(409, ERROR_CODES.SYSTEM_ATTRIBUTE_SET_IMMUTABLE, err.message);
        }
        throw err;
      }
      const before = { code: s.code, name: s.name, description: s.description ?? null };
      if (input.code !== undefined) s.code = input.code;
      if (input.name !== undefined) s.name = input.name;
      if (input.description !== undefined) s.description = input.description;
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
      return {
        result: s,
        before,
        after: { code: s.code, name: s.name, description: s.description ?? null },
      };
    });

    const counts = await this.#computeCounts(this.emFactory(), set.id);
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
    await this.#audited('attribute_set.delete', id, async (em) => {
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
      const before = { code: set.code, name: set.name };
      em.remove(set);
      return { result: undefined, before, after: null };
    });
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

    // Validate every attribute id exists. Input ids are attribute (extension)
    // ids; membership persists definition ids (feature 061).
    const attributeIds = input.assignments.map((a) => a.attributeId);
    const allViews = await this.#requireAttributeRead().listAll();
    const viewById = new Map(allViews.map((v) => [v.id, v]));
    const missing = attributeIds.filter((aid) => !viewById.has(aid));
    if (missing.length > 0) {
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
      const definitionId = viewById.get(a.attributeId)!.customFieldDefinitionId;
      if (a.position === undefined) {
        const pos = runningTail;
        runningTail += 1;
        return { definitionId, position: pos };
      }
      return { definitionId, position: a.position };
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
    // DELETE is idempotent — a missing assignment (or an unknown attribute id)
    // is a no-op (matches the "DELETE returns 204 even if it wasn't there"
    // REST convention). The URL carries the attribute (extension) id; the
    // bridge row is keyed by definition id (feature 061).
    const view = await this.#requireAttributeRead().getByIdOrKey(attributeId);
    if (!view) return;
    await conn.execute(
      `delete from attribute_set_attributes
       where attribute_set_id = ? and custom_field_definition_id = ?`,
      [id, view.customFieldDefinitionId],
    );
  }

  // -- INTERNAL HELPERS ------------------------------------------------------

  async #listAssignedAttributes(
    em: EntityManager,
    setId: string,
  ): Promise<AttributeSetAssignedAttributeDto[]> {
    const conn = em.getConnection();
    // Membership is definition-keyed (feature 061); the attribute identity —
    // extension id + key + label + legacy valueType — comes from the composed
    // view so the API keeps returning attribute (extension) ids.
    const rows = (await conn.execute(
      `select custom_field_definition_id, position
       from attribute_set_attributes
       where attribute_set_id = ?`,
      [setId],
    )) as Array<{ custom_field_definition_id: string; position: number }>;
    if (rows.length === 0) return [];
    const views = await this.#requireAttributeRead().listAll();
    const viewByDefinitionId = new Map(views.map((v) => [v.customFieldDefinitionId, v]));

    const assigned = rows
      .map((r) => {
        const view = viewByDefinitionId.get(r.custom_field_definition_id);
        if (!view) return undefined;
        return {
          id: view.id,
          key: view.key,
          label: view.label,
          valueType: view.valueType as AttributeSetAssignedAttributeDto['valueType'],
          position: r.position,
        };
      })
      .filter((a): a is AttributeSetAssignedAttributeDto => a !== undefined);
    assigned.sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
    return assigned;
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
    assignments: Array<{ definitionId: string; position: number }>,
  ): Promise<void> {
    if (assignments.length === 0) return;
    const conn = em.getConnection();
    const values = assignments.map(() => '(?, ?, ?)').join(', ');
    const params = assignments.flatMap((a) => [setId, a.definitionId, a.position]);
    await conn.execute(
      `insert into attribute_set_attributes (attribute_set_id, custom_field_definition_id, position) values ${values}
       on conflict (attribute_set_id, custom_field_definition_id) do update set position = excluded.position`,
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
