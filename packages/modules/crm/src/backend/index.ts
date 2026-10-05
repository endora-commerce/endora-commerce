import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext, RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { registerCrmWorkflowRoutes } from './routes/routes.workflow.js';
import { WorkflowReadService } from './services/workflow-read-service.js';
import { CrmOpportunity } from './entities/crm-opportunity.entity.js';
import { CrmOpportunityAttachment } from './entities/crm-opportunity-attachment.entity.js';
import { CrmOpportunityComment } from './entities/crm-opportunity-comment.entity.js';
import { CrmOpportunityLink } from './entities/crm-opportunity-link.entity.js';
import { CrmOpportunityReference } from './entities/crm-opportunity-reference.entity.js';
import { CrmOpportunityStatus } from './entities/crm-opportunity-status.entity.js';
import { CrmOpportunityStatusHistory } from './entities/crm-opportunity-status-history.entity.js';
import { CrmOpportunityStatusTransition } from './entities/crm-opportunity-status-transition.entity.js';
import { CrmOpportunityTag } from './entities/crm-opportunity-tag.entity.js';
import { CrmOrderStatusMapping } from './entities/crm-order-status-mapping.entity.js';
import { CrmStatusPropagation } from './entities/crm-status-propagation.entity.js';
import { CrmTag } from './entities/crm-tag.entity.js';
import { CrmValueCountingStatus } from './entities/crm-value-counting-status.entity.js';

/**
 * `crm` — composed by the kernel container.
 *
 * **One file, deliberately.** The plan drew one `compose/<area>.ts` per area,
 * each handed this `ModuleContext`. `check:port-dependencies` reads a module's
 * registrations from the file that exports `registerModule` and from no other:
 * a `ctx.di.register` in a helper file is reported as a name no module
 * registers, and a `ctx.di.providePort` there would not read as a gated port at
 * all — which is the fail-open direction. So every registration, route,
 * subscriber, worker and boot hook of this module is written in this file, one
 * section per area, and a story adds a section rather than a file
 * (`specs/143-crm-sales-opportunities/research.md`, Implementation notes N-6).
 *
 * The cross-module names are declared structurally, here, per section.
 */

/** What the workflow section reads from the container. */
interface CrmWorkflowCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly crmWorkflowReadService: WorkflowReadService;
}

export function registerModule(ctx: ModuleContext): void {
  // --- Workflow ----------------------------------------------------------
  // The service that reads the configured workflow, and its routes. The routes
  // go through `ctx.routes`, so they stop with the module.
  ctx.di.register({
    crmWorkflowReadService: ctx
      .asFunction(({ emFactory }: CrmWorkflowCradle) => new WorkflowReadService(emFactory))
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { requireAdmin, crmWorkflowReadService } = ctx.cradle<CrmWorkflowCradle>();
    await registerCrmWorkflowRoutes(app, {
      workflowReadService: crmWorkflowReadService,
      requireAdmin,
    });
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and no named class export (D-168). The platform reads this array when
 * the package is installed; a missing array is answered with zero entities
 * registered and no error anywhere.
 *
 * Thirteen classes, the whole schema of the module: the Opportunity
 * (`@OrgScoped`), its seven children (`@TransitivelyScoped` through it) and
 * five configuration tables (`@GlobalEntity`). Every class is here before the
 * first user story, so that no later story changes a generated registry.
 */
export const entities = [
  CrmOpportunity,
  CrmOpportunityAttachment,
  CrmOpportunityComment,
  CrmOpportunityLink,
  CrmOpportunityReference,
  CrmOpportunityStatus,
  CrmOpportunityStatusHistory,
  CrmOpportunityStatusTransition,
  CrmOpportunityTag,
  CrmOrderStatusMapping,
  CrmStatusPropagation,
  CrmTag,
  CrmValueCountingStatus,
];
