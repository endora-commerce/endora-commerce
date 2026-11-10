import { describe, expect, it } from 'vitest';
import { orgReachOf } from './visibility-rule.js';
import type { ProjectVisibility, ProjectVisibilitySetting } from '@endora-commerce/contracts';
import {
  canSee,
  effectiveVisibility,
  projectOrgRule,
  type OrgReach,
  type ProjectViewer,
  type ProjectVisibilityFacts,
} from './visibility-rule.js';

/**
 * Who sees a Project — the two rules of `specs/163-projects-and-tasks/`
 * research R-2 (Organization reach, owner ruling Q1 = C) and R-3 (visibility,
 * owner ruling Q2 = A), as truth tables. The Organization rule is always
 * applied first: nothing a Project or a setting says widens it.
 */

const A = 'org-a';
const B = 'org-b';

const ALL: OrgReach = await orgReachOf({ kind: 'all' });
const REACHES_A: OrgReach = await orgReachOf({ kind: 'allowed', organizationIds: [A] });
const REACHES_A_AND_B: OrgReach = await orgReachOf({ kind: 'allowed', organizationIds: [A, B] });
const REACHES_NOTHING: OrgReach = await orgReachOf({ kind: 'allowed', organizationIds: [] });

describe('projectOrgRule (R-2, Q1 = C)', () => {
  const cases: Array<[string, OrgReach, string[], boolean]> = [
    ['all mode: a Project of one Organization', ALL, [A], true],
    ['all mode: a Project of two Organizations', ALL, [A, B], true],
    ['all mode: an internal Project (no Organization)', ALL, [], true],
    ['set mode: every Organization of the Project in reach', REACHES_A_AND_B, [A, B], true],
    ['set mode: the Project’s only Organization in reach', REACHES_A, [A], true],
    ['set mode: some of the Project’s Organizations in reach', REACHES_A, [A, B], false],
    ['set mode: none of the Project’s Organizations in reach', REACHES_A, [B], false],
    ['set mode: an internal Project is nobody’s in set mode', REACHES_A_AND_B, [], false],
    ['set mode reaching nothing: an internal Project', REACHES_NOTHING, [], false],
    ['set mode reaching nothing: a Project of one Organization', REACHES_NOTHING, [A], false],
  ];
  it.each(cases)('%s', (_label, reach, organizationIds, expected) => {
    expect(projectOrgRule(reach, organizationIds)).toBe(expected);
  });
});

describe('effectiveVisibility (R-3)', () => {
  const cases: Array<[ProjectVisibility, ProjectVisibilitySetting, 'everyone' | 'members_and_listed']> = [
    ['inherit', 'everyone', 'everyone'],
    ['inherit', 'members', 'members_and_listed'],
    ['everyone', 'everyone', 'everyone'],
    ['everyone', 'members', 'everyone'],
    ['members_and_listed', 'everyone', 'members_and_listed'],
    ['members_and_listed', 'members', 'members_and_listed'],
  ];
  it.each(cases)('a Project set to %s under the setting %s is %s', (visibility, setting, expected) => {
    expect(effectiveVisibility(visibility, setting)).toBe(expected);
  });
});

describe('canSee (R-2 × R-3)', () => {
  const ME = 'admin-me';
  type Relation = 'member' | 'listed' | 'other' | 'see_all';

  function viewerAndProject(
    relation: Relation,
    visibility: ProjectVisibility,
    reach: OrgReach = ALL,
    organizationIds: string[] = [A],
  ): [ProjectViewer, ProjectVisibilityFacts] {
    const viewer: ProjectViewer = { adminUserId: ME, canRead: true, seeAll: relation === 'see_all', reach };
    const project: ProjectVisibilityFacts = {
      organizationIds,
      visibility,
      memberIds: relation === 'member' ? [ME, 'someone-else'] : ['someone-else'],
      viewerIds: relation === 'listed' ? [ME] : [],
    };
    return [viewer, project];
  }

  // setting × Project visibility × relation → visible. A Member, a listed
  // person and a holder of `projects:see_all` always see it; anybody else only
  // when the effective mode is `everyone`.
  const table: Array<[ProjectVisibilitySetting, ProjectVisibility, Relation, boolean]> = [];
  for (const setting of ['everyone', 'members'] as const) {
    for (const visibility of ['inherit', 'everyone', 'members_and_listed'] as const) {
      const open = visibility === 'everyone' || (visibility === 'inherit' && setting === 'everyone');
      table.push([setting, visibility, 'member', true]);
      table.push([setting, visibility, 'listed', true]);
      table.push([setting, visibility, 'see_all', true]);
      table.push([setting, visibility, 'other', open]);
    }
  }

  it('the table has every combination once (2 × 3 × 4)', () => {
    expect(table).toHaveLength(24);
  });

  it.each(table)('setting %s, Project %s, viewer %s → %s', (setting, visibility, relation, expected) => {
    const [viewer, project] = viewerAndProject(relation, visibility);
    expect(canSee(viewer, project, setting)).toBe(expected);
  });

  it.each(table)(
    'out of Organization reach, nothing a Project or a setting says widens it: setting %s, Project %s, viewer %s',
    (setting, visibility, relation) => {
      const [viewer, project] = viewerAndProject(relation, visibility, REACHES_A, [A, B]);
      expect(canSee(viewer, project, setting)).toBe(false);
    },
  );

  it('an internal Project is visible in all mode by the visibility rule, and to no restricted viewer at all', () => {
    const [member, internal] = viewerAndProject('member', 'members_and_listed', ALL, []);
    expect(canSee(member, internal, 'members')).toBe(true);
    const [other, internalToOther] = viewerAndProject('other', 'members_and_listed', ALL, []);
    expect(canSee(other, internalToOther, 'members')).toBe(false);
    const [restrictedSeeAll] = viewerAndProject('see_all', 'everyone', REACHES_A_AND_B, []);
    expect(canSee(restrictedSeeAll, internal, 'everyone')).toBe(false);
  });

  it.each(table)(
    'without `projects:read` nothing is visible, whatever surface asks: setting %s, Project %s, viewer %s',
    (setting, visibility, relation) => {
      const [viewer, project] = viewerAndProject(relation, visibility);
      expect(canSee({ ...viewer, canRead: false }, project, setting)).toBe(false);
    },
  );

  it('the system (no administrator, sees all, reaches all) is not narrowed', () => {
    const system: ProjectViewer = { adminUserId: null, canRead: true, seeAll: true, reach: ALL };
    expect(
      canSee(system, { organizationIds: [], visibility: 'members_and_listed', memberIds: [], viewerIds: [] }, 'members'),
    ).toBe(true);
  });
});
