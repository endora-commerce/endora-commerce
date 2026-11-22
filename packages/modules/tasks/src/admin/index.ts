/**
 * `tasks`' admin surface (`specs/163-projects-and-tasks/contracts/admin-surfaces.md`
 * §1–§3): 163's four screens and two sidebar rows — the Tasks screen and *My
 * Tasks* now each a list or a board (`specs/165-task-management/` User Story 3)
 * — and the four configuration screens behind one *Task configuration* row:
 * the workflow (User Story 2), the priorities and tags (User Story 9) and the
 * general settings (User Story 7), one route-tab strip across them since issue
 * #1557 (UX audit WORK-06).
 *
 * The palette actions are the manifest's (`src/manifest.ts`, §4). The zone
 * `task.detail.after` is mounted by `pages/TaskDetail.tsx`; this module
 * contributes nothing to it. It contributes the *Tasks* panel to an Order's
 * and a Quote Request's sidebar (`specs/165-task-management/` User Story 6,
 * `contracts/admin-surfaces.md` §3), and a *Tasks* tab, counting the open
 * Tasks, to an Opportunity's tab strip (`specs/183-record-tab-contributions/`
 * FR-012, FR-013).
 *
 * **This entry exports data and nothing else**; every component is a
 * dynamic-import factory, so none of the screens is in the admin's entry chunk.
 */
import {
  recordTabComponent,
  zoneComponent,
  type AdminContributions,
} from '@endora-commerce/admin-kit/contributions';
import {
  LEGACY_TASK_WORKFLOW_PATH,
  TASK_CONFIGURATION_PATH,
  TASK_GENERAL_SETTINGS_PATH,
  TASK_PRIORITIES_PATH,
  TASK_TAGS_PATH,
} from './lib/settings-paths.js';

/** The code that opens the lists and one Task; `GET /tasks`, `/tasks/mine` and `/tasks/:id` enforce it. */
const READ_PERMISSION = 'tasks:read';

/** The code that opens the create screen: `POST /tasks` is the one write it exists to make. */
const WRITE_PERMISSION = 'tasks:write';

/**
 * The code that opens the configuration screens: every write they make —
 * statuses and moves, priorities, tags, the time zone — is gated on it
 * (`specs/165-task-management/` FR-012, FR-041).
 */
const CONFIGURE_PERMISSION = 'tasks:configure';

const TASKS_PATH = '/tasks';

export const contributions: AdminContributions = {
  routes: [
    {
      path: TASKS_PATH,
      component: () => import('./pages/TasksPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // Both static segments are declared before `/:id`; `<Routes>` ranks them first anyway.
      path: `${TASKS_PATH}/mine`,
      component: () => import('./pages/MyTasksPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${TASKS_PATH}/new`,
      component: () => import('./pages/TaskCreate.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      // The configuration's first tab, the workflow, at the sidebar row's own
      // address (issue #1557) — the row is lit on every tab under it.
      path: TASK_CONFIGURATION_PATH,
      component: () => import('./pages/settings/TaskWorkflowPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      // The workflow's address before #1557, a redirect to the tab now.
      path: LEGACY_TASK_WORKFLOW_PATH,
      component: () => import('./pages/settings/TaskConfigurationRedirect.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      // The priority list (User Story 9, R-9), a tab of the configuration and a ⌘K action.
      path: TASK_PRIORITIES_PATH,
      component: () => import('./pages/settings/TaskPrioritiesPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      // The tag list (User Story 9, R-10), a tab of the configuration and a ⌘K action.
      path: TASK_TAGS_PATH,
      component: () => import('./pages/settings/TaskTagsPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      // The time zone (User Story 7, R-17), the configuration's *General* tab.
      path: TASK_GENERAL_SETTINGS_PATH,
      component: () => import('./pages/settings/TaskGeneralSettingsPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: `${TASKS_PATH}/:id`,
      component: () => import('./pages/TaskDetail.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: `${TASKS_PATH}/mine`,
      labelKey: 'nav.mine.label',
      icon: 'ListChecks',
      // The host's "Projects & tasks" section (research R-16), after Projects.
      section: 'work',
      weight: 200,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: TASKS_PATH,
      labelKey: 'nav.tasks.label',
      icon: 'ListChecks',
      section: 'work',
      weight: 210,
      requiredPermission: READ_PERMISSION,
    },
    {
      // The one configuration row (issue #1557), after Projects' (400)
      // (`specs/165-task-management/contracts/admin-surfaces.md` §1). Its
      // address is the first tab's and the prefix of the other three, so it
      // is lit on each of them.
      to: TASK_CONFIGURATION_PATH,
      labelKey: 'nav.configuration.label',
      icon: 'Settings',
      section: 'work',
      weight: 430,
      requiredPermission: CONFIGURE_PERMISSION,
    },
  ],
  // User Story 6 — the Tasks linked to a record, on that record's own screen.
  // One panel, three zones; each is one line: the zone, the chunk, the code the
  // panel's read enforces. The record's owner names no contributor, and the
  // zone renderer leaves the panel out while this module is off.
  zones: [
    zoneComponent('order.detail.sidebar', () => import('./zones/OrderTasksPanel.js'), { weight: 660, requiredPermission: READ_PERMISSION }),
    zoneComponent('quote_request.detail.sidebar', () => import('./zones/QuoteRequestTasksPanel.js'), { weight: 660, requiredPermission: READ_PERMISSION }),
    // Spec 183 (owner decision 2026-11-21): on an Opportunity the Tasks are a
    // tab of the record, with the open Tasks as its count (OQ-1 A). `tasks` is
    // part of the address (`?tab=tasks`) and is not renamed.
    recordTabComponent('opportunity.detail.tabs', () => import('./zones/OpportunityTasksTab.js'), {
      tab: { id: 'tasks', labelKey: 'recordTab.label', countLabelKey: 'recordTab.countLabel' },
      count: () => import('./zones/opportunity-task-count.js'),
      weight: 100,
      requiredPermission: READ_PERMISSION,
    }),
  ],
};
