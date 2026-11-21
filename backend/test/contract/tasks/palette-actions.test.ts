import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as tasksAdmin } from '@endora-commerce/mod-tasks/admin';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  actionRouteFindings,
  expectDeclared,
  expectLabels,
  expectTargetsOwnRoutes,
  type ExpectedAction,
} from '../projects/palette-actions-shared.js';

/**
 * Tasks under ⌘K (`specs/163-projects-and-tasks/` FR-041, T130;
 * `contracts/admin-surfaces.md` §4): the actions, each on a screen of the
 * module's own, gated by the code that screen and its API enforce. The ids are
 * the slugs §4's `tasks.open`, `tasks.mine` and `tasks.new` stand for.
 */
const EXPECTED: readonly ExpectedAction[] = [
  {
    id: 'open-tasks',
    route: '/tasks',
    permission: 'tasks:read',
    icon: 'ListChecks',
    label: { en: 'Tasks', pl: 'Zadania' },
  },
  {
    id: 'open-my-tasks',
    route: '/tasks/mine',
    permission: 'tasks:read',
    icon: 'ListChecks',
    label: { en: 'My tasks', pl: 'Moje zadania' },
  },
  {
    id: 'new-task',
    route: '/tasks/new',
    permission: 'tasks:write',
    icon: 'Plus',
    label: { en: 'New task', pl: 'Nowe zadanie' },
  },
  {
    // `specs/165-task-management/contracts/admin-surfaces.md` §4 (T047).
    id: 'open-task-workflow',
    route: '/tasks/settings',
    permission: 'tasks:configure',
    icon: 'Settings',
    label: { en: 'Task statuses and workflow', pl: 'Statusy i przejścia zadań' },
  },
  {
    // `specs/165-task-management/contracts/admin-surfaces.md` §4 (T083).
    id: 'open-task-priorities',
    route: '/tasks/settings/priorities',
    permission: 'tasks:configure',
    icon: 'Settings',
    label: { en: 'Task priorities', pl: 'Priorytety zadań' },
  },
  {
    id: 'open-task-tags',
    route: '/tasks/settings/tags',
    permission: 'tasks:configure',
    icon: 'Settings',
    label: { en: 'Task tags', pl: 'Etykiety zadań' },
  },
  {
    // The general settings screen (the time zone), CI palette-coverage (PR #533).
    id: 'open-task-general-settings',
    route: '/tasks/settings/general',
    permission: 'tasks:configure',
    icon: 'Settings',
    label: { en: 'Task general settings', pl: 'Ogólne ustawienia zadań' },
  },
];

describe('tasks palette actions (163 FR-041, T130)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('declares the actions of §4', () => {
    expectDeclared('tasks', EXPECTED);
  });

  it('each opens a screen of the module’s own admin layer, on the action’s code', () => {
    expectTargetsOwnRoutes('tasks', tasksAdmin);
  });

  it('each resolves to a real API route with that route’s permission (check:action-route-permissions)', () => {
    const result = actionRouteFindings('tasks');
    expect(result.violations).toEqual([]);
    expect(result.stale).toEqual([]);
    // The configuration screens are `tasks:configure` in the admin, while the
    // lists they load are read-gated: the status picker, the priority picker,
    // the tag picker, the filters and the board read them too. The check's
    // ledger records those four disagreements, and only them (165 T047, T083);
    // the general settings screen reads the read-gated time zone the same way.
    expect(result.ledgered.map((finding) => finding.actionId).sort()).toEqual([
      'open-task-general-settings',
      'open-task-priorities',
      'open-task-tags',
      'open-task-workflow',
    ]);
  });

  it('serves them, labelled in English and Polish', async () => {
    await expectLabels(h, 'tasks', EXPECTED);
  });
});
