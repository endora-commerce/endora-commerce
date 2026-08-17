import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldDefinitionRecord,
  CustomFieldOptionDto,
  CustomFieldOptionRecord,
  SupportedEntityType,
  UpdateCustomFieldDefinitionRequest,
} from '@b2b/contracts';
import type { CommandBus } from '../../../commands/index.js';
import { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../entities/custom-field-option.entity.js';
import { isSupportedEntityType } from './custom-field-registry.js';
import type {
  CustomFieldDefinitionsCache,
  CachedDefinition,
} from './custom-field-definitions-cache.js';
import {
  createDefinitionCommand,
  createOptionCommand,
  deleteDefinitionCommand,
  deleteOptionCommand,
  updateDefinitionCommand,
  updateOptionCommand,
} from '../commands/definition-commands.js';
import {
  applyCreateDefinition,
  applyCreateOption,
  applyDeleteDefinition,
  applyDeleteOption,
  applyUpdateDefinition,
  applyUpdateOption,
  assertOptionsRule,
  CustomFieldDefinitionError,
} from './custom-field-definition-apply.js';
import {
  toCustomFieldDefinitionRecord,
  toCustomFieldOptionRecord,
} from './custom-field-read-port.js';
import type { CustomFieldValueService } from './custom-field-value.service.js';
import type { DefinitionSource } from './custom-field-value.service.js';

// Feature 061 — the error class moved next to the shared apply functions;
// re-exported here so existing imports keep working.
export { CustomFieldDefinitionError };

const SELECT_TYPES = new Set(['select', 'multiselect']);

/**
 * Transactional apply seam for host modules (feature 061,
 * contracts/custom-fields-product-host.md §3). Every `apply*` call runs inside
 * the CALLER's transactional EM (a host Command's `run({ em })`), performs the
 * same invariants as the public CRUD, and does NO command dispatch, NO audit
 * (the host command audits the composite operation), and NO cache publish.
 * The caller MUST invoke `publishInvalidate(entityType)` after its transaction
 * commits.
 *
 * **Which transaction it runs in, said on this side too** (D-77). The caller's:
 * a host Command's `run({ em })`, the same `EntityManager` the host writes its
 * own row on. That is not a convenience — `fk_product_attributes_custom_field_definition`
 * is `on delete restrict` with a `unique` on the same column, so the child
 * insert must see its parent inside one transaction, and a second transaction
 * cannot satisfy a foreign key against a row it cannot see. The seam is
 * therefore permanent, declared, and named on both sides; what would retire it
 * is F4's package entry points, or dropping the constraint.
 *
 * **The returns are published records, not live entities** (D-77's first
 * narrowing). A host reads `id`, `sortOrder`, `labelDefault` and the rest off
 * what comes back; handing it a managed entity also handed it the ability to
 * mutate a definition outside the seam, and the ability to persist that change
 * on the transaction it happens to be holding.
 */
export interface CustomFieldDefinitionApplyApi {
  applyCreate(
    em: EntityManager,
    input: CreateCustomFieldDefinitionRequest,
  ): Promise<CustomFieldDefinitionRecord>;
  applyUpdate(
    em: EntityManager,
    id: string,
    patch: UpdateCustomFieldDefinitionRequest,
  ): Promise<CustomFieldDefinitionRecord>;
  applyDelete(em: EntityManager, id: string): Promise<void>;
  applyCreateOption(
    em: EntityManager,
    definitionId: string,
    input: CustomFieldOptionDto,
  ): Promise<CustomFieldOptionRecord>;
  applyUpdateOption(
    em: EntityManager,
    definitionId: string,
    optionId: string,
    patch: Partial<Pick<CustomFieldOptionDto, 'label' | 'labelDefault' | 'isDefault' | 'sortOrder'>>,
  ): Promise<CustomFieldOptionRecord>;
  applyDeleteOption(em: EntityManager, definitionId: string, optionId: string): Promise<void>;
  /** Post-commit responsibility of the caller. */
  publishInvalidate(entityType: SupportedEntityType): Promise<void>;
}

/**
 * CustomFieldDefinitionService (feature 055) — CRUD over definitions and options.
 *
 * All mutations run through the Command Bus (Principle XIII); the bus writes the
 * audit entry, so this service never calls the audit writer by hand. Reads are
 * served from the per-`entityType` cache and every committed mutation publishes a
 * cross-process invalidation. Implements {@link DefinitionSource} so the value
 * service can validate host writes against the live definitions, and
 * {@link CustomFieldDefinitionApplyApi} so host modules can mutate definitions
 * co-transactionally with their own data (feature 061).
 */
export class CustomFieldDefinitionService implements DefinitionSource, CustomFieldDefinitionApplyApi {
  /** Set post-construction to break the definition⇄value service cycle (used by change guards). */
  private valueService?: CustomFieldValueService;

  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cache: CustomFieldDefinitionsCache,
    private readonly commandBus: CommandBus,
  ) {}

  setValueService(v: CustomFieldValueService): void {
    this.valueService = v;
  }

  // ---- Reads --------------------------------------------------------------

  /** Live definitions (with options) for one entity type, cached per type. */
  async listForEntity(entityType: SupportedEntityType): Promise<CachedDefinition[]> {
    if (!isSupportedEntityType(entityType)) return [];
    return this.cache.getForEntity(entityType, () => this.loadForEntity(entityType));
  }

  private async loadForEntity(entityType: SupportedEntityType): Promise<CachedDefinition[]> {
    const em = this.emFactory();
    const definitions = await em.find(
      CustomFieldDefinition,
      { entityType },
      { orderBy: { sortOrder: 'asc', key: 'asc' } },
    );
    if (definitions.length === 0) return [];
    const options = await em.find(
      CustomFieldOption,
      { definitionId: { $in: definitions.map((d) => d.id) } },
      { orderBy: { sortOrder: 'asc' } },
    );
    const byDef = new Map<string, CustomFieldOption[]>();
    for (const o of options) {
      const list = byDef.get(o.definitionId) ?? [];
      list.push(o);
      byDef.set(o.definitionId, list);
    }
    return definitions.map((definition) => ({
      definition,
      options: byDef.get(definition.id) ?? [],
    }));
  }

  /** All definitions across every (or one) entity type, options embedded. */
  async listAll(entityType?: SupportedEntityType): Promise<CachedDefinition[]> {
    if (entityType) return this.listForEntity(entityType);
    const em = this.emFactory();
    const definitions = await em.find(
      CustomFieldDefinition,
      {},
      { orderBy: { entityType: 'asc', sortOrder: 'asc', key: 'asc' } },
    );
    const options = await em.find(CustomFieldOption, {}, { orderBy: { sortOrder: 'asc' } });
    const byDef = new Map<string, CustomFieldOption[]>();
    for (const o of options) {
      const list = byDef.get(o.definitionId) ?? [];
      list.push(o);
      byDef.set(o.definitionId, list);
    }
    return definitions.map((definition) => ({ definition, options: byDef.get(definition.id) ?? [] }));
  }

  async getById(id: string): Promise<CachedDefinition | null> {
    const em = this.emFactory();
    const definition = await em.findOne(CustomFieldDefinition, { id });
    if (!definition) return null;
    const options = await em.find(
      CustomFieldOption,
      { definitionId: id },
      { orderBy: { sortOrder: 'asc' } },
    );
    return { definition, options };
  }

  // ---- Mutations (via Command Bus) ----------------------------------------

  async create(input: CreateCustomFieldDefinitionRequest): Promise<CustomFieldDefinition> {
    if (!isSupportedEntityType(input.entityType)) {
      throw new CustomFieldDefinitionError('entity_type_unknown', `Unknown entity type "${input.entityType}".`);
    }
    assertOptionsRule(input.valueType, input.options);
    const existing = await this.emFactory().findOne(CustomFieldDefinition, {
      entityType: input.entityType,
      key: input.key,
    });
    if (existing) {
      throw new CustomFieldDefinitionError('duplicate_key', `A field "${input.key}" already exists on ${input.entityType}.`);
    }
    const def = await this.commandBus.run(createDefinitionCommand(input));
    await this.cache.publishInvalidate(input.entityType);
    return def;
  }

  async update(id: string, patch: UpdateCustomFieldDefinitionRequest): Promise<CustomFieldDefinition> {
    const current = await this.emFactory().findOne(CustomFieldDefinition, { id });
    if (!current) throw new CustomFieldDefinitionError('not_found', `Custom field ${id} not found.`);

    // FR-010: changing valueType while values exist is rejected.
    if (patch.valueType !== undefined && patch.valueType !== current.valueType && this.valueService) {
      const inUse = await this.valueService.hasStoredValues(this.emFactory(), current.entityType, current.key);
      if (inUse) {
        throw new CustomFieldDefinitionError(
          'value_type_locked',
          `Cannot change the value type of "${current.key}" while records hold values. Clear them first.`,
        );
      }
    }
    const def = await this.commandBus.run(updateDefinitionCommand(id, patch, this.valueService));
    await this.cache.publishInvalidate(current.entityType);
    return def;
  }

  async delete(id: string): Promise<void> {
    const current = await this.emFactory().findOne(CustomFieldDefinition, { id });
    if (!current) throw new CustomFieldDefinitionError('not_found', `Custom field ${id} not found.`);
    await this.commandBus.run(deleteDefinitionCommand(id));
    await this.cache.publishInvalidate(current.entityType);
  }

  async createOption(definitionId: string, input: CustomFieldOptionDto): Promise<CustomFieldOption> {
    const def = await this.emFactory().findOne(CustomFieldDefinition, { id: definitionId });
    if (!def) throw new CustomFieldDefinitionError('not_found', `Custom field ${definitionId} not found.`);
    if (!SELECT_TYPES.has(def.valueType)) {
      throw new CustomFieldDefinitionError('options_forbidden', `Field "${def.key}" does not take options.`);
    }
    const opt = await this.commandBus.run(createOptionCommand(definitionId, input));
    await this.cache.publishInvalidate(def.entityType);
    return opt;
  }

  async updateOption(
    definitionId: string,
    optionId: string,
    patch: Partial<Pick<CustomFieldOptionDto, 'label' | 'labelDefault' | 'isDefault' | 'sortOrder'>>,
  ): Promise<CustomFieldOption> {
    const def = await this.emFactory().findOne(CustomFieldDefinition, { id: definitionId });
    if (!def) throw new CustomFieldDefinitionError('not_found', `Custom field ${definitionId} not found.`);
    const opt = await this.commandBus.run(updateOptionCommand(definitionId, optionId, patch));
    await this.cache.publishInvalidate(def.entityType);
    return opt;
  }

  async deleteOption(definitionId: string, optionId: string): Promise<void> {
    const def = await this.emFactory().findOne(CustomFieldDefinition, { id: definitionId });
    if (!def) throw new CustomFieldDefinitionError('not_found', `Custom field ${definitionId} not found.`);
    const option = await this.emFactory().findOne(CustomFieldOption, { id: optionId });
    if (!option) throw new CustomFieldDefinitionError('not_found', `Option ${optionId} not found.`);
    // FR-010: an in-use option cannot be removed while records reference it.
    if (this.valueService) {
      const inUse = await this.valueService.isOptionInUse(
        this.emFactory(),
        def.entityType,
        def.key,
        option.value,
      );
      if (inUse) {
        throw new CustomFieldDefinitionError(
          'option_in_use',
          `Option "${option.value}" is in use and cannot be removed.`,
        );
      }
    }
    await this.commandBus.run(deleteOptionCommand(definitionId, optionId, this.valueService));
    await this.cache.publishInvalidate(def.entityType);
  }

  // ---- Transactional apply seam (feature 061, CustomFieldDefinitionApplyApi)

  async applyCreate(
    em: EntityManager,
    input: CreateCustomFieldDefinitionRequest,
  ): Promise<CustomFieldDefinitionRecord> {
    return toCustomFieldDefinitionRecord(await applyCreateDefinition(em, input));
  }

  async applyUpdate(
    em: EntityManager,
    id: string,
    patch: UpdateCustomFieldDefinitionRequest,
  ): Promise<CustomFieldDefinitionRecord> {
    return toCustomFieldDefinitionRecord(
      await applyUpdateDefinition(em, id, patch, this.valueService),
    );
  }

  async applyDelete(em: EntityManager, id: string): Promise<void> {
    await applyDeleteDefinition(em, id);
  }

  async applyCreateOption(
    em: EntityManager,
    definitionId: string,
    input: CustomFieldOptionDto,
  ): Promise<CustomFieldOptionRecord> {
    return toCustomFieldOptionRecord(await applyCreateOption(em, definitionId, input));
  }

  async applyUpdateOption(
    em: EntityManager,
    definitionId: string,
    optionId: string,
    patch: Partial<Pick<CustomFieldOptionDto, 'label' | 'labelDefault' | 'isDefault' | 'sortOrder'>>,
  ): Promise<CustomFieldOptionRecord> {
    return toCustomFieldOptionRecord(await applyUpdateOption(em, definitionId, optionId, patch));
  }

  async applyDeleteOption(em: EntityManager, definitionId: string, optionId: string): Promise<void> {
    await applyDeleteOption(em, definitionId, optionId, this.valueService);
  }

  /** Post-commit cache fan-out for apply-seam callers (also used internally after every command). */
  async publishInvalidate(entityType: SupportedEntityType): Promise<void> {
    await this.cache.publishInvalidate(entityType);
  }
}
