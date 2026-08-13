import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { createSuggestionPricingEnricher } from './services/suggestion-pricing-enricher.js';
import type { SuggestionPriceResolverPort } from './services/suggestion-pricing-enricher.js';
import { searchModule, type SearchModuleOptions, type SearchModuleResult } from './plugin.js';

/**
 * `search` — six optional options that were never actually optional (feature
 * 072, wave 2, T123).
 *
 * `settingsService`, `settingsAdminService`, `requireAdmin`, `credentials`,
 * `resolveAdminAuditContext` and `enrichSuggestionPricing` were all declared
 * optional, and both composition roots passed all six. Their absence did not
 * fail — it silently produced a lesser module: manifest-default suggestion
 * limits, no `settings.value_changed` → embedder reactor, no admin routes at
 * all, and a typeahead popup showing list prices to a customer on a price list.
 * The comment on `settingsService` said it was for "foundation tests that
 * predate Settings"; no such caller existed. They are required now.
 *
 * `resolveReindexIntervalMinutes` is deleted rather than converted. It read
 * `search.reindex_interval_minutes` — this module's own setting — and fell back
 * to this module's own manifest default, in a root, so the module "isn't
 * coupled to the settings read API". It resolves a settings port already; the
 * indirection bought nothing and put a module's configuration in a composition.
 *
 * `enableReindexScheduler` stays root-supplied, and that is the opposite call
 * for a reason that has now bitten three conversions: the harness genuinely has
 * no worker role, and deriving it from `BACKEND_ROLE` here would start a
 * periodic Meilisearch sweep in every one of ~225 test files. Which process
 * runs consumers is a deployment decision (Principle X); which setting drives
 * their cadence is the module's.
 */

/** What `search` resolves from the container, and the names it owns. */
export interface SearchCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: SearchModuleOptions['settingsService'];
  readonly settingsAdminService: SearchModuleOptions['settingsAdminService'];
  readonly credentialsService: SearchModuleOptions['credentials'];
  readonly adminAuditActorResolver: SearchModuleOptions['resolveAdminAuditContext'];
  readonly catalogAttributeReadPort: SearchModuleOptions['catalogAttributeRead'];
  /** `price_lists`' resolver, narrowed to what a suggestion needs. */
  readonly pricingService: SuggestionPriceResolverPort;
  /**
   * Whether this composition runs the periodic reindex sweep (Principle X).
   * Root-supplied rather than env-derived: the test harness runs no sweep, and
   * a module should not have to know which of its callers is a test.
   */
  readonly searchRunWorkers: boolean;
  readonly search: SearchModuleResult;
  readonly searchHandle: SearchModuleResult['handle'];
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    search: ctx
      .asFunction(({ emFactory, eventBus, searchRunWorkers }: SearchCradle): SearchModuleResult =>
        searchModule({
          emFactory,
          eventBus,
          enableReindexScheduler: searchRunWorkers,
          catalogAttributeRead: lazyPort<SearchModuleOptions['catalogAttributeRead']>(
            ctx,
            'catalogAttributeReadPort',
          ),
          settingsService: lazyPort<SearchModuleOptions['settingsService']>(
            ctx,
            'settingsReadPort',
          ),
          settingsAdminService: lazyPort<SearchModuleOptions['settingsAdminService']>(
            ctx,
            'settingsAdminService',
          ),
          credentials: lazyPort<SearchModuleOptions['credentials']>(ctx, 'credentialsService'),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<SearchCradle>().requireAdmin(permission)(req, reply),
          resolveAdminAuditContext: (req) =>
            ctx.cradle<SearchCradle>().adminAuditActorResolver(req),
          // Built here rather than in a root: the enricher is this module's own
          // code, and the only foreign part is the price resolver it wraps.
          enrichSuggestionPricing: createSuggestionPricingEnricher({
            emFactory,
            pricingService: lazyPort<SuggestionPriceResolverPort>(ctx, 'pricingService'),
          }),
        }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'searchHandle',
    ctx.asFunction(({ search }: SearchCradle) => search.handle).singleton(),
  );

  ctx.routes(async (app) => {
    await ctx.cradle<SearchCradle>().search.plugin(app);
  });
}
