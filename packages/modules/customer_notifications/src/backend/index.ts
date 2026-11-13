import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type {
  AdminI18nTranslatePort,
  CustomerAccountReadPort,
  CustomerNotificationRecordPort,
  SettingWriteValidatorRegistryPort,
} from '@endora-commerce/contracts';
import {
  effectiveState,
  lazyPort,
  type ModuleContext,
  type RequireCustomerGuard,
  type SettingsReadPort,
} from '@endora-commerce/platform/kernel';
import { CustomerNotification } from './entities/customer-notification.entity.js';
import { registerCustomerNotificationsStorefrontRoutes } from './routes.storefront.js';
import { createCustomerNotificationRecordPort } from './services/customer-notification-port.js';
import { CustomerNotificationService } from './services/customer-notification-service.js';
import { MikroCustomerNotificationStore } from './services/customer-notification-store.js';
import { createRetentionDaysValidator } from './services/retention-days-validator.js';
import {
  CustomerNotificationRetentionSweeper,
  RETENTION_DAYS_DEFAULT,
} from './services/retention-sweeper.js';
import { MikroRetentionStore } from './services/retention-store.js';
import { runRetentionSweepTick, startRetentionSweep, type RetentionSweepDeps } from './workers/retention-sweep-worker.js';

/**
 * `customer_notifications` — composed by the kernel container
 * (`specs/179-rfq-and-customer-notifications/` plan, WP-07).
 *
 * One published port, `customerNotificationRecordPort`, through which other
 * modules record entries; the storefront API through `ctx.routes`; the daily
 * retention sweep through `ctx.worker`; and the retention period's write rule,
 * contributed to `settings`' validator registry at boot. Every read of another
 * module is a `lazyPort` under a literal name, resolved per call.
 */

export interface CustomerNotificationsCradle {
  readonly emFactory: () => EntityManager;
  readonly requireCustomer: RequireCustomerGuard;
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly customerNotificationService: CustomerNotificationService;
  readonly customerNotificationsRetentionDeps: RetentionSweepDeps;
  readonly customerNotificationsRetentionTick: () => Promise<void>;
}

const MODULE_ID = 'customer_notifications';
const RETENTION_DAYS_CODE = 'customer_notifications.retention_days';

export function registerModule(ctx: ModuleContext): void {
  // --- The published port (`contracts/delivery-and-ports.md` §1) ------------
  // `providePort` gates it on this module's effective state: a producer that
  // skipped its presence check is refused with `MODULE_DISABLED` rather than
  // writing an entry nobody can read.
  ctx.di.providePort<CustomerNotificationRecordPort<EntityManager>>(
    'customerNotificationRecordPort',
    ctx
      .asFunction(({ emFactory }: CustomerNotificationsCradle) => createCustomerNotificationRecordPort({ emFactory }))
      .singleton(),
  );

  // --- The storefront half ---------------------------------------------------
  ctx.di.register({
    customerNotificationService: ctx
      .asFunction(
        ({ emFactory }: CustomerNotificationsCradle) =>
          new CustomerNotificationService({
            store: new MikroCustomerNotificationStore(emFactory),
            translate: (scope, key, language, params) =>
              lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService').translate(scope, key, language, params),
            // Research R-14 — an entry whose producer is off links to a surface
            // that is not there, so it is hidden, and it returns with the module.
            presentModules: () =>
              effectiveState
                .all()
                .map((state) => state.moduleId)
                .filter((moduleId) => effectiveState.isPresent(moduleId)),
          }),
      )
      .singleton(),
  });

  // --- Retention (research R-16) ---------------------------------------------
  ctx.di.register({
    customerNotificationsRetentionDeps: ctx
      .asFunction(
        ({ emFactory }: CustomerNotificationsCradle): RetentionSweepDeps => ({
          isPresent: () => effectiveState.isPresent(MODULE_ID),
          sweeper: new CustomerNotificationRetentionSweeper({
            store: new MikroRetentionStore(emFactory),
            retentionDays: () =>
              lazyPort<SettingsReadPort>(ctx, 'settingsReadPort').get(
                RETENTION_DAYS_CODE,
                null,
                z.number().catch(RETENTION_DAYS_DEFAULT),
              ),
            customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          }),
          log: ctx.log,
        }),
      )
      .singleton(),
    // The tick the consumer runs, named so a test drives exactly that.
    customerNotificationsRetentionTick: ctx
      .asFunction(
        ({ customerNotificationsRetentionDeps }: CustomerNotificationsCradle) =>
          () =>
            runRetentionSweepTick(customerNotificationsRetentionDeps),
      )
      .singleton(),
  });

  // A **contribution** hook and unprobed (module-activation item 3): the
  // registry itself skips a validator whose contributor is absent.
  ctx.onBoot(() => {
    lazyPort<SettingWriteValidatorRegistryPort>(ctx, 'settingWriteValidatorRegistry').register(
      createRetentionDaysValidator(),
    );
  });

  // --- Routes and the clock --------------------------------------------------
  // Through `ctx.routes`, which answers `503 MODULE_DISABLED` while the module
  // is off; the consumer through `ctx.worker`, which stops it with the module.
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CustomerNotificationsCradle>();
    await registerCustomerNotificationsStorefrontRoutes(app, {
      service: () => ctx.cradle<CustomerNotificationsCradle>().customerNotificationService,
      requireCustomer: (request) => ctx.cradle<CustomerNotificationsCradle>().requireCustomer(request),
    });
    await startRetentionSweep({
      deps: cradle.customerNotificationsRetentionDeps,
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
      onClose: (close) => {
        app.addHook('onClose', close);
      },
    });
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168) — the shape the platform reads
 * when the package is installed.
 */
export const entities = [CustomerNotification];
