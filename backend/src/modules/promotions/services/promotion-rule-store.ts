import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type PromotionRule } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { PromotionRuleEntity } from '../entities/promotion-rule.entity.js';
import { Promotion } from '../entities/promotion.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';

/**
 * Feature 045 (US6) — CRUD for standalone, named promotion rules and the
 * dependency lookup used to surface / block deletion of in-use rules.
 */
export class PromotionRuleStore {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditLogService,
  ) {}

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'promotion_rule',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  async list(): Promise<PromotionRuleEntity[]> {
    return this.emFactory().find(PromotionRuleEntity, {}, { orderBy: { name: 'asc' } });
  }

  async getById(id: string): Promise<PromotionRuleEntity> {
    const row = await this.emFactory().findOne(PromotionRuleEntity, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Rule ${id} not found.`);
    return row;
  }

  /** Promotions referencing a named rule, for dependency surfacing (FR-019). */
  async usedBy(id: string): Promise<Array<{ id: string; name: string }>> {
    const rows = await this.emFactory().find(Promotion, { ruleId: id }, { fields: ['id', 'name'] });
    return rows.map((p) => ({ id: p.id, name: p.name }));
  }

  async create(input: { name: string; description?: string | null; definition: PromotionRule }): Promise<PromotionRuleEntity> {
    const em = this.emFactory();
    const existing = await em.findOne(PromotionRuleEntity, { name: input.name });
    if (existing) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, `rule_name_taken: ${input.name}`);
    }
    const row = em.create(PromotionRuleEntity, {
      name: input.name,
      description: input.description ?? null,
      definition: input.definition,
    });
    em.persist(row);
    this.#audit(em, 'promotion_rule.create', row.id, null, { name: row.name });
    await em.flush();
    return row;
  }

  async update(
    id: string,
    input: { name: string; description?: string | null; definition: PromotionRule },
  ): Promise<PromotionRuleEntity> {
    const em = this.emFactory();
    const row = await em.findOne(PromotionRuleEntity, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Rule ${id} not found.`);
    if (input.name !== row.name) {
      const clash = await em.findOne(PromotionRuleEntity, { name: input.name });
      if (clash) throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, `rule_name_taken: ${input.name}`);
    }
    row.name = input.name;
    row.description = input.description ?? null;
    row.definition = input.definition;
    this.#audit(em, 'promotion_rule.update', row.id, null, { name: row.name });
    await em.flush();
    return row;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(PromotionRuleEntity, { id });
    if (!row) return;
    const inUse = await this.usedBy(id);
    if (inUse.length > 0) {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        `rule_in_use: referenced by ${inUse.length} promotion(s)`,
      );
    }
    this.#audit(em, 'promotion_rule.delete', row.id, { name: row.name }, null);
    await em.removeAndFlush(row);
  }
}
