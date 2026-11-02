import type { Redis } from 'ioredis';
import {
  CUSTOMER_ACCOUNT_ANONYMIZED_EVENT,
  FORMS_EVENTS,
  FORMS_STOREFRONT_CACHE_TAGS,
  FORMS_WEBHOOK_EVENT_TYPES,
  type FormChangedEvent,
  type FormEntrySubmittedEventV1,
  type AdminI18nTranslatePort,
  type CmsPageReadPort,
  type CustomerAccountAnonymizedEventV1,
  type CustomerAccountReadPort,
  type DictionaryValidator,
  type EmailMailerPort,
  type WebhookEventRegistryPort,
} from '@endora-commerce/contracts';
import type { CommandBus, CommandContext } from '@endora-commerce/platform/commands';
import { StorefrontRevalidator } from '@endora-commerce/platform/http';
import {
  effectiveState,
  lazyPort,
  type ModuleContext,
  type RequireAdminFactory,
  type SalesChannelResolutionPort,
  type SettingsReadPort,
} from '@endora-commerce/platform/kernel';
import { Form } from './entities/form.entity.js';
import { FormEntry } from './entities/form-entry.entity.js';
import { FormEntryNote } from './entities/form-entry-note.entity.js';
import { FormVersion } from './entities/form-version.entity.js';
import { registerEntryRoutes } from './routes/routes.entries.js';
import { registerFormRoutes } from './routes/routes.forms.js';
import { registerPublicFormRoutes } from './routes/routes.public.js';
import { CounterRepair } from './services/counter-repair.js';
import { EntryService } from './services/entry-service.js';
import { ErasureService } from './services/erasure-service.js';
import { FormService } from './services/form-service.js';
import { createFormsEnvironmentReader } from './services/forms-environment.js';
import type { FormsPorts } from './services/forms-ports.js';
import { bundleTranslate, createNotificationStore, NotificationDispatch } from './services/notification-dispatch.js';
import { CaptchaVerifier } from './services/submission/captcha-verifier.js';
import { RetentionService } from './services/retention-service.js';
import { PublicFormService } from './services/submission/submission-service.js';
import {
  FORMS_COUNTER_REPAIR_SCOPE_REASON,
  FORMS_ERASURE_SCOPE_REASON,
  FORMS_RETENTION_SCOPE_REASON,
  startFormsMaintenance,
  type FormsMaintenanceJobDeps,
} from './workers/forms-maintenance-worker.js';
import {
  createFormsNotificationProducer,
  enqueueEntryNotification,
  formsNotificationProcessor,
  startFormsNotifications,
  type FormsNotificationJobLike,
  type FormsNotificationProducer,
} from './workers/forms-notifications-worker.js';

/**
 * `forms` — composed by the kernel container (`specs/170-forms-module/` plan § Composition).
 *
 * **One file, deliberately**: `check:port-dependencies` reads a module's registrations from the
 * file that exports `registerModule` and from no other, so every registration, route, subscriber,
 * worker and boot hook of this module is written here, one delimited section per area, and a story
 * adds a section rather than a file.
 */

/** What this module reads from the container: the platform's services and its own. */
interface FormsCradle {
  readonly emFactory: () => CommandContext['em'];
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly formsPorts: FormsPorts;
  readonly formsStorefrontRevalidator: StorefrontRevalidator;
  readonly formsFormService: FormService;
  readonly formsPublicFormService: PublicFormService;
  readonly formsEntryService: EntryService;
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly formsNotificationProducer: FormsNotificationProducer;
  readonly formsNotificationDispatch: NotificationDispatch;
  readonly formsNotificationProcessor: (job: FormsNotificationJobLike) => Promise<unknown>;
  readonly formsRetentionService: RetentionService;
  readonly formsErasureService: ErasureService;
  readonly formsCounterRepair: CounterRepair;
  readonly formsMaintenanceDeps: FormsMaintenanceJobDeps;
}

export function registerModule(ctx: ModuleContext): void {
  // --- Foreign ports (plan § Composition 2) --------------------------------------------------
  // Every owner below but `cms` is a binding, non-deactivatable dependency of the manifest. Each
  // port is a `lazyPort` resolved per call — never a captured registration — under a literal name,
  // so `check:port-dependencies` sees the edge. `cms` is switchable: the one reader of its port
  // asks `cmsPresent()` first and answers the confirmation message without it.
  ctx.di.register({
    formsPorts: ctx
      .asFunction(
        (): FormsPorts => ({
          mailer: lazyPort<EmailMailerPort>(ctx, 'emailMailer'),
          i18n: lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService'),
          customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          dictionary: lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
          channels: lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort'),
          settings: lazyPort<SettingsReadPort>(ctx, 'settingsReadPort'),
          cmsPages: lazyPort<CmsPageReadPort>(ctx, 'cmsPageReadPort'),
          cmsPresent: () => effectiveState.isPresent('cms'),
        }),
      )
      .singleton(),
  });
  // --- end of Foreign ports --------------------------------------------------------------------

  // --- Own services (plan § Composition 1) -----------------------------------------------------
  // `formsStorefrontRevalidator` drops the storefront's cached public read of a form by tag
  // (FR-063, research R-21). A no-op unless `STOREFRONT_BASE_URL` and `REVALIDATE_SECRET` are
  // configured, and best-effort when they are: an unreachable storefront is logged and never fails
  // the write. Registered here, like `cms`' own, because the subscription that drives it belongs in
  // this file. The cradle type arrives with the first registration that reads the cradle.
  ctx.di.register({
    formsStorefrontRevalidator: ctx
      .asFunction(
        () =>
          new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          }),
      )
      .singleton(),
  });
  // --- end of Own services ---------------------------------------------------------------------

  // --- Forms (User Story 1, contracts/admin-api.md §1) ------------------------------------------
  // Build, version, close, reopen, duplicate and delete a form. Every write is a Command of
  // `form-commands.ts` (Constitution XIII); the warnings and the storefront languages are read per
  // call through the channel and settings ports.
  ctx.di.register({
    formsFormService: ctx
      .asFunction(
        ({ emFactory, commandBus, formsPorts, formsRetentionService }: FormsCradle) =>
          new FormService({
            emFactory,
            commandBus,
            environment: createFormsEnvironmentReader({ channels: formsPorts.channels, settings: formsPorts.settings }),
            retention: formsRetentionService,
          }),
      )
      .singleton(),
  });
  // --- end of Forms ----------------------------------------------------------------------------

  // --- Public form and submissions (User Story 2, contracts/public-api.md §1–§2) ----------------
  // The definition a shopper reads and the submission pipeline of research R-12. The submission is
  // the Command `forms.entry.submit` (Constitution XIII); attribution reads `customer_accounts`, a
  // "show a CMS page" confirmation reads `cms` only while it is present — both through `formsPorts`.
  // The CAPTCHA check (research R-14) reads its settings through the settings port on every call.
  ctx.di.register({
    formsPublicFormService: ctx
      .asFunction(
        ({ emFactory, commandBus, formsPorts }: FormsCradle) =>
          new PublicFormService({
            emFactory,
            commandBus,
            ports: formsPorts,
            environment: createFormsEnvironmentReader({ channels: formsPorts.channels, settings: formsPorts.settings }),
            captcha: new CaptchaVerifier({ settings: formsPorts.settings }),
          }),
      )
      .singleton(),
  });
  // --- end of Public form and submissions -------------------------------------------------------

  // --- Entries (User Story 4, contracts/admin-api.md §2) ----------------------------------------
  // Reading, processing, deleting and exporting entries. Every read is the tenancy guard's
  // (`FormEntry` is `@CustomerScoped`); every write is a Command of `entry-commands.ts`. The export
  // names each row's channel by its code, read per call through the channel port.
  ctx.di.register({
    formsEntryService: ctx
      .asFunction(
        ({ emFactory, commandBus, formsPorts }: FormsCradle) =>
          new EntryService({ emFactory, commandBus, channels: formsPorts.channels }),
      )
      .singleton(),
  });
  // --- end of Entries ----------------------------------------------------------------------------

  // --- Notifications (User Story 5, research R-13) ------------------------------------------------
  // The shop notification and the confirmation, sent from the `forms-notifications` queue through
  // the platform mailer. The producer is built on the host's queue connection (none on the shared
  // test server, which enqueues nothing); the dispatch is the worker's body, and the processor is it
  // inside the system scope — what the worker runs, and what a test drives.
  ctx.di.register({
    formsNotificationProducer: ctx
      .asFunction(({ moduleQueueRedis }: FormsCradle) => createFormsNotificationProducer(moduleQueueRedis))
      .singleton(),
    formsNotificationDispatch: ctx
      .asFunction(
        ({ emFactory, formsPorts }: FormsCradle) =>
          new NotificationDispatch({
            isPresent: () => effectiveState.isPresent('forms'),
            store: createNotificationStore(emFactory),
            mailer: formsPorts.mailer,
            translate: bundleTranslate(formsPorts.i18n),
          }),
      )
      .singleton(),
    formsNotificationProcessor: ctx
      .asFunction(({ formsNotificationDispatch }: FormsCradle) => formsNotificationProcessor(formsNotificationDispatch))
      .singleton(),
  });

  /**
   * Every accepted entry asks for its e-mails: the job is the entry's id and the language of its
   * channel — never an answer (FR-055). Dispatched after the submit Command commits; a failure to
   * enqueue is the bus's to log and never reaches the shopper, whose answer was already written
   * (FR-059). `ctx.subscribe` stops it with the module, so no job is created while it is off.
   */
  ctx.subscribe(FORMS_EVENTS.ENTRY_SUBMITTED, (payload) => {
    const cradle = ctx.cradle<FormsCradle>();
    return enqueueEntryNotification(
      {
        producer: cradle.formsNotificationProducer,
        channelDefaultLanguage: async (id) => (await cradle.formsPorts.channels.getById(id))?.defaultLanguage ?? null,
      },
      payload as FormEntrySubmittedEventV1,
    );
  });

  // The consumer: attached where `app.log` exists and through `ctx.worker`, which stops it with the
  // module and puts back a job taken while it is off. Built only where the host says this process
  // consumes queues and offers a connection.
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<FormsCradle>();
    app.addHook('onClose', () => cradle.formsNotificationProducer.close());
    startFormsNotifications({
      dispatch: cradle.formsNotificationDispatch,
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
    });
  });
  // --- end of Notifications ------------------------------------------------------------------------

  // --- Retention, erasure and the maintenance clock (User Story 9, research R-17, R-20) --------
  // Retention deletes the entries past their form's period; erasure removes the entries of an
  // anonymised customer account (FR-047); counter repair recomputes each form's non-spam count.
  // Every deletion is a Command (Constitution XIII). The three run as passes of one
  // `forms-maintenance` tick every fifteen minutes, presence first, each probe outside any scope and
  // its work inside `enterSystemScope`; the consumer is built only where the host runs workers.
  ctx.di.register({
    formsRetentionService: ctx
      .asFunction(({ emFactory, commandBus }: FormsCradle) => new RetentionService({ emFactory, commandBus }))
      .singleton(),
    formsErasureService: ctx
      .asFunction(
        ({ emFactory, commandBus, formsPorts }: FormsCradle) =>
          new ErasureService({ emFactory, commandBus, customerAccounts: formsPorts.customerAccounts }),
      )
      .singleton(),
    formsCounterRepair: ctx.asFunction(({ emFactory }: FormsCradle) => new CounterRepair(emFactory)).singleton(),
    formsMaintenanceDeps: ctx
      .asFunction(
        ({ formsRetentionService, formsErasureService, formsCounterRepair }: FormsCradle): FormsMaintenanceJobDeps => ({
          isPresent: () => effectiveState.isPresent('forms'),
          retention: {
            scopeReason: FORMS_RETENTION_SCOPE_REASON,
            hasWork: () => formsRetentionService.hasWork(),
            run: (now) => formsRetentionService.run(now),
          },
          erasure: {
            scopeReason: FORMS_ERASURE_SCOPE_REASON,
            hasWork: () => formsErasureService.hasWork(),
            run: () => formsErasureService.reconcile(),
          },
          counters: {
            scopeReason: FORMS_COUNTER_REPAIR_SCOPE_REASON,
            hasWork: () => formsCounterRepair.hasWork(),
            run: () => formsCounterRepair.run(),
          },
          log: ctx.log,
        }),
      )
      .singleton(),
  });

  /**
   * `customer_account.anonymized.v1` (FR-047, contracts/events-and-webhook.md §3): the account's
   * entries and their notes are erased within the sweep step that anonymised it — `customer_accounts`
   * dispatches in a bus scope the sweep awaits. A failure is the bus's to log and never fails the
   * sweep; the maintenance reconciliation erases what it left. `ctx.subscribe` stops it with the
   * module, and the reconciliation catches an anonymisation it missed while off.
   */
  ctx.subscribe(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT, async (payload) => {
    const { customerAccountId } = payload as CustomerAccountAnonymizedEventV1;
    await ctx.cradle<FormsCradle>().formsErasureService.eraseForAccount(customerAccountId);
  });

  ctx.routes(async (app) => {
    const cradle = ctx.cradle<FormsCradle>();
    await startFormsMaintenance({
      deps: cradle.formsMaintenanceDeps,
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
      onClose: (close) => app.addHook('onClose', close),
    });
  });
  // --- end of Retention, erasure and the maintenance clock --------------------------------------

  // --- Routes (plan § Composition 3) -----------------------------------------------------------
  // Through `ctx.routes`, which answers 503 `MODULE_DISABLED` while the module is off. The entries
  // routes sit under `/api/v1/admin/forms/entries`, static segments the router prefers to `/:id`.
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<FormsCradle>();
    // The route registrar is where `app.log` exists, so the revalidator picks it up here.
    cradle.formsStorefrontRevalidator.setLogger(app.log);
    await registerFormRoutes(app, { formService: cradle.formsFormService, requireAdmin: cradle.requireAdmin });
    await registerPublicFormRoutes(app, { publicFormService: cradle.formsPublicFormService });
    await registerEntryRoutes(app, { entryService: cradle.formsEntryService, requireAdmin: cradle.requireAdmin });
  });
  // --- end of Routes ---------------------------------------------------------------------------

  // --- Storefront revalidation (FR-063, research R-21) -----------------------------------------
  /**
   * A committed change of what the public read answers — publish, close, reopen, delete — drops
   * the storefront's cached read of that form by its tag, so the next page render reads the new
   * state rather than the next minute's. Dispatched after the Command commits and awaited by the
   * bus scope (the write answers once the storefront has been told); the revalidator never throws
   * and gives up after its timeout. `ctx.subscribe` stops it with the module.
   */
  ctx.subscribe(FORMS_EVENTS.FORM_CHANGED, (payload) => {
    const { formId } = payload as FormChangedEvent;
    return ctx.cradle<FormsCradle>().formsStorefrontRevalidator.revalidate([FORMS_STOREFRONT_CACHE_TAGS.form(formId)]);
  });
  // --- end of Storefront revalidation ----------------------------------------------------------

  // --- Outbound webhooks (plan § Composition 6, contracts/events-and-webhook.md §1) ----------
  /**
   * The event this module offers to outbound webhooks — a **contribution** hook, and the module's
   * only boot hook.
   *
   * It pushes `forms.entry.submitted.v1` into `webhookEventRegistry`, an ungated registry `webhooks`
   * owns, and carries no presence probe: the registry leaves out a contributor that is not present
   * when it is read, so a push made while this module is off costs nothing, and one skipped here
   * would make switching the module on need a restart before its event was offered. `webhooks`
   * bridges the type through its own gated subscription and sends the event payload whole — which
   * is why it has a strict schema in the contracts package.
   *
   * Nothing is read back and nothing degrades: with `webhooks` off the event is emitted as ever and
   * nobody is told; in an instance without `webhooks` the push is dropped by the platform.
   */
  ctx.onBoot(() => {
    const registry = lazyPort<WebhookEventRegistryPort>(ctx, 'webhookEventRegistry');
    for (const eventType of FORMS_WEBHOOK_EVENT_TYPES) registry.register({ ownerModuleId: 'forms', eventType });
  });
  // --- end of Outbound webhooks ------------------------------------------------------------------
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and no named class export (D-168). The platform reads this array when
 * the package is installed; a missing array is answered with zero entities
 * registered and no error anywhere.
 *
 * `Form` and `FormVersion` are `@GlobalEntity` operator content; `FormEntry` is
 * `@CustomerScoped` with an organisation column, and `FormEntryNote` is scoped
 * through its entry (`research.md` § Principle XI review).
 */
export const entities = [Form, FormVersion, FormEntry, FormEntryNote];
