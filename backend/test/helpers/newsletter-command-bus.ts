import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { transactionBoundCommandBus } from './sales-channels-service.js';

/**
 * The Command Bus a `setupTestDb` newsletter suite hands the subscriber
 * services (issue #1381), whose writes are Commands since then.
 *
 * It is {@link transactionBoundCommandBus} — the real bus, its transaction a
 * savepoint inside the test's own — with each run opened in a system scope:
 * these suites exercise the services directly, as the storefront's anonymous
 * routes and the workers do, and those run in system scope too. The bus still
 * resolves the actor, records the one entry and buffers the event itself.
 */
export function newsletterTestCommandBus(em: () => EntityManager, audit?: AuditPort): CommandBus {
  const bus = transactionBoundCommandBus(em, audit ?? new AuditLogService(em), new EventBus());
  return {
    run: (command) => withSystemScope('newsletter integration test: a subscriber write', () => bus.run(command)),
  } as CommandBus;
}
