/**
 * `crm`'s admin surface — four routes and two sidebar rows
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1–§2).
 *
 * **A sidebar group of its own.** Both rows sit in the host's `crm` section
 * (owner ruling of 2026-10-05), not under *Sales*: the section, its heading and
 * its position are the shell's, and a module joins it by naming it.
 *
 * **Only what User Story 1 ships.** The board, the tags screen and analytics
 * add their route and their row with the story that ships the page — a sidebar
 * or palette entry pointing at a route that does not exist is a defect
 * (Principle XVI).
 *
 * **This entry exports data and nothing else**; every component is a
 * dynamic-import factory, so none of the screens is in the admin's entry chunk.
 */
import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

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

const OPPORTUNITIES_PATH = '/crm/opportunities';
const WORKFLOW_PATH = '/crm/workflow';

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
      to: WORKFLOW_PATH,
      labelKey: 'nav.workflow.label',
      icon: 'ListChecks',
      section: 'crm',
      // Last of the group: configuration is visited rarely, and the rows the
      // later stories add (board 200, analytics 300, tags 400) sort before it.
      weight: 500,
      requiredPermission: CONFIGURE_PERMISSION,
    },
  ],
};
