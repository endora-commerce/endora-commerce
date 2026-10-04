import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';
import {
  OrganizationTreeService,
  isReadableTreePath,
  unreadablePathRefusal,
} from './organization-tree-service.js';

/**
 * A path the tree cannot read is never a prefix of anything.
 *
 * `path` is supposed to be `/<rootId>/…/<thisId>/`. The entity writes it on
 * create and a migration repaired the rows that predate that — but a row can
 * still arrive some other way (raw SQL, a restore, a future writer that skips
 * the hook), and the column's default is `''`, the prefix of every path. So
 * every reader here has to fail **closed** on its own: a subtree of one, no
 * ancestors, and a refused move, rather than an answer that spans the table.
 *
 * No database: the connection is a recorder, and what these cases assert is
 * which statements were *not* issued.
 */
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function org(id: string, path: string, parentId: string | null = null): Organization {
  const o = new Organization();
  o.id = id;
  o.path = path;
  o.parentId = parentId;
  return o;
}

interface Issued {
  sql: string;
  params: unknown[];
}

/** A service whose connection answers the own-row lookup and records the rest. */
function serviceOver(own: { path: string; deleted_at?: string | null } | null): {
  tree: OrganizationTreeService;
  issued: Issued[];
  em: EntityManager;
} {
  const issued: Issued[] = [];
  const em = {
    getTransactionContext: () => undefined,
    getConnection: () => ({
      execute: async (sql: string, params: unknown[] = []) => {
        issued.push({ sql, params });
        if (/where "id" = \?/.test(sql) && !/like/.test(sql)) {
          return own ? [{ id: A, name: 'A', parent_id: null, status: 'active', deleted_at: null, ...own }] : [];
        }
        return [];
      },
    }),
  } as unknown as EntityManager;
  return { tree: new OrganizationTreeService(() => em), issued, em };
}

const prefixScans = (issued: Issued[]): Issued[] => issued.filter((s) => /like/i.test(s.sql));

async function refusalOf(run: () => unknown): Promise<HttpError> {
  try {
    await run();
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected a refusal, and the call succeeded');
}

describe('isReadableTreePath [unit]', () => {
  it.each([
    [`/${A}/`, A, true],
    [`/${B}/${A}/`, A, true],
    ['', A, false],
    ['/', A, false],
    [`${A}/`, A, false], // no leading slash — built from an empty parent path
    [`/${A}`, A, false], // no trailing slash
    [`/${B}/`, A, false], // well-shaped, but it is somebody else's
    [`/${A}/${B}/`, A, false], // own id is not the last segment
    [`/%/${A}/`, A, false], // a LIKE wildcard is never a segment
    [`//${A}/`, A, false],
  ])('%j for %s → %s', (path, id, expected) => {
    expect(isReadableTreePath(path, id)).toBe(expected);
  });
});

describe('OrganizationTreeService — reads fail closed on an unreadable path [unit]', () => {
  it.each(['', `${A}/`, '/', `/${B}/`])(
    'subtreeIds of a row whose path is %j is that row alone, with no prefix scan',
    async (path) => {
      const { tree, issued } = serviceOver({ path });
      expect(await tree.subtreeIds(A)).toEqual([A]);
      expect(await tree.descendantIds(A)).toEqual([]);
      expect(prefixScans(issued)).toEqual([]);
    },
  );

  it('subtreeNodes of such a row is that row alone, at depth 0', async () => {
    const { tree, issued } = serviceOver({ path: '' });
    const nodes = await tree.subtreeNodes(A);
    expect(nodes.map((n) => n.id)).toEqual([A]);
    expect(nodes[0]?.depth).toBe(0);
    expect(prefixScans(issued)).toEqual([]);
  });

  it('ancestorIds of such a row is empty', async () => {
    expect(await serviceOver({ path: '' }).tree.ancestorIds(A)).toEqual([]);
    expect(await serviceOver({ path: `${B}/${A}/` }).tree.ancestorIds(A)).toEqual([]);
  });

  it('a soft-deleted row with an unreadable path is not its own subtree either', async () => {
    const { tree } = serviceOver({ path: '', deleted_at: '2026-01-01' });
    expect(await tree.subtreeIds(A)).toEqual([]);
  });

  it('an organization that does not exist still has an empty subtree', async () => {
    expect(await serviceOver(null).tree.subtreeIds(A)).toEqual([]);
  });

  it('a readable path still runs the prefix scan, with the path as its operand', async () => {
    const { tree, issued } = serviceOver({ path: `/${A}/` });
    await tree.subtreeIds(A);
    expect(prefixScans(issued)).toHaveLength(1);
    expect(prefixScans(issued)[0]?.params).toEqual([`/${A}/%`]);
  });
});

describe('OrganizationTreeService — a move involving an unreadable path is refused [unit]', () => {
  const good = (id: string): Organization => org(id, `/${id}/`);

  it('names the refusal: 409 ORGANIZATION_TREE_INVALID / path_unreadable', () => {
    const refusal = unreadablePathRefusal(A);
    expect(refusal.statusCode).toBe(409);
    expect(refusal.code).toBe('ORGANIZATION_TREE_INVALID');
    expect(refusal.details).toEqual({ code: 'path_unreadable', organizationId: A });
  });

  it.each([
    ['the moved organization', org(A, ''), good(B), A],
    ['the new parent', good(A), org(B, ''), B],
    ['a moved organization with no leading slash', org(A, `${A}/`), good(B), A],
  ])('assertNoCycle refuses when %s has one', async (_name, node, parent, culprit) => {
    const { tree } = serviceOver(null);
    const refusal = await refusalOf(() => tree.assertNoCycle(node, parent));
    expect(refusal.details).toEqual({ code: 'path_unreadable', organizationId: culprit });
  });

  it('assertNoCycle refuses a detach of such a row too', async () => {
    // Detaching would rewrite `path like '' || '%'` — every row in the table.
    const { tree } = serviceOver(null);
    const refusal = await refusalOf(() => tree.assertNoCycle(org(A, ''), null));
    expect(refusal.details).toEqual({ code: 'path_unreadable', organizationId: A });
  });

  it('assertMaxDepth and applyReparentPaths refuse before issuing any statement', async () => {
    // Each guards itself: they are public, and two test files call them without
    // going through assertNoCycle first.
    const { tree, issued, em } = serviceOver(null);
    await refusalOf(() => tree.assertMaxDepth(em, org(A, ''), good(B)));
    await refusalOf(() => tree.applyReparentPaths(em, org(A, ''), good(B)));
    await refusalOf(() => tree.applyReparentPaths(em, good(A), org(B, '')));
    await refusalOf(() => tree.applyReparentPaths(em, org(A, ''), null));
    expect(issued).toEqual([]);
  });

  it('still lets two readable roots through', () => {
    const { tree } = serviceOver(null);
    expect(() => tree.assertNoCycle(good(A), good(B))).not.toThrow();
    expect(() => tree.assertNoCycle(good(A), null)).not.toThrow();
  });
});
