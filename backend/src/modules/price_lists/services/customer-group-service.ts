import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { CustomerGroup } from '../entities/customer-group.entity.js';

export class CustomerGroupService {
  constructor(private readonly emFactory: () => EntityManager) {}

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
    const em = this.emFactory();
    const existing = await em.findOne(CustomerGroup, { code: input.code });
    if (existing) {
      existing.name = input.name;
      if (input.description !== undefined) existing.description = input.description ?? null;
      await em.flush();
      return existing;
    }
    const row = em.create(CustomerGroup, {
      code: input.code,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
    });
    await em.persistAndFlush(row);
    return row;
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(CustomerGroup, { id });
    if (!row) return;
    await em.removeAndFlush(row);
  }
}
