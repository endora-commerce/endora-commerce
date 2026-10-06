/**
 * `crm`'s admin surface — seven routes and five sidebar rows
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1–§2).
 *
 * **A sidebar group of its own.** Both rows sit in the host's `crm` section
 * (owner ruling of 2026-10-05), not under *Sales*: the section, its heading and
 * its position are the shell's, and a module joins it by naming it.
 *
 * **Only what has shipped** — User Story 1's four screens, User Story 7's
 * board, User Story 6's tag list and User Story 13's analytics. A sidebar or
 * palette entry pointing at a route that does not exist is a defect
 * (Principle XVI), so each arrived with the story that shipped its page.
 *
 * **This entry exports data and nothing else**; every component is a
 * dynamic-import factory, so none of the screens is in the admin's entry chunk.
 */
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

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
const WORKFLOW_PATH = '/crm/workflow';
const BOARD_PATH = '/crm/board';
const TAGS_PATH = '/crm/tags';
const ANALYTICS_PATH = '/crm/analytics';

export const contributions: AdminContributions = {
  routes: [
    {
      path: OPPORTUNITIES_PATH,
      component: () => import('./pages/OpportunitiesList.js'),
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
    {
      path: WORKFLOW_PATH,
      component: () => import('./pages/WorkflowConfigPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      // Another view of the list, on the code that reads it: `GET /board` is
      // `crm:read`. Moving a card needs `crm:write`, which the screen asks for
      // itself — a reader sees the board without the controls.
      path: BOARD_PATH,
      component: () => import('./pages/OpportunityBoardPage.js'),
      requiredPermission: READ_PERMISSION,
    },
    {
      // The tag list is read by every screen (`GET /tags` is `crm:read`), but
      // this screen exists to manage it, and every control on it is a write
      // gated `crm:configure` — so it opens on that code, as Workflow does.
      path: TAGS_PATH,
      component: () => import('./pages/TagsPage.js'),
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      path: ANALYTICS_PATH,
      component: () => import('./pages/AnalyticsPage.js'),
      requiredPermission: ANALYTICS_PERMISSION,
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
      to: BOARD_PATH,
      labelKey: 'nav.board.label',
      icon: 'PanelLeft',
      section: 'crm',
      weight: 200,
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
      to: TAGS_PATH,
      labelKey: 'nav.tags.label',
      icon: 'Tag',
      section: 'crm',
      weight: 400,
      requiredPermission: CONFIGURE_PERMISSION,
    },
    {
      to: WORKFLOW_PATH,
      labelKey: 'nav.workflow.label',
      icon: 'ListChecks',
      section: 'crm',
      // Last of the group: configuration is visited rarely.
      weight: 500,
      requiredPermission: CONFIGURE_PERMISSION,
    },
  ],
  // Panels CRM adds to screens other modules own. Each is one line: the zone,
  // the chunk, the code the panel's own reads enforce.
  zones: [
    zoneComponent('organization.detail.after', () => import('./zones/OrganizationOpportunities.js'), { weight: 600, requiredPermission: READ_PERMISSION }),
    zoneComponent('order.detail.after', () => import('./zones/OrderOpportunity.js'), { weight: 600, requiredPermission: READ_PERMISSION }),
  ],
};
