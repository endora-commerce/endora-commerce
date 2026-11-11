import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type {
  CreateCustomFieldDefinitionRequest,
  SupportedEntityType,
} from '@endora-commerce/contracts';
import {
  applyCreateDefinition,
  applyUpdateDefinition,
  CustomFieldDefinitionError,
} from './custom-field-definition-apply.js';
import { CustomFieldDefinitionService } from './custom-field-definition.service.js';
import { CustomFieldDefinitionsCache } from './custom-field-definitions-cache.js';
import { toCustomFieldDefinitionRecord } from './custom-field-read-port.js';
import { updateDefinitionCommand } from '../commands/definition-commands.js';
import type { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import type { CustomFieldDefinitionApplyCreateInput } from '../../ports/index.js';

/**
 * `specs/175-buyer-input-custom-fields/` research R-4, FR-001 – FR-006, FR-008,
 * FR-009 — the buyer-input and admin-access attributes of a definition and the
 * four invariants judged on the RESULTING definition, at create, at update and
 * through the `apply*` seam host-managed types are written by. No database:
 * the EntityManager is a stub that answers what each case needs.
 */

const ID = '00000000-0000-4000-8000-175000000001';

function createInput(
  overrides: Partial<CustomFieldDefinitionApplyCreateInput> = {},
): CustomFieldDefinitionApplyCreateInput {
  return {
    entityType: 'organization',
    key: 'acquisition_source',
    label: {},
    labelDefault: 'Acquisition source',
    valueType: 'text',
    required: false,
    audience: 'customer',
    sortOrder: 0,
    config: {},
    options: [],
    ...overrides,
  };
}

/** An EntityManager that finds nothing and records what is created. */
function emptyEm(): { em: EntityManager; created: Record<string, unknown>[] } {
  const created: Record<string, unknown>[] = [];
  const em = {
    findOne: async () => null,
    find: async () => [],
    create: (_entity: unknown, data: Record<string, unknown>) => {
      created.push(data);
      return data;
    },
    flush: async () => undefined,
  } as unknown as EntityManager;
  return { em, created };
}

/** A stored definition, as the update path reads it. */
function stored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    entityType: 'organization',
    key: 'acquisition_source',
    label: {},
    labelDefault: 'Acquisition source',
    valueType: 'text',
    required: false,
    audience: 'customer',
    sortOrder: 0,
    config: {},
    listFilter: false,
    carryTo: [],
    customerInput: [],
    adminAccess: 'edit',
    createdAt: new Date('2026-11-06T10:00:00.000Z'),
    updatedAt: new Date('2026-11-06T10:00:00.000Z'),
    ...overrides,
  };
}

function emWith(definition: Record<string, unknown>): EntityManager {
  return {
    findOne: async () => definition,
    find: async () => [],
  } as unknown as EntityManager;
}

async function refusal(promise: Promise<unknown>): Promise<CustomFieldDefinitionError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CustomFieldDefinitionError);
  return error as CustomFieldDefinitionError;
}

const OPEN = ['organization.register'] as const;

describe('buyer input and admin access — defaults on create', () => {
  it('a definition created without either attribute is open on no surface and editable', async () => {
    const { em, created } = emptyEm();
    await applyCreateDefinition(em, createInput());
    expect(created[0]).toMatchObject({ customerInput: [], adminAccess: 'edit' });
  });

  it('stores customerInput deduplicated and sorted', async () => {
    const { em, created } = emptyEm();
    await applyCreateDefinition(
      em,
      createInput({ customerInput: ['organization.register', 'organization.register'] }),
    );
    expect(created[0]?.['customerInput']).toEqual(['organization.register']);
  });

  it('accepts an open customer field on customer, with any admin access when not required (SD-3)', async () => {
    for (const adminAccess of ['edit', 'read', 'hidden'] as const) {
      const { em, created } = emptyEm();
      await applyCreateDefinition(
        em,
        createInput({ entityType: 'customer', customerInput: [...OPEN], adminAccess }),
      );
      expect(created[0]).toMatchObject({ customerInput: [...OPEN], adminAccess });
    }
  });
});

describe('buyer input and admin access — the four refusals at create', () => {
  const NO_SURFACE: SupportedEntityType[] = [
    'category',
    'order',
    'quote_request',
    'opportunity',
    'project',
    'task',
    'product',
  ];
  for (const entityType of NO_SURFACE) {
    it(`refuses opening a ${entityType} field with customer_input_unsupported`, async () => {
      const { em, created } = emptyEm();
      const error = await refusal(
        applyCreateDefinition(em, createInput({ entityType, customerInput: [...OPEN] })),
      );
      expect(error.code).toBe('customer_input_unsupported');
      expect(error.details).toMatchObject({ key: 'acquisition_source' });
      expect(created).toEqual([]);
    });
  }

  it('refuses an open internal field with customer_input_audience', async () => {
    const { em, created } = emptyEm();
    const error = await refusal(
      applyCreateDefinition(em, createInput({ audience: 'internal', customerInput: [...OPEN] })),
    );
    expect(error.code).toBe('customer_input_audience');
    expect(error.details).toMatchObject({ key: 'acquisition_source' });
    expect(created).toEqual([]);
  });

  it('refuses an open page_builder field with customer_input_value_type', async () => {
    // `product` is the one type offering `page_builder`; the value type is
    // judged before the surface, so the reason names the value type.
    const { em, created } = emptyEm();
    const error = await refusal(
      applyCreateDefinition(
        em,
        createInput({ entityType: 'product', valueType: 'page_builder', customerInput: [...OPEN] }),
      ),
    );
    expect(error.code).toBe('customer_input_value_type');
    expect(created).toEqual([]);
  });

  for (const adminAccess of ['read', 'hidden'] as const) {
    it(`refuses a required ${adminAccess} field with admin_access_required`, async () => {
      const { em, created } = emptyEm();
      const error = await refusal(
        applyCreateDefinition(em, createInput({ required: true, adminAccess })),
      );
      expect(error.code).toBe('admin_access_required');
      expect(error.details).toMatchObject({ key: 'acquisition_source' });
      expect(created).toEqual([]);
    });
  }
});

describe('buyer input and admin access — the invariants on the resulting definition at update', () => {
  it('opening an internal field is refused with customer_input_audience', async () => {
    const definition = stored({ audience: 'internal' });
    const error = await refusal(
      applyUpdateDefinition(emWith(definition), ID, { customerInput: [...OPEN] }),
    );
    expect(error.code).toBe('customer_input_audience');
    expect(definition['customerInput']).toEqual([]);
  });

  it('making an open field internal is refused with customer_input_audience', async () => {
    const definition = stored({ customerInput: [...OPEN] });
    const error = await refusal(
      applyUpdateDefinition(emWith(definition), ID, { audience: 'internal' }),
    );
    expect(error.code).toBe('customer_input_audience');
    expect(definition['audience']).toBe('customer');
  });

  it('turning both at once is accepted: closed and internal', async () => {
    const definition = stored({ customerInput: [...OPEN] });
    await applyUpdateDefinition(emWith(definition), ID, { audience: 'internal', customerInput: [] });
    expect(definition).toMatchObject({ audience: 'internal', customerInput: [] });
  });

  it('opening a field of a type that offers no surface is refused with customer_input_unsupported', async () => {
    const definition = stored({ entityType: 'order' });
    const error = await refusal(
      applyUpdateDefinition(emWith(definition), ID, { customerInput: [...OPEN] }),
    );
    expect(error.code).toBe('customer_input_unsupported');
  });

  it('opening a page_builder field is refused with customer_input_value_type', async () => {
    const definition = stored({ entityType: 'product', valueType: 'page_builder' });
    const error = await refusal(
      applyUpdateDefinition(emWith(definition), ID, { customerInput: [...OPEN] }),
    );
    expect(error.code).toBe('customer_input_value_type');
  });

  it('making a required field read-only is refused with admin_access_required', async () => {
    const definition = stored({ required: true });
    const error = await refusal(applyUpdateDefinition(emWith(definition), ID, { adminAccess: 'read' }));
    expect(error.code).toBe('admin_access_required');
    expect(definition['adminAccess']).toBe('edit');
  });

  it('making a hidden field required is refused with admin_access_required', async () => {
    const definition = stored({ adminAccess: 'hidden' });
    const error = await refusal(applyUpdateDefinition(emWith(definition), ID, { required: true }));
    expect(error.code).toBe('admin_access_required');
    expect(definition['required']).toBe(false);
  });

  it('applies both attributes, customerInput deduplicated and sorted', async () => {
    const definition = stored();
    await applyUpdateDefinition(emWith(definition), ID, {
      customerInput: ['organization.register', 'organization.register'],
      adminAccess: 'hidden',
    });
    expect(definition).toMatchObject({ customerInput: [...OPEN], adminAccess: 'hidden' });
  });

  it('a patch naming neither attribute leaves both unchanged', async () => {
    const definition = stored({ customerInput: [...OPEN], adminAccess: 'read' });
    await applyUpdateDefinition(emWith(definition), ID, { labelDefault: 'Source' });
    expect(definition).toMatchObject({ customerInput: [...OPEN], adminAccess: 'read', labelDefault: 'Source' });
  });
});

describe('buyer input and admin access — through the definition service and its Commands', () => {
  /** A bus that runs the Command on the stub EntityManager, as the real one does in its transaction. */
  function busOver(em: EntityManager): CommandBus {
    return {
      run: async (command: { run(ctx: { em: EntityManager }): Promise<{ result: unknown }> }) =>
        (await command.run({ em })).result,
    } as unknown as CommandBus;
  }

  function service(em: EntityManager): CustomFieldDefinitionService {
    return new CustomFieldDefinitionService(() => em, new CustomFieldDefinitionsCache(), busOver(em));
  }

  function request(overrides: Partial<CreateCustomFieldDefinitionRequest> = {}): CreateCustomFieldDefinitionRequest {
    return { ...createInput(), carryTo: [], customerInput: [], adminAccess: 'edit', ...overrides };
  }

  it('create refuses each reason before anything is written', async () => {
    const cases: Array<[Partial<CreateCustomFieldDefinitionRequest>, string]> = [
      [{ entityType: 'order', customerInput: [...OPEN] }, 'customer_input_unsupported'],
      [{ audience: 'internal', customerInput: [...OPEN] }, 'customer_input_audience'],
      [{ required: true, adminAccess: 'hidden' }, 'admin_access_required'],
    ];
    for (const [overrides, code] of cases) {
      const { em, created } = emptyEm();
      const error = await refusal(service(em).create(request(overrides)));
      expect(error.code).toBe(code);
      expect(created).toEqual([]);
    }
  });

  it('update refuses on the resulting definition', async () => {
    const definition = stored({ customerInput: [...OPEN] });
    const error = await refusal(service(emWith(definition)).update(ID, { audience: 'internal' }));
    expect(error.code).toBe('customer_input_audience');
  });

  it('the update Command audits both attributes (FR-008)', async () => {
    const definition = stored();
    const command = updateDefinitionCommand(ID, { customerInput: [...OPEN], adminAccess: 'read' });
    const em = emWith(definition);
    const before = await command.capture?.({ em } as never);
    const outcome = await command.run({ em } as never);
    expect(before).toMatchObject({ customerInput: [], adminAccess: 'edit' });
    expect(outcome.after).toMatchObject({ customerInput: [...OPEN], adminAccess: 'read' });
  });
});

describe('buyer input and admin access — the published record (FR-009)', () => {
  it('carries both attributes', () => {
    const record = toCustomFieldDefinitionRecord(
      stored({ customerInput: [...OPEN], adminAccess: 'hidden' }) as unknown as CustomFieldDefinition,
    );
    expect(record.customerInput).toEqual([...OPEN]);
    expect(record.adminAccess).toBe('hidden');
  });

  it('answers [] and edit for a row read before the columns existed', () => {
    const { customerInput: _ci, adminAccess: _aa, ...legacy } = stored();
    const record = toCustomFieldDefinitionRecord(legacy as unknown as CustomFieldDefinition);
    expect(record.customerInput).toEqual([]);
    expect(record.adminAccess).toBe('edit');
  });
});
