import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { Command, CommandBus } from '../../../commands/index.js';
import { CustomerGroup } from '../entities/customer-group.entity.js';

export class CustomerGroupService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Feature 054 — audits customer-group writes co-transactionally when provided. */
    private readonly commandBus?: CommandBus,
  ) {}

  async list(): Promise<CustomerGroup[]> {
    return this.emFactory().find(CustomerGroup, {}, { orderBy: { code: 'asc' } });
  }

  async getById(id: string): Promise<CustomerGroup> {
    const row = await this.emFactory().findOne(CustomerGroup, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Customer group ${id} not found.`);
    return row;
  }

  async upsertByCode(input: {
    code: string;
    name: string;
    description?: string | null | undefined;
  }): Promise<CustomerGroup> {
    if (this.commandBus) return this.commandBus.run(this.#upsertCommand(input));
    const em = this.emFactory();
    const r = await this.#applyUpsert(em, input);
    await em.flush();
    return r.row;
  }

  #upsertCommand(input: {
    code: string;
    name: string;
    description?: string | null | undefined;
  }): Command<CustomerGroup> {
    return {
      action: 'customer_group.upsert',
      objectType: 'customer_group',
      objectId: input.code,
      run: async ({ em }) => {
        const r = await this.#applyUpsert(em, input);
        return { result: r.row, before: r.before, after: r.after };
      },
    };
  }

  /** Pure upsert on the given em — no flush, no audit. */
  async #applyUpsert(
    em: EntityManager,
    input: { code: string; name: string; description?: string | null | undefined },
  ): Promise<{
    row: CustomerGroup;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
  }> {
    const existing = await em.findOne(CustomerGroup, { code: input.code });
    if (existing) {
      const before = {
        code: existing.code,
        name: existing.name,
        description: existing.description ?? null,
      };
      existing.name = input.name;
      if (input.description !== undefined) existing.description = input.description ?? null;
      return {
        row: existing,
        before,
        after: { code: existing.code, name: existing.name, description: existing.description ?? null },
      };
    }
    const row = em.create(CustomerGroup, {
      code: input.code,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    });
    return {
      row,
      before: null,
      after: { code: row.code, name: row.name, description: row.description ?? null },
    };
  }

  async remove(id: string): Promise<void> {
    if (this.commandBus) {
      await this.commandBus.run(this.#removeCommand(id));
      return;
    }
    const em = this.emFactory();
    const row = await em.findOne(CustomerGroup, { id });
    if (!row) return;
    await em.removeAndFlush(row);
  }

  #removeCommand(id: string): Command<void> {
    return {
      action: 'customer_group.delete',
      objectType: 'customer_group',
      objectId: id,
      run: async ({ em }) => {
        const row = await em.findOne(CustomerGroup, { id });
        if (!row) return { result: undefined, skipAudit: true };
        const before = { code: row.code, name: row.name };
        em.remove(row);
        return { result: undefined, before, after: null };
      },
    };
  }
}
