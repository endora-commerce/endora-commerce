import type {
  DictionaryValidator,
  SalesChannelAttributionRegistryPort,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '@endora-commerce/platform/events';
import type { AuditLogService } from '@endora-commerce/platform/composition';
import type { SalesChannelsCacheInvalidation } from '@endora-commerce/platform/kernel';
import { SalesChannelsService } from '../../../packages/modules/sales_channels/src/backend/services/sales-channels.service.js';
import type { BackendServerHandle } from './test-server.js';

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
  };
  return new SalesChannelsService(
    emFactory,
    extras.eventBus,
    cradle.dictionaryValidator,
    cradle.salesChannelAttributionRegistry,
    extras.auditLogService,
    extras.cache,
  );
}
