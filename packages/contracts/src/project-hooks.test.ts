import { describe, expect, it } from 'vitest';
import { PROJECT_HOOKABLE_ACTIONS } from './project-hooks.js';
import { toHookableActionDeclaration } from './command-hooks.js';

describe('PROJECT_HOOKABLE_ACTIONS (issue #1845)', () => {
  it('declares the eight Project writes and the merge start for both phases', () => {
    const both = ['beforeCommit', 'afterCommit'];
    expect(Object.values(PROJECT_HOOKABLE_ACTIONS).map(toHookableActionDeclaration)).toEqual([
      { action: 'projects.project.create', objectType: 'project', phases: both },
      { action: 'projects.project.update', objectType: 'project', phases: both },
      { action: 'projects.project.custom_fields_update', objectType: 'project', phases: both },
      { action: 'projects.project.organization_add', objectType: 'project', phases: both },
      { action: 'projects.project.organization_remove', objectType: 'project', phases: both },
      { action: 'projects.project.stage_move', objectType: 'project', phases: both },
      { action: 'projects.project.close', objectType: 'project', phases: both },
      { action: 'projects.project.reopen', objectType: 'project', phases: both },
      // `specs/192-organization-merge/` FR-061 — a deployment may veto a Project merge.
      { action: 'projects.project.merge.start', objectType: 'project', phases: both },
    ]);
  });
});
