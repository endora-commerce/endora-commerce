import { describe, expect, it } from 'vitest';
import { orgReachOf } from '../domain/visibility-rule.js';
import type { ProjectViewer } from '../domain/visibility-rule.js';
import { uuidArray, visibleProjectSqlFor } from './project-access.js';

/**
 * The SQL twin of `domain/visibility-rule.ts` — what it binds and when it
 * narrows nothing. The predicate itself is measured against a database by
 * `backend/test/integration/projects/organization-reach.test.ts`.
 */
const A = '00000000-0000-4000-8000-00000000000a';
const ME = '00000000-0000-4000-8000-0000000000e1';

const all = orgReachOf({ kind: 'all' });
const reachA = orgReachOf({ kind: 'allowed', organizationIds: [A] });

describe('visibleProjectSqlFor', () => {
  it('narrows nothing for the system, or for an unrestricted holder of projects:see_all', () => {
    const system: ProjectViewer = { adminUserId: null, canRead: true, seeAll: true, reach: all };
    expect(visibleProjectSqlFor(system, 'members')).toBeNull();
    expect(visibleProjectSqlFor({ adminUserId: ME, canRead: true, seeAll: true, reach: all }, 'members')).toBeNull();
  });

  it('applies the Organization rule even to a holder of projects:see_all, binding the reach', () => {
    const fragment = visibleProjectSqlFor({ adminUserId: ME, canRead: true, seeAll: true, reach: reachA }, 'everyone');
    expect(fragment?.params).toEqual([`{"${A}"}`]);
    expect(fragment?.sql).toContain('project_organizations');
    expect(fragment?.sql).not.toContain('project_members');
  });

  // Issue #305 — a sales representative reaches every Organization nobody else
  // governs: a Project is out of reach when one of its Organizations is excluded.
  it('binds a sales representative’s excluded set, and never lets a NULL predicate count as in reach', () => {
    const reach = orgReachOf({ kind: 'excluded', excludedOrganizationIds: [A], assignedOrganizationIds: [], excludedOrganizationsQuery: { sql: 'select x from "reach"(?::uuid) as x', params: ['rep'] } });
    const fragment = visibleProjectSqlFor({ adminUserId: ME, canRead: true, seeAll: true, reach }, 'everyone');
    expect(fragment?.params).toEqual(['rep']);
    expect(fragment?.sql).toContain('not in (select x from "reach"(?::uuid) as x)');
    expect(fragment?.sql).toContain('not coalesce(');
  });

  it('opens `inherit` Projects only when the setting is `everyone`, and always lets Members and listed people in', () => {
    const viewer: ProjectViewer = { adminUserId: ME, canRead: true, seeAll: false, reach: all };
    const members = visibleProjectSqlFor(viewer, 'members');
    expect(members?.sql).toContain(`p."visibility" = 'everyone'`);
    expect(members?.params).toEqual([ME, ME]);
    const everyone = visibleProjectSqlFor(viewer, 'everyone');
    expect(everyone?.sql).toContain(`p."visibility" in ('inherit', 'everyone')`);
  });

  it('matches nothing for an administrator without projects:read — not even an unrestricted see_all holder (T144 F1)', () => {
    expect(visibleProjectSqlFor({ adminUserId: ME, canRead: false, seeAll: true, reach: all }, 'everyone')).toEqual({
      sql: 'false',
      params: [],
    });
  });

  it('writes an array literal of uuids only', () => {
    expect(uuidArray([A, 'not-a-uuid', ME])).toBe(`{${A},${ME}}`);
    expect(uuidArray([])).toBe('{}');
  });
});
