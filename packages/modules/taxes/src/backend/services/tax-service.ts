import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  dispatchValidatorMode,
  type DictionaryValidator,
  type ResolvedTax,
  type TaxResolutionInput,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { Tax } from '../entities/tax.entity.js';

/**
 * TaxService (T131 / FR-051).
 *
 * `taxRateFor({ country, productType, vatStatus })` returns the applicable
 * rate. Resolution rules:
 *   - A rule matches when each of its narrowing fields is either null
 *     (unconstrained) or equal to the corresponding input field.
 *   - Among matching rules, the one with the most narrowed fields wins.
 *   - Ties are broken by `priority` desc, then `createdAt` asc.
 *   - When no rule matches, the row with `isDefault=true` wins.
 *   - When no default exists either, the resolver returns `{ source: 'none' }` —
 *     an answer that carries no rate, because there is none to carry.
 *
 * The last line is the whole point of the union (issue #124). A configured 0%
 * rate comes back as `{ source: 'rule' | 'default', rate: 0 }` and prices an
 * order; "nothing is configured" comes back without a `rate` at all, so no
 * consumer can spend it as zero by accident. Absence of the module itself is
 * neither: the port gate refuses the resolution before it starts.
 */
export class TaxService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 005 / T027b — auto-bind newly-created Taxes to the system default. */
    private readonly salesChannelMembership?: SalesChannelMembershipPort,
    private readonly dictionaryValidator?: DictionaryValidator,
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(em: EntityManager, action: string, objectId: string, stateBefore: Record<string, unknown> | null, stateAfter: Record<string, unknown> | null): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, { action, objectType: 'tax', objectId, stateBefore, stateAfter });
    }
  }

  async list(): Promise<Tax[]> {
    return this.emFactory().find(Tax, {}, { orderBy: { priority: 'desc', code: 'asc' } });
  }

  async getById(id: string): Promise<Tax> {
    const row = await this.emFactory().findOne(Tax, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Tax ${id} not found.`);
    return row;
  }

  async upsertByCode(input: {
    code: string;
    name: string;
    rate: number;
    country?: string | null;
    productType?: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual' | null;
    appliesToVatStatuses?: Array<'vat_payer' | 'vat_exempt' | 'reverse_charge'>;
    isDefault?: boolean;
    priority?: number;
  }): Promise<Tax> {
    const em = this.emFactory();
    if (input.isDefault) {
      await em.getConnection().execute(
        `update taxes set is_default = false where is_default = true and code <> ?`,
        [input.code],
      );
    }
    const existing = await em.findOne(Tax, { code: input.code });
    if (input.country != null) {
      await this.validateCountry(
        input.country,
        existing
          ? dispatchValidatorMode(existing.country, input.country)
          : 'create-or-change',
      );
    }
    if (existing) {
      existing.name = input.name;
      existing.rate = String(input.rate);
      if (input.country !== undefined) existing.country = input.country;
      if (input.productType !== undefined) existing.productType = input.productType;
      if (input.appliesToVatStatuses !== undefined) {
        existing.appliesToVatStatuses = input.appliesToVatStatuses;
      }
      if (input.isDefault !== undefined) existing.isDefault = input.isDefault;
      if (input.priority !== undefined) existing.priority = input.priority;
      this.#audit(em, 'tax.upsert', existing.id, null, { code: existing.code, rate: existing.rate });
      await em.flush();
      return existing;
    }
    const row = em.create(Tax, {
      code: input.code,
      name: input.name,
      rate: String(input.rate),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.productType !== undefined ? { productType: input.productType } : {}),
      ...(input.appliesToVatStatuses !== undefined
        ? { appliesToVatStatuses: input.appliesToVatStatuses }
        : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    });
    em.persist(row);
    this.#audit(em, 'tax.upsert', row.id, null, { code: row.code, rate: row.rate });
    await em.flush();
    if (this.salesChannelMembership) {
      await this.salesChannelMembership.bindToDefaultIfEmpty('tax', row.id);
    }
    return row;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Tax, { id });
    if (!row) return;
    this.#audit(em, 'tax.delete', row.id, { code: row.code }, null);
    await em.removeAndFlush(row);
  }

  async taxRateFor(input: TaxResolutionInput): Promise<ResolvedTax> {
    const em = this.emFactory();
    const all = await em.find(Tax, {});
    const matching = all
      .filter((t) => !t.isDefault)
      .filter((t) => {
        if (t.country != null && t.country !== input.country) return false;
        if (t.productType != null && t.productType !== input.productType) return false;
        if (
          t.appliesToVatStatuses.length > 0 &&
          !t.appliesToVatStatuses.includes(input.vatStatus)
        ) {
          return false;
        }
        return true;
      });
    if (matching.length > 0) {
      matching.sort((a, b) => {
        const specA = specificity(a);
        const specB = specificity(b);
        if (specA !== specB) return specB - specA;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      const winner = matching[0]!;
      return { rate: Number(winner.rate), taxId: winner.id, source: 'rule' };
    }
    const defaultRule = all.find((t) => t.isDefault);
    if (defaultRule) {
      return { rate: Number(defaultRule.rate), taxId: defaultRule.id, source: 'default' };
    }
    return { source: 'none' };
  }

  private async validateCountry(
    country: string,
    mode: 'create-or-change' | 'unchanged',
  ): Promise<void> {
    if (!this.dictionaryValidator) return;
    try {
      await this.dictionaryValidator.validateCountryCode(country, mode);
    } catch (err) {
      if (err instanceof DictionaryReferenceError) {
        throw new HttpError(
          409,
          err.code,
          err.code === 'DICTIONARY_ENTRY_INACTIVE'
            ? `Country code ${err.entryCode} is no longer available for tax rules.`
            : `Country code ${err.entryCode} is not recognised.`,
          [{ path: 'country', issue: err.code }],
        );
      }
      throw err;
    }
  }
}

function specificity(t: Tax): number {
  let n = 0;
  if (t.country != null) n += 1;
  if (t.productType != null) n += 1;
  if (t.appliesToVatStatuses.length > 0) n += 1;
  return n;
}
