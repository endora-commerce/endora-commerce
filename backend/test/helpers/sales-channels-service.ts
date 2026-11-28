import type {
  DictionaryValidator,
  SalesChannelAttributionRegistryPort,
} from '@endora-commerce/contracts';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import { CommandHookRegistry, buyerSelfServiceActionsFrom, type AuditLogService } from '@endora-commerce/platform/composition';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { SalesChannelsCacheInvalidation } from '@endora-commerce/platform/kernel';
import {
  SalesChannelsService,
  type ChannelBridgeRead,
} from '../../../packages/modules/sales_channels/src/backend/services/sales-channels.service.js';
import type { BackendServerHandle } from './test-server.js';
import { DISCOVERED_MANIFESTS } from '../../src/manifest-index.generated.js';

/**
 * `SalesChannelsService` over the composed container's own dependencies
 * (issue #251's shape, feature 075's occasion).
 *
 * Two of its arguments are not ones the service can be built without, because
 * production never built it without them. `dictionaryValidator` was optional
 * and always supplied, so the branch tests ran instead was a hand-written
 * `select "code" from "languages" / "currencies"` — a weaker check than the
 * validator's, raising the 422 codes feature 017 superseded, and two other
 * modules' tables named in raw SQL (D-87). `attributionRegistry` is the seam
 * that replaced the second such statement, and the absent form of a delete
 * guard is an open one.
 *
 * Resolving both from the container rather than stubbing them is what makes a
 * service built here the one `backend.ts` builds.
 *
 * `emFactory` stays the caller's, for the reason `promotionServiceFor` states:
 * these suites read back through the manager they wrote with.
 */
export function salesChannelsServiceFor(
  h: BackendServerHandle,
  emFactory: () => EntityManager,
  extras: {
    eventBus: EventBus;
    auditLogService?: AuditLogService;
    cache?: SalesChannelsCacheInvalidation;
  },
): SalesChannelsService {
  const cradle = h.container.cradle as never as {
    dictionaryValidator: DictionaryValidator;
    salesChannelAttributionRegistry: SalesChannelAttributionRegistryPort;
    salesChannelBridgeRegistry: ChannelBridgeRead;
    commandBus: CommandBus;
  };
  return new SalesChannelsService(
    emFactory,
    extras.eventBus,
    cradle.dictionaryValidator,
    cradle.salesChannelAttributionRegistry,
    // Feature 120 (FR-015) — resolved from the composed container for the same
    // reason the two above are: a service built here is then the one
    // `registerModule` builds, bridges included.
    cradle.salesChannelBridgeRegistry,
    // Issue #467 — identity writes are Commands, so the service is built with
    // the composed bus, as `registerModule` builds it. A caller still needs an
    // ambient TenantContext around `create` / `update`: the bus refuses without
    // one, which is the point.
    cradle.commandBus,
    extras.auditLogService,
    extras.cache,
  );
}

/**
 * A real {@link CommandBus} whose transaction runs **inside the test's own
 * transaction** (issue #467), for the `setupTestDb` suites that seed rows in a
 * `beginTx()` they roll back afterwards.
 *
 * The bus forks its EntityManager from `orm.em` and opens `em.transactional`
 * on the fork. Handing it an `orm` whose `em.fork()` answers the test's
 * transaction-bound manager turns that into a savepoint on the test's
 * connection, so the command sees the uncommitted seed rows, its audit row and
 * write land in the same transaction, and `rollbackTx()` removes all of it.
 * Everything else — actor resolution from the ambient TenantContext (fail
 * closed), the single audit row, the buffered event — is the bus's own code.
 */
export function transactionBoundCommandBus(
  em: () => EntityManager,
  audit: AuditPort,
  events: EventBus,
): CommandBus {
  const orm = { em: { fork: () => em() } } as unknown as MikroORM;
  // `specs/193-admin-form-extensions/` D-300.10 — the bus admits a Command's
  // `buyerSelfService` only on an action a manifest lists, as a composed root's
  // does: every manifest's list, and nothing else of the hook registry.
  const hooks = new CommandHookRegistry();
  hooks.seal({
    hookableActions: [],
    moduleDependencies: {},
    commandHookOrder: {},
    buyerSelfServiceActions: buyerSelfServiceActionsFrom(DISCOVERED_MANIFESTS.map((entry) => entry.manifest)),
  });
  return new CommandBus(orm, audit, events, { hooks });
}

