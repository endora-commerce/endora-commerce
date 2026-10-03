import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import { OrganizationTreeService } from '../services/organization-tree-service.js';
import { Organization } from './organization.entity.js';

/**
 * A new organization is a root, and its materialized path says so.
 *
 * `path` used to be written by the tree Commands and by nothing else, so every
 * organization that was merely *created* — by registration, by the personal
 * organization of a B2C account, by a fixture — kept the column's `''` default.
 * The tree reads a path as a prefix, and `''` is the prefix of everything.
 *
 * The create hook is called directly: it is a plain method, and what it has to
 * be proven against is the tree service's own cycle rule, not the ORM.
 */
function created(parentId?: string | null): Organization {
  const org = new Organization();
  if (parentId !== undefined) org.parentId = parentId;
  org.assignRootPath();
  return org;
}

const tree = new OrganizationTreeService(() => ({}) as EntityManager);

describe('Organization — the root path on create [unit]', () => {
  it('gives a new organization the path of a root: /<id>/', () => {
    const org = created();
    expect(org.path).toBe(`/${org.id}/`);
  });

  it('two newly created roots are not cyclic with respect to each other', () => {
    // The case that refused as `422 ORGANIZATION_TREE_INVALID` "cycle" for any
    // pair of organizations nobody had re-parented before.
    const a = created();
    const b = created();
    expect(() => tree.assertNoCycle(a, b)).not.toThrow();
    expect(() => tree.assertNoCycle(b, a)).not.toThrow();
  });

  it('still refuses a real cycle', () => {
    const parent = created();
    const child = created();
    child.parentId = parent.id;
    child.path = `${parent.path}${child.id}/`;

    const refusal = (() => {
      try {
        tree.assertNoCycle(parent, child);
      } catch (err) {
        return err;
      }
      return null;
    })();
    expect(refusal).toBeInstanceOf(HttpError);
    expect((refusal as HttpError).details).toEqual({ code: 'cycle' });
    expect(() => tree.assertNoCycle(parent, parent)).toThrow(HttpError);
  });

  it('leaves a path its creator already wrote', () => {
    const org = new Organization();
    org.path = '/root/mid/leaf/';
    org.assignRootPath();
    expect(org.path).toBe('/root/mid/leaf/');
  });

  it('does not invent a root path for a row created with a parent', () => {
    // A child's path is its parent's plus its own id, which this hook cannot
    // know. Writing `/<id>/` would be a second wrong answer rather than none.
    const org = created('00000000-0000-4000-8000-000000000001');
    expect(org.path).toBe('');
  });
});
