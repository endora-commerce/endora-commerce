import type { FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerNotification } from '../entities/customer-notification.entity.js';
import type {
  CustomerNotificationStore,
  NotificationPosition,
  NotificationVisibility,
} from './customer-notification-service.js';

/**
 * {@link CustomerNotificationStore} over MikroORM.
 *
 * Every statement goes through the ORM, so the `@CustomerScoped` filter of the
 * request's tenant context applies beneath the explicit account predicate
 * (Principle XI). The keyset is `(created_at desc, id desc)`, served by
 * `customer_notifications_reader_idx`; `created_at` is stored at millisecond
 * precision, the precision the cursor carries.
 */
export class MikroCustomerNotificationStore implements CustomerNotificationStore {
  constructor(private readonly emFactory: () => EntityManager) {}

  async list(
    visibility: NotificationVisibility,
    page: { readonly limit: number; readonly after: NotificationPosition | null },
  ): Promise<CustomerNotification[]> {
    const where: FilterQuery<CustomerNotification> =
      page.after === null
        ? visibleTo(visibility)
        : {
            $and: [
              visibleTo(visibility),
              {
                $or: [
                  { createdAt: { $lt: page.after.createdAt } },
                  { createdAt: page.after.createdAt, id: { $lt: page.after.id } },
                ],
              },
            ],
          };
    return this.emFactory().find(CustomerNotification, where, {
      orderBy: { createdAt: 'desc', id: 'desc' },
      limit: page.limit,
    });
  }

  countUnread(visibility: NotificationVisibility): Promise<number> {
    return this.emFactory().count(CustomerNotification, { ...visibleTo(visibility), readAt: null });
  }

  async markRead(visibility: NotificationVisibility, id: string, at: Date): Promise<boolean> {
    const em = this.emFactory();
    // command-coverage-ignore: customer notification bookkeeping — the buyer's
    // read mark, not an audited domain-state mutation (research R-19).
    const changed = await em.nativeUpdate(
      CustomerNotification,
      { ...visibleTo(visibility), id, readAt: null },
      { readAt: at },
    );
    if (changed > 0) return true;
    // Already read is still a success; an entry the reader cannot see is not.
    return (await em.count(CustomerNotification, { ...visibleTo(visibility), id })) > 0;
  }

  markAllRead(visibility: NotificationVisibility, at: Date): Promise<number> {
    // command-coverage-ignore: customer notification bookkeeping — the buyer's
    // read marks, not an audited domain-state mutation (research R-19).
    return this.emFactory().nativeUpdate(
      CustomerNotification,
      { ...visibleTo(visibility), readAt: null },
      { readAt: at },
    );
  }
}

/** The three predicates of the storefront API, §1 — the one statement of them. */
function visibleTo(visibility: NotificationVisibility): {
  customerAccountId: string;
  sourceModule: { $in: string[] };
  $or: Array<{ salesChannelId: string | null }>;
} {
  return {
    customerAccountId: visibility.customerAccountId,
    sourceModule: { $in: [...visibility.sourceModules] },
    $or: [{ salesChannelId: visibility.salesChannelId }, { salesChannelId: null }],
  };
}
