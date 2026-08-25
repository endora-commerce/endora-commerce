import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CustomFieldDefinitionReadPort,
  type CustomFieldDefinitionWithOptions,
} from '@endora-commerce/contracts';

import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { CatalogAttributeReadService } from '../../../src/modules/catalog/services/catalog-attribute-read.service.js';
import {
  updateAttributeCommand,
  type AttributeCommandDeps,
} from '../../../src/modules/catalog/commands/attribute-commands.js';
import type { CustomFieldDefinitionApplyApi } from '../../../../packages/modules/custom_fields/src/ports/index.js';

/**
 * Feature 080, T053(b) — the definition **read** leaves the apply seam.
 *
 * `catalog`'s attribute Commands take two things from `custom_fields`: the six
 * co-transactional `apply*` writes, which need the caller's `EntityManager`,
 * and one committed-state read of a single definition. The read used to be
 * served off the same unpublished container name as the writes
 * (`customFieldDefinitionService`), typed as a record while the owner actually
 * handed back its two managed ORM entities — the exact widening D-77's first
 * narrowing removed everywhere else. It is a read, so by D-169 it is a
 * read-port method: handing a read an `EntityManager` re-opens a write seam to
 * serve it.
 *
 * The second half is the fail-closed proof. `custom_fields` declares
 * `activation.nonDeactivatable`, so it has no operator off state to switch into
 * and no test may claim one; what is provable, and what matters at this call
 * site, is that a `ModuleDisabledError` arriving from the gated read port
 * leaves the Command untouched — 503 `MODULE_DISABLED` to the caller, and not
 * one `apply*` write attempted.
 */

const NOW = new Date('2026-01-01T00:00:00Z');

function definitionRecord(id: string): CustomFieldDefinitionWithOptions {
  return {
    definition: {
      id,
      entityType: 'product',
      key: 'material',
      label: { en: 'Material' },
      labelDefault: 'Material',
      valueType: 'text',
      required: false,
      sortOrder: 0,
      config: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    options: [],
  };
}

function readPort(
  getById: CustomFieldDefinitionReadPort['getById'],
): CustomFieldDefinitionReadPort {
  return {
    listForEntity: async () => [],
    listForEntityFresh: async () => [],
    getById,
  };
}

const noEm = (): EntityManager => {
  throw new Error('this test must not reach the database');
};

/** An apply seam that records every write it is asked for and performs none. */
function recordingApply(calls: string[]): CustomFieldDefinitionApplyApi {
  const record =
    (name: string) =>
    async (): Promise<never> => {
      calls.push(name);
      throw new Error(`the seam must not be reached: ${name}`);
    };
  return {
    applyCreate: record('applyCreate'),
    applyUpdate: record('applyUpdate'),
    applyDelete: record('applyDelete'),
    applyCreateOption: record('applyCreateOption'),
    applyUpdateOption: record('applyUpdateOption'),
    applyDeleteOption: record('applyDeleteOption'),
    publishInvalidate: record('publishInvalidate'),
  } as unknown as CustomFieldDefinitionApplyApi;
}

/** An `em` holding exactly one catalog extension row for `definitionId`. */
function emWithExtension(definitionId: string): EntityManager {
  return {
    findOne: async () => ({
      id: 'ext-1',
      customFieldDefinitionId: definitionId,
      selectDisplay: null,
      numericKind: null,
      isSearchable: false,
      isFilterable: false,
    }),
  } as unknown as EntityManager;
}

const ACTOR = {
  actorAdminUserId: null,
  impersonatedCustomerAccountId: null,
  kind: 'system',
} as never;

describe('catalog reads one definition through the published read port', () => {
  it('answers getDefinitionById off the definition read port, as a record', async () => {
    const asked: string[] = [];
    const service = new CatalogAttributeReadService(
      noEm,
      readPort(async (id) => {
        asked.push(id);
        return definitionRecord(id);
      }),
    );

    const found = await service.getDefinitionById('def-1');

    expect(asked).toEqual(['def-1']);
    expect(found?.definition.key).toBe('material');
  });

  it('answers null for a definition the owner does not have', async () => {
    const service = new CatalogAttributeReadService(noEm, readPort(async () => null));
    expect(await service.getDefinitionById('gone')).toBeNull();
  });
});

describe('the attribute update Command fails closed on the definition read', () => {
  it('propagates ModuleDisabledError and attempts no apply-seam write', async () => {
    const seamCalls: string[] = [];
    const deps: AttributeCommandDeps = {
      apply: recordingApply(seamCalls),
      readDefinition: async () => {
        throw new ModuleDisabledError('custom_fields');
      },
    };

    let thrown: unknown;
    try {
      await updateAttributeCommand(deps, 'ext-1', { isSearchable: true }).run({
        em: emWithExtension('def-1'),
        actor: ACTOR,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ModuleDisabledError);
    expect((thrown as ModuleDisabledError).statusCode).toBe(503);
    expect((thrown as ModuleDisabledError).code).toBe(ERROR_CODES.MODULE_DISABLED);
    expect(seamCalls).toEqual([]);
  });
});
