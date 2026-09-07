/**
 * The fixture deployment: one overlay tree that exercises **every** seam a
 * deployment can use (SC-008).
 *
 * This repository holds two overlay modules, one decoration, one interceptor and
 * one registration between them, and asserts almost nothing about the rest. A
 * check whose acceptance instrument is that tree is a check proving that three
 * of its nine kinds work. So the acceptance instrument is here.
 *
 * **It is source text, and it enters at the top of the analysis** (issue #130).
 * `deriveDivergence` takes the deployment's sources, the route table, the owner
 * map, the declaration and `ModuleContext`'s members, and every classification —
 * the receiver, the seam spelling, the literal resolution, the owner attribution,
 * the rung — runs over what is handed in. A fixture that entered lower, with the
 * sites already resolved, would prove the reporter and leave the whole walk
 * unproven, which is the family issue #130 is about.
 *
 * A tree on disk was the alternative and was rejected for two measured reasons:
 * `.ts` files under `backend/test/` are type-checked and linted, so a fixture
 * exercising a *refused* shape (a computed decoration name) would have to be
 * written to compile; and a third real deployment under `backend/src/apps/`
 * acquires committed artefacts, a permission inventory run and an off-state
 * proof, none of which this feature asked for.
 */
import {
  deriveDivergence,
  moduleContextSeams,
  routeIdentities,
  type DivergenceInput,
  type DivergenceResult,
  type OverlaySource,
} from '../../scripts/lib/divergence.js';

/**
 * `ModuleContext`'s interface, as a fixture.
 *
 * The seam population is read from the platform's source in a real run; here it
 * is written out, because a fixture that imported the real file would make every
 * case below depend on a file this feature is otherwise not about — and because
 * the `unclassified-seam` proof needs a member the rung table does not name,
 * which cannot be added to the platform.
 */
export const MODULE_CONTEXT_SOURCE = `
export interface ModuleContext {
  readonly module: { readonly id: string; readonly version: string };
  readonly di: {
    register(registrations: Record<string, Registration>): void;
    providePort<T>(name: string, registration: Registration<T>): void;
    decorate<T>(name: string, wrap: (inner: T) => T): void;
  };
  asClass<T>(ctor: Constructor<T>): RegistrationBuilder<T>;
  asFunction<T, C>(fn: (cradle: C) => T): RegistrationBuilder<T>;
  asValue<T>(value: T): Registration<T>;
  cradle<C extends object>(): C;
  routes(register: (app: FastifyInstance) => void): void;
  ungatedRoutes(reason: string, register: (app: FastifyInstance) => void): void;
  rootPlugin(reason: string, plugin: ModulePlugin): void;
  worker<W extends Worker>(worker: W): W;
  subscribe(event: string, handler: (payload: unknown) => void): void;
  interceptors(entries: readonly InterceptorRegistration[]): void;
  onBoot(hook: ModuleBootHook): void;
  readonly log: PlatformLogger;
}
`;

/**
 * The fixture deployment's overlay module — every recorded seam, once.
 *
 * Nine kinds; seven of them appear here (`omission` comes from the declaration
 * and `port-consumed` from the `lazyPort` call below, which is in this same
 * file). The three `own-surface` seams are here too, deliberately: they must
 * produce **no** entry, and a fixture without them cannot prove that.
 */
export const FIXTURE_OVERLAY = `
import type { ModuleContext } from '../../../../kernel/index.js';
import { lazyPort } from '../../../../kernel/lazy-port.js';
import { Worker } from 'bullmq';

const REBATE_EVENT = 'orders.placed';

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    acmeRebateService: ctx.asClass(AcmeRebateService).singleton(),
  });

  ctx.di.providePort('acmeRebatePort', ctx.asClass(AcmeRebateService).singleton());

  ctx.di.decorate<Pricing>('pricingService', (inner) => wrap(inner));

  ctx.subscribe(REBATE_EVENT, async (payload) => {
    await handle(payload);
  });

  ctx.interceptors([
    {
      id: 'require-po-number',
      target: 'POST /api/v1/orders',
      phase: 'pre',
      order: 10,
      handler: async (input) => input,
    },
  ]);

  ctx.rootPlugin('Acme stamps every response with its contract id.', acmePlugin);

  ctx.worker(new Worker('acme-rebate-sweep', async (job) => handleJob(job)));

  // The three seams that are a module's own surface: they must produce no entry.
  ctx.routes(async (app) => {
    app.get('/api/v1/admin/acme/ping', async () => ({ pong: true }));
  });
  ctx.ungatedRoutes('A liveness probe cannot be gated on the module it reports on.', async (app) => {
    app.get('/api/v1/acme/healthz', async () => ({ ok: true }));
  });
  ctx.onBoot(async () => {
    await seed();
  });

  const orders = lazyPort<OrderReadPort>(ctx, 'orderReadPort');
  void orders;
}
`;

/** Every route registration the fixture composition serves. */
export const FIXTURE_ROUTES = `
export function registerModule(ctx: ModuleContext): void {
  ctx.routes(async (app) => {
    app.post('/api/v1/orders', async () => ({}));
  });
}
`;

/** The nine keys the fixture's own tree derives, with a sentence each. */
export const FIXTURE_REASONS: Readonly<Record<string, string>> = {
  'registration:acme_overlay:acmeRebateService':
    'Core registers no rebate service; this one is Acme’s own and exists to hold the ' +
    'per-contract rebate table the wrap below reads.',
  'port-provided:acme_overlay:acmeRebatePort':
    'Published so that Acme’s second overlay module can read the rebate table without ' +
    'importing this module’s internals, which is the rule a core module is held to as well.',
  'decoration:acme_overlay:pricingService':
    'Core resolves a line price from the price lists a customer is entitled to; Acme applies ' +
    'a per-contract rebate after list price, delegating to core so its fixes still arrive.',
  'subscription:acme_overlay:orders.placed':
    'Core places the order and emits; Acme mirrors the line totals into its own ledger. It ' +
    'observes and changes nothing core did.',
  'interceptor:acme_overlay:POST /api/v1/orders#pre':
    'Core accepts an order with no purchase-order number; Acme’s finance system cannot, so ' +
    'the interceptor refuses such a submission before the handler runs.',
  'root-plugin:acme_overlay:Acme stamps every response with its contract id.':
    'Core stamps no contract id; Acme’s gateway requires one on every response, and a root ' +
    'plugin is the only seam that reaches every module’s routes at once.',
  'worker:acme_overlay:acme-rebate-sweep':
    'Core runs no such queue; this one recomputes Acme’s rebate table nightly and is Acme’s ' +
    'own work on Acme’s own data.',
  'port-consumed:acme_overlay:orderReadPort':
    'Core owns the orders read model and publishes it as a port; Acme reads it rather than ' +
    'querying the tables, so a schema change behind the port does not reach this deployment.',
  'omission:core:blog':
    'Acme publishes its editorial content from its own CMS and ships no blog, so nothing in ' +
    'this deployment would ever create a post.',
};

export interface FixtureOptions {
  /** Overlay sources, defaulting to the whole-seam module above. */
  readonly sources?: readonly OverlaySource[];
  /** Owner map, defaulting to one that resolves every subject the fixture names. */
  readonly owners?: ReadonlyMap<string, string>;
  readonly rootSupplied?: ReadonlySet<string>;
  /** Route sources the composition serves; defaults to the one the fixture targets. */
  readonly routeSources?: readonly { file: string; text: string; moduleId: string | null }[];
  readonly reasons?: Readonly<Record<string, string>>;
  readonly decorationOrder?: Readonly<Record<string, readonly string[]>>;
  readonly omittedModules?: ReadonlyArray<{ moduleId: string; reason: string }>;
  readonly seams?: readonly string[];
  readonly overlayModules?: readonly string[];
}

const DEFAULT_OWNERS = new Map<string, string>([
  ['pricingService', 'price_lists'],
  ['orderReadPort', 'orders'],
  ['acmeRebateService', 'acme_overlay'],
  ['acmeRebatePort', 'acme_overlay'],
]);

/** The whole derivation over the fixture deployment — SC-008's instrument. */
export function fixtureDivergence(options: FixtureOptions = {}): DivergenceResult {
  const sources: readonly OverlaySource[] = options.sources ?? [
    {
      moduleId: 'acme_overlay',
      file: 'backend/src/apps/acme/modules/acme_overlay/backend.ts',
      text: FIXTURE_OVERLAY,
    },
  ];
  const routeSources = options.routeSources ?? [
    { file: 'modules/orders/routes.ts', text: FIXTURE_ROUTES, moduleId: 'orders' },
  ];
  const input: DivergenceInput = {
    deployment: 'acme',
    overlayRoot: 'backend/src/apps/acme/modules',
    overlayModules: options.overlayModules ?? ['acme_overlay'],
    sources,
    routes: routeIdentities(routeSources),
    owners: options.owners ?? DEFAULT_OWNERS,
    rootSupplied: options.rootSupplied ?? new Set(['commandBus', 'auditLogService']),
    declaration: {
      omittedModules: options.omittedModules ?? [
        { moduleId: 'blog', reason: FIXTURE_REASONS['omission:core:blog'] as string },
      ],
      decorationOrder: options.decorationOrder ?? {},
      reasons: options.reasons ?? FIXTURE_REASONS,
    },
    seams: options.seams ?? moduleContextSeams(MODULE_CONTEXT_SOURCE),
  };
  return deriveDivergence(input);
}

/** Findings of one kind, as a count — the shape a red proof returns. */
export function fixtureFindings(kind: string, options: FixtureOptions = {}): number {
  return fixtureDivergence(options).findings.filter((finding) => finding.kind === kind).length;
}
