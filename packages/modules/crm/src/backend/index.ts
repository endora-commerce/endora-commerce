import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminUserReadPort,
  CustomerAccountReadPort,
  OrderReadPort,
  OrderTransitionPort,
  OrganizationDetailsPort,
  SalesChannelAttributionRegistryPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import {
  effectiveState,
  lazyPort,
  type ModuleContext,
  type RequireAdminFactory,
} from '@endora-commerce/platform/kernel';
import { registerCrmLinkRoutes } from './routes/routes.links.js';
import { registerCrmOpportunityRoutes } from './routes/routes.opportunities.js';
import { registerCrmTransitionRoutes } from './routes/routes.transitions.js';
import { registerCrmWorkflowRoutes } from './routes/routes.workflow.js';
import { OpportunityLinkService } from './services/opportunity-link-service.js';
import { OpportunityService } from './services/opportunity-service.js';
import { OpportunityTransitionGuardRegistry } from './services/opportunity-transition-guard-registry.js';
import { OpportunityTransitionService } from './services/opportunity-transition-service.js';
import { OrderStatusPropagationService } from './services/order-status-propagation-service.js';
import { registerOpportunitySalesChannelAttributions } from './services/sales-channel-attributions.js';
import { WorkflowConfigService } from './services/workflow-config-service.js';
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

/** What this module reads from the container: the platform's services and its own. */
interface CrmCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly eventBus: EventBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly crmWorkflowReadService: WorkflowReadService;
  readonly crmWorkflowConfigService: WorkflowConfigService;
  readonly crmOpportunityService: OpportunityService;
  readonly crmOpportunityLinkService: OpportunityLinkService;
  readonly crmOrderStatusPropagationService: OrderStatusPropagationService;
  readonly crmOpportunityTransitionService: OpportunityTransitionService;
  readonly opportunityTransitionGuardRegistry: OpportunityTransitionGuardRegistry;
}

export function registerModule(ctx: ModuleContext): void {
  // --- Workflow ----------------------------------------------------------
  // Reading the configured workflow, and changing it. Every change is a
  // Command and re-validates the whole workflow before it commits.
  ctx.di.register({
    crmWorkflowReadService: ctx
      .asFunction(({ emFactory }: CrmCradle) => new WorkflowReadService(emFactory))
      .singleton(),
    crmWorkflowConfigService: ctx
      .asFunction(
        ({ commandBus, crmWorkflowReadService }: CrmCradle) =>
          new WorkflowConfigService(commandBus, crmWorkflowReadService),
      )
      .singleton(),
  });

  // --- Links ---------------------------------------------------------------
  // The documents linked to an Opportunity. `orders`' read port is the
  // integrity check for a link and the source of what a link renders; it is
  // resolved lazily, per call, and never captured in this singleton.
  ctx.di.register({
    crmOpportunityLinkService: ctx
      .asFunction(
        ({ emFactory, commandBus }: CrmCradle) =>
          new OpportunityLinkService({
            emFactory,
            commandBus,
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
          }),
      )
      .singleton(),
  });

  // --- Transitions ---------------------------------------------------------
  // The guard registry is a **contribution seam**: other modules push a guard
  // into it from a contribution-only boot hook, so it is registered ungated
  // (`ctx.di.register`, never `providePort`) — a boot hook that resolved a
  // gated port would stop the backend from starting whenever this module was
  // switched off. Nothing reads it while the module is off: the only reader is
  // the transition service, reached through this module's gated routes.
  //
  // Enumeration policy: a guard whose owner module is not effectively present
  // is skipped at dispatch. `effectiveState` is the kernel's one answer to
  // "is this module present", on both axes.
  ctx.di.register({
    opportunityTransitionGuardRegistry: ctx
      .asFunction(
        () => new OpportunityTransitionGuardRegistry((moduleId) => effectiveState.isPresent(moduleId)),
      )
      .singleton(),
    // Forward propagation: what an Opportunity's transition asks of its linked
    // Orders, through `orders`' own transition port — after the Opportunity's
    // commit, never inside it.
    crmOrderStatusPropagationService: ctx
      .asFunction(
        ({ emFactory, commandBus }: CrmCradle) =>
          new OrderStatusPropagationService({
            emFactory,
            commandBus,
            orderTransitions: lazyPort<OrderTransitionPort>(ctx, 'orderTransitionPort'),
            orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
          }),
      )
      .singleton(),
    crmOpportunityTransitionService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          eventBus,
          crmWorkflowReadService,
          opportunityTransitionGuardRegistry,
          crmOrderStatusPropagationService,
        }: CrmCradle) =>
          new OpportunityTransitionService({
            emFactory,
            commandBus,
            events: eventBus,
            workflowRead: crmWorkflowReadService,
            guards: opportunityTransitionGuardRegistry,
            propagation: crmOrderStatusPropagationService,
          }),
      )
      .singleton(),
  });

  // --- Opportunities -------------------------------------------------------
  // Create, list, read, edit, delete. The Organization, the contact person and
  // the assignee are read through their owners' ports.
  ctx.di.register({
    crmOpportunityService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          crmWorkflowReadService,
          crmOpportunityLinkService,
          crmOrderStatusPropagationService,
        }: CrmCradle) =>
          new OpportunityService({
            emFactory,
            commandBus,
            workflowRead: crmWorkflowReadService,
            organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
            adminUsers: lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort'),
            links: (opportunityId) => crmOpportunityLinkService.list(opportunityId),
            unresolvedPropagations: (opportunityId) =>
              crmOrderStatusPropagationService.listUnresolved(opportunityId),
          }),
      )
      .singleton(),
  });

  /**
   * The Sales Channel attribution counter — a **contribution** hook.
   *
   * It pushes an inert counter into `salesChannelAttributionRegistry`, an
   * ungated registry `sales_channels` owns, and carries no presence probe: the
   * registry honours an absent contributor on purpose, because the
   * Opportunities survive a deactivation and their foreign key is `on delete
   * restrict` — a probe here would turn a refusal naming this module into a raw
   * constraint violation, and would make switching the module back on need a
   * restart.
   */
  ctx.onBoot(() => {
    registerOpportunitySalesChannelAttributions(
      lazyPort<SalesChannelAttributionRegistryPort>(ctx, 'salesChannelAttributionRegistry'),
      ctx.cradle<CrmCradle>().emFactory,
    );
  });

  // --- Routes ----------------------------------------------------------------
  // All through `ctx.routes`, so every one of them stops with the module.
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CrmCradle>();
    const { requireAdmin } = cradle;
    await registerCrmWorkflowRoutes(app, {
      workflowReadService: cradle.crmWorkflowReadService,
      workflowConfigService: cradle.crmWorkflowConfigService,
      requireAdmin,
    });
    await registerCrmOpportunityRoutes(app, {
      opportunityService: cradle.crmOpportunityService,
      requireAdmin,
    });
    await registerCrmLinkRoutes(app, {
      linkService: cradle.crmOpportunityLinkService,
      requireAdmin,
    });
    await registerCrmTransitionRoutes(app, {
      transitionService: cradle.crmOpportunityTransitionService,
      propagationService: cradle.crmOrderStatusPropagationService,
      opportunityService: cradle.crmOpportunityService,
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
