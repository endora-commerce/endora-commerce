/**
 * `crm`'s admin surface — nine routes and four sidebar rows
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1–§2).
 *
 * **The list and the board are one page** (issue #1558, UX audit WORK-07,
 * owner decision DEC-13): `/crm/opportunities`, the board at `?view=board`,
 * one sidebar row. `/crm/board` stays as a redirect, for bookmarks and for the
 * palette's *Opportunity board*, whose `targetRoute` may carry no query string.
 *
 * **A sidebar group of its own.** All four rows sit in the host's `crm` section
 * (owner ruling of 2026-10-05), not under *Sales*: the section, its heading and
 * its position are the shell's, and a module joins it by naming it.
 *
 * **Only what has shipped** — User Story 1's four screens, User Story 7's
 * board, User Story 6's tag list, User Story 13's analytics and User Story 22's
 * calendar. Workflow and Tags are one *Configuration* row with route tabs
 * since issue #1557 (UX audit WORK-06). A sidebar or
 * palette entry pointing at a route that does not exist is a defect
 * (Principle XVI), so each arrived with the story that shipped its page.
 *
 * **This entry exports data and nothing else**; every component is a
 * dynamic-import factory, so none of the screens is in the admin's entry chunk.
 */
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';
import { CRM_CONFIGURATION_PATH, CRM_TAGS_PATH, LEGACY_CRM_TAGS_PATH } from './lib/configuration-paths.js';
import { WORKFLOW_SECTION_TABS } from './lib/workflow-sections.js';

/**
 * The code that opens the list and one Opportunity.
 * `routes/routes.opportunities.ts` gates both reads with it.
 */
const READ_PERMISSION = 'crm:read';

/**
 * The code that opens the create screen: `POST /api/v1/admin/crm/opportunities`
 * is the one write that screen exists to make, so an operator who cannot make
 * it is not offered the form.
 */
const WRITE_PERMISSION = 'crm:write';

/**
 * The code that opens the workflow configuration. `GET /workflow` itself is
 * `crm:read` — the list and the detail need the statuses to render — but every
 * control on this screen is a write gated by `crm:configure`, so the screen
 * opens on the code its purpose needs.
 */
const CONFIGURE_PERMISSION = 'crm:configure';

/**
 * The code that opens analytics, and the one every `GET /analytics/*` enforces:
 * a code of its own, because how the whole team is doing is not shown to
 * everybody who works an Opportunity.
 */
const ANALYTICS_PERMISSION = 'crm:analytics';

const OPPORTUNITIES_PATH = '/crm/opportunities';
const WORKFLOW_PATH = CRM_CONFIGURATION_PATH;
const BOARD_PATH = '/crm/board';
const ANALYTICS_PATH = '/crm/analytics';
const CALENDAR_PATH = '/crm/calendar';

export const contributions: AdminContributions = {
  routes: [
    {
      // The list, or at `?view=board` the board (issue #1558).
      path: OPPORTUNITIES_PATH,
      component: () => import('./pages/OpportunitiesPage.js'),
      requiredPermission: READ_PERMISSION,
      index: true,
    },
    {
      // Declared before `/:id`. `<Routes>` ranks by specificity, so the static
      // segment wins whatever the order; the order is kept so a reader does
      // not have to know that.
      path: `${OPPORTUNITIES_PATH}/new`,
      component: () => import('./pages/OpportunityCreatePage.js'),
      requiredPermission: WRITE_PERMISSION,
    },
    {
      path: `${OPPORTUNITIES_PATH}/:id`,
      component: () => import('./pages/OpportunityDetail.js'),
      requiredPermission: READ_PERMISSION,
    },
    // The workflow configuration's tabs (issue #1559): one route each, one
    // screen behind them all, on the code of the screen itself.
    ...WORKFLOW_SECTION_TABS.map((tab) => ({
      path: tab.path,
      component: () => import('./pages/WorkflowConfigPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    })),
    {
      // The board's former address, now `/crm/opportunities?view=board`: a
      // redirect on the code that reads the board (`GET /board` is `crm:read`).
      // Moving a card needs `crm:write`, which the view asks for itself.
      path: BOARD_PATH,
      component: () => import('./pages/OpportunityBoardRedirect.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      // The tag list is read by every screen (`GET /tags` is `crm:read`), but
      // this screen exists to manage it, and every control on it is a write
      // gated `crm:configure` — so it opens on that code, as Workflow does.
      // The configuration's *Tags* tab since issue #1557, under its row.
      path: CRM_TAGS_PATH,
      component: () => import('./pages/TagsPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      // The tag list's address before #1557, a redirect to the tab now.
      path: LEGACY_CRM_TAGS_PATH,
      component: () => import('./pages/CrmTagsRedirect.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: ANALYTICS_PATH,
      component: () => import('./pages/AnalyticsPage.js'),
      requiredPermission: ANALYTICS_PERMISSION,
    },
    {
      // `GET /calendar/events` is `crm:read`, and the screen holds no write:
      // an Event is added on its Opportunity. Whose Events a reader sees is
      // decided by the server from their reach, not by a code of its own.
      path: CALENDAR_PATH,
      component: () => import('./pages/CalendarPage.js'),
      requiredPermission: READ_PERMISSION,
    },
  ],
  nav: [
    {
      to: OPPORTUNITIES_PATH,
      labelKey: 'nav.opportunities.label',
      icon: 'CircleDollarSign',
      section: 'crm',
      weight: 100,
      requiredPermission: READ_PERMISSION,
    },
    {
      // After Opportunities (list and board, one row since issue #1558) and
      // before Analytics: the screens of every day first, then the manager's,
      // then the configuration.
      to: CALENDAR_PATH,
      labelKey: 'nav.calendar.label',
      icon: 'CalendarDays',
      section: 'crm',
      weight: 250,
      requiredPermission: READ_PERMISSION,
    },
    {
      to: ANALYTICS_PATH,
      labelKey: 'nav.analytics.label',
      icon: 'LineChart',
      section: 'crm',
      weight: 300,
      requiredPermission: ANALYTICS_PERMISSION,
    },
    {
      // The one configuration row (issue #1557): the workflow, its first tab,
      // with the tag list under it. Last of the group: configuration is
      // visited rarely.
      to: WORKFLOW_PATH,
      labelKey: 'nav.configuration.label',
      icon: 'Settings',
      section: 'crm',
      weight: 500,
      requiredPermission: CONFIGURE_PERMISSION,
    },
  ],
  // Panels CRM adds to screens other modules own. Each is one line: the zone,
  // the chunk, the code the panel's own reads enforce.
  zones: [
    zoneComponent('organization.detail.sales', () => import('./zones/OrganizationOpportunities.js'), { weight: 600, requiredPermission: READ_PERMISSION }),
    zoneComponent('order.detail.sidebar', () => import('./zones/OrderOpportunity.js'), { weight: 600, requiredPermission: READ_PERMISSION }),
    zoneComponent('quote_request.detail.sidebar', () => import('./zones/QuoteRequestOpportunity.js'), { weight: 600, requiredPermission: READ_PERMISSION }),
  ],
};
