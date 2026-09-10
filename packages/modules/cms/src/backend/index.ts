import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import {
  cmsColorPaletteSchema,
  type AssetReferenceRegistryPort,
  type AssetsLibraryPort,
  type CmsBlockSeedPort,
  type CmsColorPalette,
  type DictionaryReferenceRegistryPort,
  type ModuleManifest,
} from '@endora-commerce/contracts';
import { CMS_PAGE_BUILDER_SETTING_CODES, CMS_SETTING_CODES } from '../manifest.js';
import type { CmsBlockReadPort, CmsPageReadPort } from '@endora-commerce/contracts';
import { CmsBlockReadService } from './services/cms-block-read-port.js';
import { CmsBlockSeedService } from './services/cms-block-seed-port.js';
import { CmsPageReadService } from './services/cms-page-read-port.js';
import { lazyPort, type ModuleContext } from '@endora-commerce/platform/kernel';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { cmsModule } from './plugin.js';
import type { CmsAssetResolver } from './services/storefront-resolver.js';
import { createAssetEmbedResolver } from './services/asset-embed-resolver.js';
import { registerCmsAssetReferences } from './services/asset-references.js';
import { registerCmsLanguageReferences } from './services/cms-language-reference.js';
import { CmsBlock } from './entities/cms-block.entity.js';
import { CmsHookBlockAttachment } from './entities/cms-hook-block-attachment.entity.js';
import { CmsHook } from './entities/cms-hook.entity.js';
import { CmsPage } from './entities/cms-page.entity.js';
import { CmsTemplate } from './entities/cms-template.entity.js';

/**
 * `cms` — the endpoint that only worked in production (feature 072, wave 1,
 * T093).
 *
 * The module exposed four late-bound setters — page-builder breakpoints, the
 * colour-palette reader, the colour-palette writer, the asset resolver — and
 * `composition.ts` called all four after constructing it. `test-server.ts`
 * called **none** of them. So `PUT /api/v1/admin/cms/page-builder/color-palette`,
 * whose handler is
 *
 *     const writer = deps.getColorPaletteWriter?.();
 *     if (!writer) throw new Error('Color palette writer is not configured.');
 *
 * answered 500 under every test run since it shipped, and nothing noticed
 * because nothing called it. The two read resolvers were worse than that,
 * because they do not throw: breakpoints fell back to the env defaults and the
 * palette to `[]`, so the harness saw a plausible answer rather than a wrong
 * one.
 *
 * **The setters are gone rather than moved.** The three settings-backed ones
 * read `settingsReadPort` / `settingsAdminService` / `settingsChannelResolver`,
 * all of which are registrations any composition has, and the setting codes are
 * this module's own — so there was never a reason for a root to own that
 * wiring. Resolving them here means there is no setter left for a composition
 * to forget. `test/contract/cms/page-builder-color-palette.contract.test.ts`
 * covers the endpoint that could not previously be covered.
 *
 * **The channel the settings are read from changes, deliberately.** The root
 * read `process.env['ORGANIZATIONS_SETTINGS_CHANNEL_ID'] ?? 'default'` directly
 * for these three, while four other sites had already been consolidated onto
 * `settingsChannelResolver` — the system-default sales channel, falling back to
 * that same env value. Constitution XII says channel-scoped reads go through
 * the sanctioned accessor rather than a hand-rolled one, and the raw env read
 * is exactly the hand-rolled form. The palette is written with
 * `setValueForAllChannels`, so both spellings find the value; this makes the
 * read agree with the rest of the platform.
 *
 * **The asset resolver stayed a contribution, and no longer does**
 * (`specs/110-instance-repository/` T118c). The reasoning written here was that
 * it reaches into `assets_library`'s service and which modules a deployment
 * ships is a root's business — true of the *decision* and not of the *wiring*.
 * `assets_library` publishes `assetsLibraryPort`, so the reach is a declared
 * edge this module can hold itself, and holding it removes the thing the
 * argument never accounted for: the root's closure was a raw hold on another
 * module's service, and only **one** of the two roots ever contributed it. The
 * registration is still read through the cradle *per call*, so a deployment
 * that decorates the name is honoured wherever it does so.
 *
 * `requireAdmin` becomes required. It was optional here and the routes
 * defaulted it to `?? (async () => {})` — a permission gate whose absent form
 * is open. Both roots passed one, so nothing was open; this is the seventh time
 * in this wave that shape has been removed rather than the seventh outage.
 *
 * `cacheOptions` was an option no caller ever passed. It does not reappear.
 */

type CmsResult = ReturnType<typeof cmsModule>;

export interface CmsCradle {
  readonly emFactory: () => EntityManager;
  readonly redis: Redis;
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: {
    /**
     * `channelId` is `null` for a platform-wide read — `SettingsReadPort`'s own
     * spelling (D-41), which the reserved-segments resolver below uses because
     * the deployment's route table is not a per-channel fact.
     */
    get<T>(code: string, channelId: string | null, schema: z.ZodType<T>): Promise<T>;
  };
  readonly settingsAdminService: {
    setValueForAllChannels(
      code: string,
      value: unknown,
      expectedVersion: string | null,
      actor: unknown,
    ): Promise<unknown>;
  };
  readonly settingsChannelResolver: () => Promise<string>;
  /**
   * How an embedded asset id becomes the detail a storefront response carries.
   * This module's own registration over `assetsLibraryPort` since T118c — see
   * the note on the registration itself.
   */
  readonly cmsAssetResolver: CmsAssetResolver;
  /**
   * Owned by `assets_library`: the registry that refuses to delete an asset a
   * page, block or template embeds. Typed by the contract shape rather than by
   * the owner's class (feature 075, Phase C) — this module contributes a
   * descriptor and never touches anything else the class has.
   */
  readonly assetReferenceRegistry: AssetReferenceRegistryPort;
  /**
   * Core manifests + this deployment's overlay modules (feature 057), from
   * which the Page Builder registry takes every block and category declaration
   * (feature 096, T209).
   *
   * Typed by what this module reads rather than by `_lifecycle`'s
   * `RegisteredManifestEntry`, in the idiom `admin_roles` established for the
   * permission catalogue: the entries a root contributes carry a `filePath` and
   * the install hooks too, and none of that is this module's business.
   */
  readonly resolvedModuleRegistry: ReadonlyArray<{ manifest: ModuleManifest }>;
  readonly cms: CmsResult;
  readonly cmsReferenceRegistry: CmsResult['handle']['referenceRegistry'];
}

const breakpointSchema = z.number().int().positive();

/**
 * The reserved-segments Setting as it comes off the store.
 *
 * Deliberately loose — `unknown[]`, not `string[]`. The value is free-form
 * JSON an operator edits, `settingsReadPort.get` **throws**
 * `SettingValueShapeMismatch` on a schema failure, and a stray non-string entry
 * in the list would then take every CMS page save down rather than reserving
 * one fewer segment. `normalizeReservedSegments` is where an entry is judged,
 * one entry at a time, in the module that reads it.
 */
const reservedSegmentsSchema = z.array(z.unknown());

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    /**
     * `specs/110-instance-repository/` T118c — this module's own registration
     * over `assets_library`' published port, drained out of a composition root
     * (`specs/075-cross-module-decoupling-sweep/` Phase C).
     *
     * It was a contribution point defaulted to `undefined`, and `composition.ts`
     * built the closure below out of `assetsLibrary.handle.service`. Two things
     * that cost: the reach was a root's raw hold on another module's service
     * rather than a declared edge, and **`test-server.ts` contributed nothing**,
     * so every CMS storefront response under test resolved its asset embeds to
     * `{}` — one seam on from the four late-bound setters this barrel's own
     * header calls "the endpoint that only worked in production", and quieter,
     * because an empty asset map is a plausible answer rather than a wrong one.
     *
     * The port is resolved per call through the `lazyPort` proxy, never captured
     * (composition checklist item 3), and the edge is `assets_library` in this
     * module's manifest `dependencies` — already there for the reference
     * registry below, and now load-bearing for a second reason.
     *
     * The mapping itself is `services/asset-embed-resolver.ts`, a function of the
     * port rather than of the context, so it is unit-tested over a stub with no
     * container composed.
     */
    cmsAssetResolver: ctx
      .asFunction((): CmsAssetResolver =>
        createAssetEmbedResolver(lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort')),
      )
      .singleton(),

    cms: ctx
      .asFunction(({ emFactory, redis, resolvedModuleRegistry }: CmsCradle) => {
        const result = cmsModule({
          emFactory,
          redis,
          // Feature 096, T209/T210. The declarations are fixed at composition;
          // presence is read per `describe()` call, so an operator switching a
          // block owner off changes the next response with no restart and no
          // re-composition (`contracts/block-definition.md` §4.1).
          manifests: [...resolvedModuleRegistry],
          isModulePresent: (moduleId) => effectiveState.isPresent(moduleId),
          // Resolved per check rather than captured: Awilix's strict mode
          // refuses a singleton holding the transient `requireAdmin` port, and
          // a captured guard would keep admitting requests after `auth` goes.
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<CmsCradle>().requireAdmin(permission)(req, reply),
        });

        // Wired here, once, instead of by each composition root. Every closure
        // reads the cradle at call time, so none of them depends on where in a
        // root's ordering the settings store or the asset library appears.
        result.handle.setPageBuilderBreakpointsResolver(async () => {
          const { settingsReadPort, settingsChannelResolver } = ctx.cradle<CmsCradle>();
          try {
            const channelId = await settingsChannelResolver();
            const [tabletMin, desktopMin] = await Promise.all([
              settingsReadPort.get(
                CMS_PAGE_BUILDER_SETTING_CODES.BREAKPOINT_TABLET_MIN,
                channelId,
                breakpointSchema,
              ),
              settingsReadPort.get(
                CMS_PAGE_BUILDER_SETTING_CODES.BREAKPOINT_DESKTOP_MIN,
                channelId,
                breakpointSchema,
              ),
            ]);
            return { tabletMin, desktopMin };
          } catch (err) {
            // Unset settings are the normal state on a fresh platform; the
            // registry's env-derived defaults are the answer, not an error.
            // A settings store the platform is refusing to serve is not that:
            // the builder would render the defaults as though they were the
            // operator's breakpoints, and a save would then write over them.
            rethrowIfModuleDisabled(err);
            return result.handle.pageBuilderRegistry.getBreakpoints();
          }
        });

        result.handle.setColorPaletteResolver(async (): Promise<CmsColorPalette> => {
          const { settingsReadPort, settingsChannelResolver } = ctx.cradle<CmsCradle>();
          try {
            const channelId = await settingsChannelResolver();
            return await settingsReadPort.get(
              CMS_PAGE_BUILDER_SETTING_CODES.COLOR_PALETTE,
              channelId,
              cmsColorPaletteSchema,
            );
          } catch (err) {
            // Same rule as the breakpoints above: an unset palette is empty, an
            // absent settings store is not — an empty palette the builder then
            // saves is data loss dressed as a default.
            rethrowIfModuleDisabled(err);
            return [];
          }
        });

        result.handle.setColorPaletteWriter(async (entries, expectedVersion, actor) => {
          const { settingsAdminService } = ctx.cradle<CmsCradle>();
          await settingsAdminService.setValueForAllChannels(
            CMS_PAGE_BUILDER_SETTING_CODES.COLOR_PALETTE,
            entries,
            expectedVersion,
            actor,
          );
          return entries;
        });

        /**
         * Feature 105, FR-032 — the deployment's reserved first path segments.
         *
         * Read **platform-wide** (`null`), which is what D-41 gives that tier a
         * spelling for: the value is a fact about this deployment's storefront
         * route table, not about one channel's content, and a page is published
         * to *n* channels while its first segment can only collide once.
         *
         * A failing read **propagates**, unlike the two resolvers above, and
         * the difference is the direction each one fails in. An unset palette is
         * legitimately empty and rendering `[]` costs nothing; an unreadable
         * reserved set rendered as `[]` would let through exactly the save this
         * refusal exists to stop, which is a fail-open. The unset case is not
         * that state anyway: the manifest declares `defaultValue: []`, so the
         * store answers the empty list without an error.
         */
        result.handle.setReservedSlugSegmentsResolver(async () => {
          const { settingsReadPort } = ctx.cradle<CmsCradle>();
          return settingsReadPort.get(
            CMS_SETTING_CODES.RESERVED_SLUG_SEGMENTS,
            null,
            reservedSegmentsSchema,
          );
        });

        // Installed once but *reading* the registration per call, so a
        // deployment that decorates the name is honoured without this module
        // caring where in a composition that happens. The `undefined` branch
        // that used to stand here went with the contribution point (T118c):
        // there is no composition in which the name is unset any more.
        result.handle.setAssetResolver(async (assetId) =>
          ctx.cradle<CmsCradle>().cmsAssetResolver(assetId),
        );

        return result;
      })
      .singleton(),
  });

  /**
   * The contribution seam, deliberately **ungated** (feature 072, D-39).
   *
   * `megamenu` pushes its scanner in from `ctx.onBoot`, and boot hooks run
   * regardless of effective state. As a `providePort` this was a transient gate,
   * so an operator switching `cms` off on `/platform/modules` made `megamenu`'s
   * hook throw `MODULE_DISABLED` during composition and the backend stopped
   * starting — the exact inversion Constitution XVII forbids, since off is meant
   * to be reversible and the screen that reverses it needs the API up.
   *
   * A scanner is inert until a delete asks it something; every behavioural seam
   * this module publishes is still a port.
   */
  ctx.di.register({
    cmsReferenceRegistry: ctx
      .asFunction(({ cms }: CmsCradle) => cms.handle.referenceRegistry)
      .singleton(),
  });

  /**
   * Feature 075, Phase P — the page read model.
   *
   * `seo` reads pages twice: to resolve one page's meta tags, and to enumerate
   * the published ones for the sitemap. It reaches the `CmsPage` entity for
   * both today. The record drops `body` and `content` — a sitemap has no use
   * for a rendered tree, and shipping it would make every sitemap build carry
   * the whole CMS through memory.
   *
   * A port, unlike `cmsReferenceRegistry` above: a scanner is inert until a
   * delete asks it something, and a read is not.
   */
  ctx.di.providePort<CmsPageReadPort>(
    'cmsPageReadPort',
    ctx.asFunction(({ emFactory }: CmsCradle) => new CmsPageReadService(emFactory)).singleton(),
  );

  /**
   * `specs/110-instance-repository/` T118c — the block read model.
   *
   * `megamenu` asks two questions about a block and read `cms_blocks` in raw SQL
   * from a composition root for both: whether one exists, for the admin-side
   * target validator, and what it renders as in a language, for the storefront
   * resolver that inlines it into a menu payload. Two methods and not one wide
   * read — a validator that took the localized record would fetch a content tree
   * per menu item to test a row for existence.
   *
   * A port and not an ungated registration, on `cmsPageReadPort`'s reasoning one
   * declaration up: a scanner is inert until a delete asks it something, and a
   * read is not. An operator who has switched the CMS off has switched off the
   * thing that owns the block, and a menu that quietly dropped the embed would
   * report the content as gone rather than as unavailable.
   */
  ctx.di.providePort<CmsBlockReadPort>(
    'cmsBlockReadPort',
    ctx.asFunction(({ emFactory }: CmsCradle) => new CmsBlockReadService(emFactory)).singleton(),
  );

  /**
   * Feature 075 / D-87 — the predefined-block seeding seam.
   *
   * `newsletter` and `google_analytics` each ship a block whose *text* is
   * theirs and whose *storage* is this module's, and both used to write these
   * two tables in raw SQL. A port rather than an ungated contribution seam,
   * because a seed is a write into this module's schema: an operator who has
   * switched the CMS off has switched off the thing that owns those rows, and
   * the gate is what says so. The callers decide presence in front of it — the
   * seed runs at route registration, where a gate's "no" would stop the next
   * start rather than one request — which is the shape the port's own doc block
   * in `packages/contracts` states.
   */
  ctx.di.providePort<CmsBlockSeedPort>(
    'cmsBlockSeedPort',
    ctx.asFunction(({ emFactory }: CmsCradle) => new CmsBlockSeedService(emFactory)).singleton(),
  );

  ctx.onBoot(async () => {
    // Presence is decided here — first, and outside anything that could catch it
    // (issue #146, D-68). The reconcile writes rows, and a switched-off module
    // writing at every boot is "behaves as if never installed" failing. A boot
    // hook has no caller to answer, so the question is asked rather than thrown:
    // `runBootHooks` re-throws as `ModuleCompositionError` and `index.ts` turns
    // that into `process.exit(1)`, so an operator's flip would have taken the
    // next start down.
    if (!effectiveState.isPresent('cms')) return;
    // Idempotent seeded-Hook reconciliation. Unlike `_i18n`'s, this one reads
    // nothing but its own tables, so it is safe in a boot hook wherever the
    // pass places it.
    await ctx.cradle<CmsCradle>().cms.handle.reconcile();
  });

  /**
   * R12 — the edge that blocks deleting an asset embedded in a page, a block or
   * a template (T143a). Both roots used to push this descriptor into
   * `assets_library`' registry: the scan belongs to whoever owns the columns it
   * reads, and a root's registration survives this module being switched off,
   * which is the Constitution XVII hole the cluster closes.
   *
   * A second hook, and deliberately **unprobed** (D-68). It used to share the
   * reconcile's hook, so probing that one would have stopped the scanner too —
   * and a deactivated page still embeds its assets. The Library asks this
   * registry before every soft-delete; with the scanner gone an operator could
   * delete an asset the switched-off CMS still references, and the loss would
   * only surface as a broken page at reactivation. The registry's enumeration
   * policy says the same thing from the other side: contributions here are
   * `honoured` while their owner is absent, because a scanner is integrity
   * rather than a surface.
   */
  ctx.onBoot(() => {
    const { assetReferenceRegistry, emFactory } = ctx.cradle<CmsCradle>();
    registerCmsAssetReferences(assetReferenceRegistry, emFactory);
  });

  ctx.routes(async (app) => {
    await ctx.cradle<CmsCradle>().cms.plugin(app);
  });

  /**
   * This module's rows carry a language code, so it answers "who still points at
   * this language?" about its own tables (feature 077, D-87), where the owner used
   * to count them with SQL naming this module's tables.
   *
   * A **contribution** hook: it pushes an inert descriptor into `languageReferenceRegistry`,
   * an ungated registry, and carries no presence probe (D-62/D-68). Probing
   * would be wrong in the dangerous direction — a switched-off module still owns
   * the rows, so its language must still refuse the delete, which is the
   * enumeration policy the registry states.
   */
  ctx.onBoot(() => {
    registerCmsLanguageReferences(
      lazyPort<DictionaryReferenceRegistryPort>(ctx, 'languageReferenceRegistry'),
      ctx.cradle<CmsCradle>().emFactory,
    );
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  CmsBlock,
  CmsHookBlockAttachment,
  CmsHook,
  CmsPage,
  CmsTemplate,
];
