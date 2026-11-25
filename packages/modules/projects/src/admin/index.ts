/**
 * `projects`' admin surface (`specs/163-projects-and-tasks/contracts/admin-surfaces.md`
 * §1–§3): User Story 1's three routes and sidebar row, User Story 3's
 * Templates screens and row, User Story 4's Project Roles and loss reasons,
 * User Story 6's Project panel on the screens of the records a Project
 * holds, User Story 10's analytics screen and row, and User Story 11's panel
 * of an Organization's Projects on the Organization screen.
 *
 * **Only what has shipped** — a sidebar or palette entry pointing at a route
 * that does not exist is a defect (Principle XVI). The palette actions are the
 * manifest's (`src/manifest.ts`, §4).
 *
 * **This entry exports data and nothing else**; every component is a
 * dynamic-import factory, so none of the screens is in the admin's entry chunk.
 */
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import {
  LEGACY_PROJECT_CONFIGURATION_PATHS,
  PROJECT_CONFIGURATION_PATH,
  PROJECT_LOSS_REASONS_PATH,
  PROJECT_ROLES_PATH,
  PROJECT_TEMPLATE_NEW_PATH,
  PROJECT_TEMPLATES_PATH,
  projectTemplatePath,
} from './lib/configuration-paths.js';

/** The code that opens the list and one Project; `GET /projects` and `GET /projects/:id` enforce it. */
const READ_PERMISSION = 'projects:read';

/** The code that opens the create screen: `POST /projects` is the one write it exists to make. */
const WRITE_PERMISSION = 'projects:write';

/**
 * The code that opens the configuration screens — Templates (User Story 3),
 * Project Roles and loss reasons (User Story 4): every write there is
 * `projects:configure`.
 */
const CONFIGURE_PERMISSION = 'projects:configure';

/** The code that opens analytics: every `GET /projects/analytics/*` enforces it. */
const ANALYTICS_PERMISSION = 'projects:analytics';

/** The code that opens the Project merge's flow and its merges list (`specs/192-organization-merge/` US6). */
const MERGE_PERMISSION = 'projects:merge';

const PROJECTS_PATH = '/projects';

export const contributions: AdminContributions = {
  routes: [
    {
      path: PROJECTS_PATH,
      component: () => import('./pages/ProjectsList.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // Declared before `/:id`; `<Routes>` ranks the static segment first anyway.
      path: `${PROJECTS_PATH}/new`,
      component: () => import('./pages/ProjectCreate.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    // The configuration (issue #1557): User Story 3's Templates as its first
    // tab, at the sidebar row's own address, then the Template editor and
    // User Story 4's two dictionaries under it. All declared before `/:id`,
    // whose segment would otherwise also match `settings`.
    {
      path: PROJECT_TEMPLATES_PATH,
      component: () => import('./pages/TemplatesList.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: PROJECT_TEMPLATE_NEW_PATH,
      component: () => import('./pages/TemplateEditor.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: projectTemplatePath(':id'),
      component: () => import('./pages/TemplateEditor.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: PROJECT_ROLES_PATH,
      component: () => import('./pages/RolesPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: PROJECT_LOSS_REASONS_PATH,
      component: () => import('./pages/LossReasonsPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    // The same screens' addresses before #1557, kept as redirects for
    // bookmarks and links already sent; on the code of the screens they open.
    ...LEGACY_PROJECT_CONFIGURATION_PATHS.map((path) => ({
      path,
      component: () => import('./pages/ProjectConfigurationRedirect.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    })),
    // User Story 10 — analytics. Declared before `/:id` too.
    {
      path: `${PROJECTS_PATH}/analytics`,
      component: () => import('./pages/AnalyticsPage.js'),
      requiredPermission: ANALYTICS_PERMISSION,
    },
    // `specs/192-organization-merge/` US6 (`contracts/project-merge.md` §4) —
    // the ⌘K action's screen, the merges list and one merge's progress. Static,
    // so ahead of `/:id`. The flow and the list are under the code their API
    // enforces; one merge's progress is read under `projects:read`, as
    // `GET /project-merges/:mergeId` is, and offers resume and cancel only to
    // `projects:merge`.
    {
      path: `${PROJECTS_PATH}/merge`,
      component: () => import('./pages/MergeProjectsPage.js'),
      requiredPermission: MERGE_PERMISSION,
    },
    {
      path: `${PROJECTS_PATH}/merges`,
      component: () => import('./pages/ProjectMergesPage.js'),
      requiredPermission: MERGE_PERMISSION,
    },
    {
      path: `${PROJECTS_PATH}/merges/:mergeId`,
      component: () => import('./pages/ProjectMergePage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      path: `${PROJECTS_PATH}/:id`,
      component: () => import('./pages/ProjectDetail.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: PROJECTS_PATH,
      labelKey: 'nav.projects.label',
      icon: 'ClipboardList',
      // The host's "Projects & tasks" section (research R-16); Projects first.
      section: 'work',
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: `${PROJECTS_PATH}/analytics`,
      labelKey: 'nav.analytics.label',
      icon: 'LineChart',
      // After My Tasks (200) and Tasks (210), before the configuration.
      section: 'work',
      weight: 300,
      requiredPermission: ANALYTICS_PERMISSION,
    },
    {
      // The one configuration row (issue #1557), where Templates' stood; Task
      // configuration (430) follows it.
      to: PROJECT_CONFIGURATION_PATH,
      labelKey: 'nav.configuration.label',
      icon: 'Settings',
      section: 'work',
      weight: 400,
      requiredPermission: CONFIGURE_PERMISSION,
    },
  ],
  // User Story 6 — the Project a record is in, on that record's own screen.
  // One panel, four zones — three of them sidebars (issue #1452); each is one line: the zone, the chunk, the code the
  // panel's read enforces. The record's owner names no contributor.
  zones: [
    zoneComponent('order.detail.sidebar', () => import('./zones/OrderProjectPanel.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
    zoneComponent('quote_request.detail.sidebar', () => import('./zones/QuoteRequestProjectPanel.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
    zoneComponent('opportunity.detail.sidebar', () => import('./zones/OpportunityProjectPanel.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
    zoneComponent('task.detail.after', () => import('./zones/TaskProjectPanel.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
    // User Story 11 — the Organization's Projects on the Organization screen.
    zoneComponent('organization.detail.sales', () => import('./zones/OrganizationProjects.js'), { weight: 650, requiredPermission: READ_PERMISSION }),
  ],
};
