import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import { z } from 'zod';
import { cmsColorPaletteSchema, type CmsColorPalette } from '@b2b/contracts';
import { CMS_PAGE_BUILDER_SETTING_CODES } from './manifest.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { CmsPage } from './entities/cms-page.entity.js';
import { CmsBlock } from './entities/cms-block.entity.js';
import { CmsTemplate } from './entities/cms-template.entity.js';
import { CmsHook } from './entities/cms-hook.entity.js';
import { CmsHookBlockAttachment } from './entities/cms-hook-block-attachment.entity.js';
import { cmsModule } from './plugin.js';
import type { CmsAssetResolver } from './services/storefront-resolver.js';
import { registerCmsAssetReferences } from './services/asset-references.js';
import type { AssetReferenceRegistry } from '../assets_library/services/reference-registry.js';

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
 * **The asset resolver stays a contribution.** It reaches into
 * `assets_library`'s service, and which modules a deployment ships is a root's
 * business, not this one's — the same reasoning `assets_library`'s own
 * reference resolvers were left on. It is read through the cradle *per call*
 * rather than installed once, so a root may contribute it at any point in its
 * own ordering without this module caring.
 *
 * `requireAdmin` becomes required. It was optional here and the routes
 * defaulted it to `?? (async () => {})` — a permission gate whose absent form
 * is open. Both roots passed one, so nothing was open; this is the seventh time
 * in this wave that shape has been removed rather than the seventh outage.
 *
 * `cacheOptions` was an option no caller ever passed. It does not reappear.
 */

export const entities = [CmsPage, CmsBlock, CmsTemplate, CmsHook, CmsHookBlockAttachment];

type CmsResult = ReturnType<typeof cmsModule>;

export interface CmsCradle {
  readonly emFactory: () => EntityManager;
  readonly redis: Redis;
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: {
    get<T>(code: string, channelId: string, schema: z.ZodType<T>): Promise<T>;
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
  /** Contribution point: absent unless a root supplies one. */
  readonly cmsAssetResolver: CmsAssetResolver | undefined;
  /**
   * Owned by `assets_library`: the registry that refuses to delete an asset a
   * page, block or template embeds.
   */
  readonly assetReferenceRegistry: AssetReferenceRegistry;
  readonly cms: CmsResult;
  readonly cmsReferenceRegistry: CmsResult['handle']['referenceRegistry'];
}

const breakpointSchema = z.number().int().positive();

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point, defaulted absent: a platform without `assets_library`
    // resolves it to nothing and CMS content simply carries no asset detail,
    // which is what the root's own `try/catch → null` already meant.
    cmsAssetResolver: ctx
      .asFunction((): CmsAssetResolver | undefined => undefined)
      .singleton(),

    cms: ctx
      .asFunction(({ emFactory, redis }: CmsCradle) => {
        const result = cmsModule({
          emFactory,
          redis,
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
          } catch {
            // Unset settings are the normal state on a fresh platform; the
            // registry's env-derived defaults are the answer, not an error.
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
          } catch {
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

        // Installed once but *reading* the contribution per call, so a root can
        // contribute after this module composes.
        result.handle.setAssetResolver(async (assetId) => {
          const resolve = ctx.cradle<CmsCradle>().cmsAssetResolver;
          if (resolve === undefined) return null;
          return resolve(assetId);
        });

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

  ctx.onBoot(async () => {
    // Idempotent seeded-Hook reconciliation. Unlike `_i18n`'s, this one reads
    // nothing but its own tables, so it is safe in a boot hook wherever the
    // pass places it.
    await ctx.cradle<CmsCradle>().cms.handle.reconcile();

    // R12 — the edge that blocks deleting an asset embedded in a page, a block
    // or a template (T143a). Both roots used to push this descriptor into
    // `assets_library`' registry: the scan belongs to whoever owns the columns
    // it reads, and a root's registration survives this module being switched
    // off, which is the Constitution XVII hole the cluster closes.
    const { assetReferenceRegistry, emFactory } = ctx.cradle<CmsCradle>();
    registerCmsAssetReferences(assetReferenceRegistry, emFactory);
  });

  ctx.routes(async (app) => {
    await ctx.cradle<CmsCradle>().cms.plugin(app);
  });
}
