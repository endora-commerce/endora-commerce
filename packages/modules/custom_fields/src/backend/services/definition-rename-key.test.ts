import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import type { CustomFieldDefinitionsCache } from './custom-field-definitions-cache.js';
import {
  CustomFieldDefinitionError,
  CustomFieldDefinitionService,
} from './custom-field-definition.service.js';

/**
 * `applyRenameKey` — the owner-operated rename of a definition's key
 * (`specs/134-paid-module-extraction/research.md` D12, *Ergonode fallback
 * boundary*).
 *
 * The ordinary edit seam cannot do it: `updateCustomFieldDefinitionRequestSchema`
 * omits `key`, deliberately, because an operator renaming a key would orphan
 * every value a host stores under it. This is a separate method so that the one
 * caller that has a reason — a connector repairing keys it derived itself,
 * together with the host renaming the values — says so by name, and nothing
 * reaches it by adding a field to an edit.
 *
 * Same seam rules as every `apply*`: the caller's `EntityManager`, no command,
 * no audit, no cache publish.
 */

type Row = Record<string, unknown>;

class FakeEm {
  definitions: Row[] = [];
  flushes = 0;

  async findOne(entity: unknown, where: Row): Promise<Row | null> {
    if (entity !== CustomFieldDefinition) throw new Error('unexpected entity');
    return (
      this.definitions.find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null
    );
  }

  async flush(): Promise<void> {
    this.flushes += 1;
  }

  asEm(): EntityManager {
    return this as unknown as EntityManager;
  }
}

function makeService(): { svc: CustomFieldDefinitionService; publishes: string[] } {
  const publishes: string[] = [];
  const cache = {
    publishInvalidate: async (entityType: string) => {
      publishes.push(entityType);
    },
  } as unknown as CustomFieldDefinitionsCache;
  const bus = {
    run: async () => {
      throw new Error('apply seam must not dispatch commands');
    },
  } as unknown as CommandBus;
  const svc = new CustomFieldDefinitionService(
    () => {
      throw new Error('apply seam must use the caller-provided EM');
    },
    cache,
    bus,
  );
  return { svc, publishes };
}

function seed(em: FakeEm, id: string, key: string, entityType = 'product'): Row {
  const row: Row = {
    id,
    entityType,
    key,
    label: {},
    labelDefault: key,
    valueType: 'text',
    required: false,
    sortOrder: 0,
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  em.definitions.push(row);
  return row;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CustomFieldDefinitionError);
    return (err as CustomFieldDefinitionError).code;
  }
  throw new Error('expected a CustomFieldDefinitionError');
}

describe('applyRenameKey', () => {
  it('renames on the caller EM, flushes, and neither dispatches nor publishes', async () => {
    const em = new FakeEm();
    const row = seed(em, 'd1', 'ergonode_kod__cznika');
    const { svc, publishes } = makeService();

    const record = await svc.applyRenameKey(
      em.asEm(),
      'd1',
      'ergonode_kod__cznika',
      'ergonode_kod_lacznika',
    );

    expect(row.key).toBe('ergonode_kod_lacznika');
    expect(record.key).toBe('ergonode_kod_lacznika');
    // Flushed, so a caller sequencing a two-phase rename gets its statements
    // in the order it asked for them.
    expect(em.flushes).toBe(1);
    expect(publishes).toEqual([]);
  });

  it('refuses when the key is no longer the one the caller planned from', async () => {
    const em = new FakeEm();
    seed(em, 'd1', 'something_else');
    const { svc } = makeService();

    expect(await codeOf(svc.applyRenameKey(em.asEm(), 'd1', 'expected', 'target'))).toBe(
      'key_changed',
    );
  });

  it('refuses a key another definition of the same entity type holds', async () => {
    const em = new FakeEm();
    seed(em, 'd1', 'old_key');
    seed(em, 'd2', 'taken');
    const { svc } = makeService();

    expect(await codeOf(svc.applyRenameKey(em.asEm(), 'd1', 'old_key', 'taken'))).toBe(
      'duplicate_key',
    );
  });

  it('refuses a key outside the grammar every definition key satisfies', async () => {
    const em = new FakeEm();
    seed(em, 'd1', 'old_key');
    const { svc } = makeService();

    expect(await codeOf(svc.applyRenameKey(em.asEm(), 'd1', 'old_key', 'Not A Key'))).toBe(
      'invalid_key',
    );
  });

  it('answers not_found for an unknown definition', async () => {
    const { svc } = makeService();

    expect(await codeOf(svc.applyRenameKey(new FakeEm().asEm(), 'nope', 'a', 'b'))).toBe(
      'not_found',
    );
  });
});
