import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ResolvedTax, type TaxResolutionInput } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
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
 *   - When no default exists either, the resolver returns
 *     `{ rate: 0, source: 'none' }`.
 */
export class TaxService {
  constructor(private readonly emFactory: () => EntityManager) {}

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
    await em.persistAndFlush(row);
    return row;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(Tax, { id });
    if (!row) return;
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
    return { rate: 0, taxId: null, source: 'none' };
  }
}

function specificity(t: Tax): number {
  let n = 0;
  if (t.country != null) n += 1;
  if (t.productType != null) n += 1;
  if (t.appliesToVatStatuses.length > 0) n += 1;
  return n;
}
