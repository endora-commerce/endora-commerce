import { raw, UniqueConstraintViolationException, type FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CreateOpportunityTagRequest,
  type OpportunityTag,
  type OpportunityTagRef,
  type UpdateOpportunityTagRequest,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { orgConstraintFor, type OrgConstraint } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CrmOpportunityTag } from '../entities/crm-opportunity-tag.entity.js';
import { CrmTag } from '../entities/crm-tag.entity.js';
import { isUuid } from './opportunity-access.js';

export interface TagServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
}

function tagNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Tag not found.');
}

function nameTaken(name: string): HttpError {
  return new HttpError(409, ERROR_CODES.CRM_TAG_NAME_TAKEN, `A tag named "${name}" already exists.`, { name });
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name);
}

function toRef(tag: CrmTag): OpportunityTagRef {
  return { id: tag.id, name: tag.name, color: tag.color };
}

/**
 * The statement behind a tag's usage count, confined to the Organizations its
 * reader reaches — raw SQL, which the entity filter never sees, so the tenant
 * predicate is written from the constraint the ambient context implies. `null`
 * for a reader who reaches no Organization: no statement is run.
 */
export function tagUsageQuery(scope: OrgConstraint): { sql: string; params: string[] } | null {
  const select =
    'select t."tag_id" as tag_id, count(*) as count from "crm_opportunity_tags" t ' +
    'join "crm_opportunities" o on o."id" = t."opportunity_id"';
  const groupBy = 'group by t."tag_id"';
  if (scope.kind === 'all') return { sql: `${select} ${groupBy}`, params: [] };
  const allowed =
    scope.kind === 'single'
      ? scope.organizationId === null
        ? []
        : [scope.organizationId]
      : [...scope.organizationIds];
  if (allowed.length === 0) return null;
  return {
    sql: `${select} where o."organization_id" in (${allowed.map(() => '?').join(', ')}) ${groupBy}`,
    params: allowed,
  };
}

/**
 * The tag list (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §8).
 *
 * **A tag is platform configuration** — one list, shared by everybody, managed
 * by whoever holds `crm:configure`. **What a tag is on is not**: a tagging is a
 * child of an Opportunity, written by `OpportunityService` under the
 * Opportunity it belongs to, and a tag's usage count is the number of
 * Opportunities carrying it *that the caller may see*.
 *
 * Every write is a Command recorded against `crm_tag` and the tag's id. Names
 * are unique whatever their case; the index is on `lower(name)`.
 */
export class TagService {
  constructor(private readonly deps: TagServiceDeps) {}

  async list(): Promise<OpportunityTag[]> {
    const em = this.deps.emFactory();
    const [tags, usage] = await Promise.all([em.find(CrmTag, {}), this.#usageCounts(em)]);
    return tags.sort(byName).map((tag) => ({ ...toRef(tag), usageCount: usage.get(tag.id) ?? 0 }));
  }

  async create(input: CreateOpportunityTagRequest): Promise<OpportunityTag> {
    const id = randomUUID();
    const tag = await this.#guardingTheName(input.name, () =>
      this.deps.commandBus.run({
        action: 'crm.tag.create',
        objectType: 'crm_tag',
        objectId: id,
        run: async ({ em }) => {
          await this.#assertNameFree(em, input.name, null);
          const created = em.create(CrmTag, {
            id,
            name: input.name,
            ...(input.color !== undefined ? { color: input.color } : {}),
          });
          return { result: toRef(created), before: null, after: { name: created.name, color: created.color } };
        },
      }),
    );
    return { ...tag, usageCount: 0 };
  }

  async update(id: string, patch: UpdateOpportunityTagRequest): Promise<OpportunityTag> {
    if (!isUuid(id)) throw tagNotFound();
    const tag = await this.#guardingTheName(patch.name ?? '', () =>
      this.deps.commandBus.run({
        action: 'crm.tag.update',
        objectType: 'crm_tag',
        objectId: id,
        run: async ({ em }) => {
          const existing = await em.findOne(CrmTag, { id });
          if (!existing) throw tagNotFound();
          const before = { name: existing.name, color: existing.color };
          if (patch.name !== undefined && patch.name !== existing.name) {
            await this.#assertNameFree(em, patch.name, existing.id);
            existing.name = patch.name;
          }
          if (patch.color !== undefined) existing.color = patch.color;
          return { result: toRef(existing), before, after: { name: existing.name, color: existing.color } };
        },
      }),
    );
    const usage = await this.#usageCounts(this.deps.emFactory());
    return { ...tag, usageCount: usage.get(tag.id) ?? 0 };
  }

  /**
   * Delete a tag. It comes off every Opportunity that carried it — in every
   * Organization, by the foreign key's cascade — and nothing else about those
   * Opportunities changes. The audit entry says how many that was.
   */
  async delete(id: string): Promise<void> {
    if (!isUuid(id)) throw tagNotFound();
    await this.deps.commandBus.run({
      action: 'crm.tag.delete',
      objectType: 'crm_tag',
      objectId: id,
      run: async ({ em }) => {
        const existing = await em.findOne(CrmTag, { id });
        if (!existing) throw tagNotFound();
        // Platform-wide, on purpose: the tag is leaving every Opportunity, not
        // only the ones the administrator deleting it can see.
        const usageCount = await em.count(CrmOpportunityTag, { tagId: id });
        const before = { name: existing.name, color: existing.color, usageCount };
        em.remove(existing);
        return { result: undefined, before, after: null };
      },
    });
  }

  /**
   * The tags named by `tagIds`, or 422 when one of them does not exist. Reads
   * on the EntityManager it is handed and writes nothing.
   */
  async resolve(em: EntityManager, tagIds: readonly string[]): Promise<CrmTag[]> {
    const ids = [...new Set(tagIds)];
    if (ids.length === 0) return [];
    const tags = await em.find(CrmTag, { id: { $in: ids } });
    if (tags.length !== ids.length) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'One of the tags does not exist.');
    }
    return tags.sort(byName);
  }

  /** The tags each of `opportunityIds` carries, by name. The caller has already scoped the ids. */
  async refsFor(em: EntityManager, opportunityIds: readonly string[]): Promise<Map<string, OpportunityTagRef[]>> {
    const refs = new Map<string, OpportunityTagRef[]>();
    if (opportunityIds.length === 0) return refs;
    const taggings = await em.find(CrmOpportunityTag, { opportunityId: { $in: [...opportunityIds] } });
    if (taggings.length === 0) return refs;
    const tags = await em.find(CrmTag, { id: { $in: [...new Set(taggings.map((tagging) => tagging.tagId))] } });
    const byId = new Map(tags.map((tag) => [tag.id, tag]));
    for (const tagging of taggings) {
      const tag = byId.get(tagging.tagId);
      if (!tag) continue;
      const list = refs.get(tagging.opportunityId) ?? [];
      list.push(toRef(tag));
      refs.set(tagging.opportunityId, list);
    }
    for (const list of refs.values()) list.sort(byName);
    return refs;
  }

  /**
   * "Carries **every** one of `tagIds`", as conditions on an Opportunity — one
   * `in (subquery)` per tag, so the database joins and no id is ever read into
   * the process or bound into a statement (research N-R10). They only narrow:
   * the tenant constraint is the scoped read's they are added to.
   */
  carryingEvery(tagIds: readonly string[]): FilterQuery<CrmOpportunity>[] {
    return [...new Set(tagIds)].map((tagId) => ({
      id: {
        $in: raw('(select t."opportunity_id" from "crm_opportunity_tags" t where t."tag_id" = ?)', [tagId]),
      },
    }));
  }

  async #assertNameFree(em: EntityManager, name: string, exceptId: string | null): Promise<void> {
    const rows = (await em.execute('select "id" from "crm_tags" where lower("name") = lower(?)', [name])) as Array<{
      id: string;
    }>;
    if (rows.some((row) => row.id !== exceptId)) throw nameTaken(name);
  }

  /**
   * Two requests for one name can both pass the check above; the unique index
   * refuses the second at commit. The Commands here read no other module's
   * port, so a unique violation can be nothing else.
   */
  async #guardingTheName<T>(name: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) throw nameTaken(name);
      throw error;
    }
  }

  async #usageCounts(em: EntityManager): Promise<Map<string, number>> {
    const query = tagUsageQuery(orgConstraintFor());
    if (query === null) return new Map();
    const rows = (await em.execute(query.sql, query.params)) as Array<{ tag_id: string; count: string }>;
    return new Map(rows.map((row) => [row.tag_id, Number(row.count)]));
  }
}
