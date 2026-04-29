/**
 * AttributeSetService — admin-only CRUD for Attribute Sets and their
 * relationship with Product Attributes.
 *
 * Stub: contracts/methods exist so contract tests (T009) and routing
 * scaffolding can compile. Implementation lands in T022.
 *
 * Pure validation helpers live in `./attribute-set-validations.ts` and are
 * unit-tested directly (T010); this class composes them with EM-bound
 * persistence operations (covered by integration tests T012).
 */

import type { EntityManager } from '@mikro-orm/postgresql';

import type {
  AttributeSet,
  AttributeSetDetail,
  CreateAttributeSetRequest,
  UpdateAttributeSetRequest,
  AssignAttributesRequest,
} from '@b2b/contracts';

export interface AttributeSetServiceDependencies {
  em: EntityManager;
}

export class AttributeSetService {
  constructor(private readonly deps: AttributeSetServiceDependencies) {}

  async listSets(): Promise<AttributeSet[]> {
    void this.deps;
    throw new Error('not implemented');
  }

  async getSetDetail(_id: string): Promise<AttributeSetDetail> {
    void this.deps;
    throw new Error('not implemented');
  }

  async createSet(_input: CreateAttributeSetRequest): Promise<AttributeSet> {
    void this.deps;
    throw new Error('not implemented');
  }

  async updateSet(
    _id: string,
    _input: UpdateAttributeSetRequest,
  ): Promise<AttributeSet> {
    void this.deps;
    throw new Error('not implemented');
  }

  async deleteSet(_id: string): Promise<void> {
    void this.deps;
    throw new Error('not implemented');
  }

  async assignAttributes(
    _id: string,
    _input: AssignAttributesRequest,
  ): Promise<AttributeSetDetail> {
    void this.deps;
    throw new Error('not implemented');
  }

  async unassignAttribute(_id: string, _attributeId: string): Promise<void> {
    void this.deps;
    throw new Error('not implemented');
  }
}
