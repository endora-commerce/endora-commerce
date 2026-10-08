/**
 * The properties of CRM's demo body that no database comparison can see
 * (`specs/143-crm-sales-opportunities/research.md` N-DD1).
 *
 * `backend/test/integration/demo/demo-shop.test.ts` seeds a throwaway database
 * and holds `crm_tags` to a recorded delta. It cannot say what a **second**
 * call does, nor which rows the withdrawal names: that seeding again creates
 * nothing — including over a tag an operator spelled in another case, which the
 * table's `lower(name)` unique index would refuse — and that the withdrawal is
 * keyed on the names `seed` assigns rather than on the table.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { ModuleDemoContext } from '@endora-commerce/contracts';
import { CrmTag } from '../entities/crm-tag.entity.js';
import { manifest } from '../../manifest.js';
import { DEMO_TAGS, DEMO_TAG_NAMES } from './rows.js';
import { seedDemo } from './seed.js';
import { resetDemo } from './reset.js';

/**
 * A minimal EntityManager over an in-memory `crm_tags`, unique the way the real
 * table is: case-insensitively on the name.
 */
function fakeEm(existing: readonly string[] = []): {
  em: EntityManager;
  created: Record<string, unknown>[];
  deletes: unknown[];
  entities: unknown[];
} {
  const names = [...existing];
  const created: Record<string, unknown>[] = [];
  const deletes: unknown[] = [];
  const entities: unknown[] = [];
  const em = {
    find: async (entity: unknown) => {
      entities.push(entity);
      return names.map((name) => ({ name }));
    },
    create: (entity: unknown, payload: Record<string, unknown>) => {
      entities.push(entity);
      const name = payload['name'] as string;
      if (names.some((held) => held.toLowerCase() === name.toLowerCase())) {
        throw new Error(`duplicate key: ${name}`);
      }
      names.push(name);
      created.push(payload);
      return payload;
    },
    flush: async () => undefined,
    nativeDelete: async (entity: unknown, where: unknown) => {
      entities.push(entity);
      deletes.push(where);
      return names.length;
    },
  };
  return { em: em as unknown as EntityManager, created, deletes, entities };
}

function contextOver(em: EntityManager): ModuleDemoContext<ModuleContext> {
  return {
    ctx: { cradle: () => ({ emFactory: () => em }) } as unknown as ModuleContext,
  };
}

describe('crm demo data', () => {
  it('creates its declared tags on an empty table', async () => {
    const { em, created } = fakeEm();
    const result = await seedDemo(contextOver(em));
    expect(created).toEqual(DEMO_TAGS.map((tag) => ({ name: tag.name, color: tag.color })));
    expect(result.created).toEqual([{ entity: 'CrmTag', count: DEMO_TAGS.length }]);
  });

  it('creates nothing on a second run and reports the same count', async () => {
    const { em, created } = fakeEm(DEMO_TAG_NAMES);
    const result = await seedDemo(contextOver(em));
    expect(created).toEqual([]);
    expect(result.created).toEqual([{ entity: 'CrmTag', count: DEMO_TAGS.length }]);
  });

  it('joins a tag that is already there under another spelling of its name', async () => {
    // `crm_tags_name_lower_unique` is on `lower(name)`: a probe by the exact
    // name would miss this row and the insert would then be refused.
    const [first, ...rest] = DEMO_TAG_NAMES;
    const { em, created } = fakeEm([first!.toUpperCase()]);
    await seedDemo(contextOver(em));
    expect(created.map((row) => row['name'])).toEqual(rest);
  });

  it('withdraws by the names it assigned, never by the table', async () => {
    const { em, deletes } = fakeEm([...DEMO_TAG_NAMES, 'An operator tag']);
    const result = await resetDemo(contextOver(em));
    expect(deletes).toEqual([{ name: { $in: [...DEMO_TAG_NAMES] } }]);
    expect(result.removed.map((line) => line.entity)).toEqual(['CrmTag']);
  });

  it('writes the one table that holds no other module\'s row', async () => {
    // An Opportunity carries an Organization, an assignee and a Sales Channel,
    // so the pipeline is a composition step; a tag carries a name and a colour.
    const { em, entities } = fakeEm();
    await seedDemo(contextOver(em));
    await resetDemo(contextOver(em));
    expect(new Set(entities)).toEqual(new Set([CrmTag]));
  });

  it('gives every tag a distinct name and a #rrggbb colour', () => {
    expect(new Set(DEMO_TAG_NAMES.map((name) => name.toLowerCase())).size).toBe(DEMO_TAGS.length);
    for (const tag of DEMO_TAGS) expect(tag.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(DEMO_TAGS.length).toBeGreaterThan(0);
  });

  it('is what the manifest declares', () => {
    expect(manifest.demo).not.toBe(false);
    expect(manifest.demo).toMatchObject({ summary: expect.any(String) });
  });
});
