import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CreateCustomFieldDefinitionRequest } from '@endora-commerce/contracts';
import type { CommandBus } from '../../../src/commands/index.js';
import { CustomFieldDefinition } from '../../../../packages/modules/custom_fields/src/backend/entities/custom-field-definition.entity.js';
import { CustomFieldOption } from '../../../../packages/modules/custom_fields/src/backend/entities/custom-field-option.entity.js';
import type { CustomFieldDefinitionsCache } from '../../../../packages/modules/custom_fields/src/backend/services/custom-field-definitions-cache.js';
import {
  CustomFieldDefinitionError,
  CustomFieldDefinitionService,
} from '../../../../packages/modules/custom_fields/src/backend/services/custom-field-definition.service.js';
import { CustomFieldValueService } from '../../../../packages/modules/custom_fields/src/backend/services/custom-field-value.service.js';

/**
 * Feature 061 T008 — the transactional apply seam
 * (contracts/custom-fields-product-host.md §3).
 *
 * `applyCreate/applyUpdate/applyDelete` (+ option variants) run entirely on a
 * CALLER-provided EntityManager, enforce the same invariants as the public CRUD
 * (duplicate key, options rule, entity type known, value-type lock via the
 * probe binding, option-in-use), and perform NO command dispatch, NO audit,
 * and NO cache publish — those are the host command's post-commit duties.
 */

type Row = Record<string, unknown>;

/** In-memory EM double covering exactly the surface the apply seam may use. */
class FakeEm {
  definitions: Row[] = [];
  options: Row[] = [];
  flushes = 0;
  /** Rows returned by the raw probe SQL (change-guard probes run on THIS em). */
  probeRows: unknown[] = [];
  probeCalls: { sql: string; params: unknown[] }[] = [];

  getConnection() {
    return {
      execute: async (sql: string, params: unknown[]) => {
        this.probeCalls.push({ sql, params });
        return this.probeRows;
      },
    };
  }

  private bucket(entity: unknown): Row[] {
    if (entity === CustomFieldDefinition) return this.definitions;
    if (entity === CustomFieldOption) return this.options;
    throw new Error('unexpected entity in apply seam');
  }

  async findOne(entity: unknown, where: Row): Promise<Row | null> {
    return this.bucket(entity).find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null;
  }

  async find(entity: unknown, where: Row): Promise<Row[]> {
    return this.bucket(entity).filter((row) =>
      Object.entries(where).every(([k, v]) => {
        if (v && typeof v === 'object' && '$in' in (v as Row)) {
          return ((v as { $in: unknown[] }).$in).includes(row[k]);
        }
        return row[k] === v;
      }),
    );
  }

  create(entity: unknown, data: Row): Row {
    const row = { id: randomUUID(), ...data };
    this.bucket(entity).push(row);
    return row;
  }

  remove(row: Row): this {
    for (const arr of [this.definitions, this.options]) {
      const i = arr.indexOf(row);
      if (i >= 0) arr.splice(i, 1);
    }
    return this;
  }

  async flush(): Promise<void> {
    this.flushes += 1;
  }

  asEm(): EntityManager {
    return this as unknown as EntityManager;
  }
}

function makeService(): {
  svc: CustomFieldDefinitionService;
  publishes: string[];
} {
  const publishes: string[] = [];
  const cache = {
    getForEntity: async (_t: string, loader: () => Promise<unknown[]>) => loader(),
    invalidateLocal: () => undefined,
    publishInvalidate: async (entityType: string) => {
      publishes.push(entityType);
    },
  } as unknown as CustomFieldDefinitionsCache;
  const bus = {
    run: async () => {
      throw new Error('apply seam must not dispatch commands (no audit of its own)');
    },
  } as unknown as CommandBus;
  const svc = new CustomFieldDefinitionService(
    () => {
      throw new Error('apply seam must use the caller-provided EM');
    },
    cache,
    bus,
  );
  svc.setValueService(new CustomFieldValueService({ listForEntity: async () => [] }));
  return { svc, publishes };
}

function createInput(overrides: Partial<CreateCustomFieldDefinitionRequest> = {}): CreateCustomFieldDefinitionRequest {
  return {
    entityType: 'product',
    key: 'color',
    label: {},
    labelDefault: 'Color',
    valueType: 'select',
    required: false,
    sortOrder: 0,
    config: {},
    options: [{ value: 'red', label: {}, labelDefault: 'Red', isDefault: false, sortOrder: 0 }],
    ...overrides,
  } as CreateCustomFieldDefinitionRequest;
}

async function expectApplyError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`expected CustomFieldDefinitionError(${code})`);
  } catch (err) {
    expect(err).toBeInstanceOf(CustomFieldDefinitionError);
    expect((err as CustomFieldDefinitionError).code).toBe(code);
  }
}

describe('applyCreate', () => {
  it('creates the definition + options on the caller EM; no command, no publish', async () => {
    const em = new FakeEm();
    const { svc, publishes } = makeService();
    const def = await svc.applyCreate(em.asEm(), createInput());
    expect(em.definitions).toHaveLength(1);
    expect(em.definitions[0]!.key).toBe('color');
    expect(em.options).toHaveLength(1);
    expect(em.options[0]!.definitionId).toBe(def.id);
    expect(publishes).toEqual([]);
  });

  it('rejects a duplicate (entityType, key) with duplicate_key', async () => {
    const em = new FakeEm();
    em.definitions.push({ id: randomUUID(), entityType: 'product', key: 'color' });
    const { svc } = makeService();
    await expectApplyError(svc.applyCreate(em.asEm(), createInput()), 'duplicate_key');
  });

  it('enforces the options rule and the known-entity-type invariant', async () => {
    const { svc } = makeService();
    await expectApplyError(
      svc.applyCreate(new FakeEm().asEm(), createInput({ options: [] })),
      'options_required',
    );
    await expectApplyError(
      svc.applyCreate(new FakeEm().asEm(), createInput({ valueType: 'text' })),
      'options_forbidden',
    );
    await expectApplyError(
      svc.applyCreate(
        new FakeEm().asEm(),
        createInput({ entityType: 'gizmo' as CreateCustomFieldDefinitionRequest['entityType'], valueType: 'text', options: [] }),
      ),
      'entity_type_unknown',
    );
  });
});

describe('applyUpdate', () => {
  function seedDef(em: FakeEm): Row {
    const def = {
      id: randomUUID(),
      entityType: 'product',
      key: 'color',
      label: {},
      labelDefault: 'Color',
      valueType: 'select',
      required: false,
      sortOrder: 0,
      config: {},
    };
    em.definitions.push(def);
    return def;
  }

  it('patches on the caller EM; no command, no publish', async () => {
    const em = new FakeEm();
    const def = seedDef(em);
    const { svc, publishes } = makeService();
    const updated = await svc.applyUpdate(em.asEm(), def.id as string, { labelDefault: 'Colour' });
    expect(updated.labelDefault).toBe('Colour');
    expect(em.definitions[0]!.labelDefault).toBe('Colour');
    expect(publishes).toEqual([]);
  });

  it('rejects a value-type change while values exist (probe runs on the caller EM)', async () => {
    const em = new FakeEm();
    const def = seedDef(em);
    em.probeRows = [{ one: 1 }]; // host rows hold a value under this key
    const { svc } = makeService();
    await expectApplyError(
      svc.applyUpdate(em.asEm(), def.id as string, { valueType: 'text' }),
      'value_type_locked',
    );
    expect(em.probeCalls.length).toBeGreaterThan(0);
    expect(em.probeCalls[0]!.sql).toContain('"products"');
  });

  it('allows a value-type change when no values exist', async () => {
    const em = new FakeEm();
    const def = seedDef(em);
    em.probeRows = [];
    const { svc } = makeService();
    const updated = await svc.applyUpdate(em.asEm(), def.id as string, { valueType: 'text' });
    expect(updated.valueType).toBe('text');
  });

  it('throws not_found for an unknown id', async () => {
    const { svc } = makeService();
    await expectApplyError(
      svc.applyUpdate(new FakeEm().asEm(), randomUUID(), { labelDefault: 'X' }),
      'not_found',
    );
  });
});

describe('applyDelete', () => {
  it('removes the definition and cascades its options; no publish', async () => {
    const em = new FakeEm();
    const defId = randomUUID();
    em.definitions.push({ id: defId, entityType: 'product', key: 'color', valueType: 'select' });
    em.options.push(
      { id: randomUUID(), definitionId: defId, value: 'red' },
      { id: randomUUID(), definitionId: defId, value: 'blue' },
    );
    const { svc, publishes } = makeService();
    await svc.applyDelete(em.asEm(), defId);
    expect(em.definitions).toHaveLength(0);
    expect(em.options).toHaveLength(0);
    expect(publishes).toEqual([]);
  });

  it('throws not_found for an unknown id', async () => {
    const { svc } = makeService();
    await expectApplyError(svc.applyDelete(new FakeEm().asEm(), randomUUID()), 'not_found');
  });
});

describe('option apply variants', () => {
  function seedSelectDef(em: FakeEm): { defId: string; optionId: string } {
    const defId = randomUUID();
    const optionId = randomUUID();
    em.definitions.push({ id: defId, entityType: 'product', key: 'color', valueType: 'select' });
    em.options.push({ id: optionId, definitionId: defId, value: 'red', labelDefault: 'Red', isDefault: false, sortOrder: 0 });
    return { defId, optionId };
  }

  it('applyCreateOption adds an option to a select definition', async () => {
    const em = new FakeEm();
    const { defId } = seedSelectDef(em);
    const { svc, publishes } = makeService();
    const opt = await svc.applyCreateOption(em.asEm(), defId, {
      value: 'green',
      label: {},
      labelDefault: 'Green',
      isDefault: false,
      sortOrder: 1,
    });
    expect(opt.value).toBe('green');
    expect(em.options).toHaveLength(2);
    expect(publishes).toEqual([]);
  });

  it('applyCreateOption refuses options on a non-select definition', async () => {
    const em = new FakeEm();
    const defId = randomUUID();
    em.definitions.push({ id: defId, entityType: 'product', key: 'weight', valueType: 'number' });
    const { svc } = makeService();
    await expectApplyError(
      svc.applyCreateOption(em.asEm(), defId, {
        value: 'x',
        label: {},
        labelDefault: 'X',
        isDefault: false,
        sortOrder: 0,
      }),
      'options_forbidden',
    );
  });

  it('applyUpdateOption patches the option; a foreign definitionId is not_found', async () => {
    const em = new FakeEm();
    const { defId, optionId } = seedSelectDef(em);
    const { svc } = makeService();
    const updated = await svc.applyUpdateOption(em.asEm(), defId, optionId, { labelDefault: 'Crimson' });
    expect(updated.labelDefault).toBe('Crimson');
    await expectApplyError(
      svc.applyUpdateOption(em.asEm(), randomUUID(), optionId, { labelDefault: 'Nope' }),
      'not_found',
    );
  });

  it('applyDeleteOption refuses an in-use option (probe on the caller EM)', async () => {
    const em = new FakeEm();
    const { defId, optionId } = seedSelectDef(em);
    em.probeRows = [{ one: 1 }];
    const { svc } = makeService();
    await expectApplyError(svc.applyDeleteOption(em.asEm(), defId, optionId), 'option_in_use');
    expect(em.options).toHaveLength(1);
    expect(em.probeCalls[0]!.sql).toContain('"products"');
  });

  it('applyDeleteOption removes an unused option; no publish', async () => {
    const em = new FakeEm();
    const { defId, optionId } = seedSelectDef(em);
    em.probeRows = [];
    const { svc, publishes } = makeService();
    await svc.applyDeleteOption(em.asEm(), defId, optionId);
    expect(em.options).toHaveLength(0);
    expect(publishes).toEqual([]);
  });
});

describe('publishInvalidate', () => {
  it('is the caller-invoked post-commit hook delegating to the definitions cache', async () => {
    const { svc, publishes } = makeService();
    await svc.publishInvalidate('product');
    expect(publishes).toEqual(['product']);
  });
});
