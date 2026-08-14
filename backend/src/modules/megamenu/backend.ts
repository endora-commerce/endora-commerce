import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { DictionaryValidator } from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { Megamenu } from './entities/megamenu.entity.js';
import { MegamenuItem } from './entities/megamenu-item.entity.js';
import { MegamenuBinding } from './entities/megamenu-binding.entity.js';
import { MegamenuCache, type MegamenuCacheOptions } from './services/megamenu-cache.js';
import { MegamenuReferenceRegistry } from './services/megamenu-reference-registry.js';
import { MegamenuService } from './services/megamenu-service.js';
import { MegamenuItemService } from './services/megamenu-item-service.js';
import type { TargetValidatorDeps } from './services/target-validator.js';
import { StorefrontResolver, type StorefrontDeps } from './services/storefront-resolver.js';
import { registerMegamenuAdminRoutes } from './routes.admin.js';
import { registerMegamenuStorefrontRoutes } from './routes.storefront.js';
import { registerMegamenuAssetReferences } from './services/asset-references.js';
import { registerMegamenuCmsReferences } from './services/cms-references.js';
import type { AssetReferenceRegistry } from '../assets_library/services/reference-registry.js';
import type { CmsExternalReferenceScanner } from '../cms/services/cms-reference-registry.js';

/**
 * `megamenu` — two dependency bundles that stay outside on purpose (feature
 * 072, wave 2, T107).
 *
 * The temptation here is to pull `validatorDeps` and `storefrontDeps` into the
 * module, because they are the only reason a root still mentions it. Resist it:
 * both are raw SQL against **other modules' tables** — `categories`,
 * `cms_pages`, `cms_blocks`, `assets` — and moving them in would give this
 * module direct reads of `catalog`, `cms` and `assets_library` storage, which
 * Principle I forbids more firmly than it dislikes a root closure. They stay
 * contributions, and they carry the same shape `blogStorefrontDeps` already
 * has.
 *
 * That those closures are hand-written SQL rather than calls into the owning
 * modules' services is a real problem, and it is not this conversion's. It
 * belongs to whichever of `catalog`, `cms` and `assets_library` grows the
 * existence-check port first; recorded here so the next reader does not mistake
 * the contribution point for an endorsement of what flows through it.
 *
 * `requireAdmin` stops being optional — `routes.admin.ts` defaulted an absent
 * gate to `?? (async () => {})`, the permissive form, which both roots happened
 * to pass.
 *
 * `megamenuCacheOptions` is a contribution point that **neither** composition
 * currently overrides, and that is deliberate rather than an oversight. Unlike
 * `seo`'s sitemap options, the harness wants this module's cache *on*: 
 * `test/integration/megamenu/storefront-cache.test.ts` exists to prove the
 * payload is cached and dropped on write, so a zero TTL there would make the
 * suite assert nothing. The seam stays for a deployment that wants to tune the
 * TTL; the default is the behaviour both compositions actually want.
 */

export const entities = [Megamenu, MegamenuItem, MegamenuBinding];

interface MegamenuServices {
  readonly menuService: MegamenuService;
  readonly itemService: MegamenuItemService;
  readonly storefrontResolver: StorefrontResolver;
  readonly cache: MegamenuCache | undefined;
}

export interface MegamenuCradle {
  readonly emFactory: () => EntityManager;
  readonly redis: Redis | undefined;
  readonly requireAdmin: RequireAdminFactory;
  readonly dictionaryValidator: DictionaryValidator;
  /** Existence checks against other modules' tables; a root owns them. */
  readonly megamenuValidatorDeps: TargetValidatorDeps;
  /** URL resolution against other modules' tables; a root owns them. */
  readonly megamenuStorefrontDeps: StorefrontDeps;
  /** Composition-specific cache tuning; `{}` in production. */
  readonly megamenuCacheOptions: MegamenuCacheOptions;
  /**
   * Owned by `assets_library`: the registry that refuses to delete an asset a
   * menu item points at, whether as the item's target or as its icon.
   */
  readonly assetReferenceRegistry: AssetReferenceRegistry;
  /**
   * Owned by `cms`: the registry that refuses to delete a page or a block a
   * menu item links to. This module contributes the scanner; `cms` calls it.
   */
  readonly cmsReferenceRegistry: { register: (scanner: CmsExternalReferenceScanner) => void };
  readonly megamenuServices: MegamenuServices;
  readonly megamenuReferenceRegistry: MegamenuReferenceRegistry;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    megamenuCacheOptions: ctx.asFunction((): MegamenuCacheOptions => ({})).singleton(),

    megamenuServices: ctx
      .asFunction(
        ({ emFactory, redis, megamenuCacheOptions }: MegamenuCradle): MegamenuServices => {
          const cache = redis ? new MegamenuCache(redis, megamenuCacheOptions) : undefined;
          const menuService = new MegamenuService(
            emFactory,
            cache,
            lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
          );
          return {
            menuService,
            cache,
            itemService: new MegamenuItemService(
              emFactory,
              menuService,
              // Read per call: these are contributed by a root, which registers
              // them after this module composes.
              lazyPort<TargetValidatorDeps>(ctx, 'megamenuValidatorDeps'),
              cache,
            ),
            storefrontResolver: new StorefrontResolver(
              emFactory,
              lazyPort<StorefrontDeps>(ctx, 'megamenuStorefrontDeps'),
              cache,
            ),
          };
        },
      )
      .singleton(),
  });

  ctx.di.providePort(
    'megamenuReferenceRegistry',
    ctx
      .asFunction(
        ({ emFactory }: MegamenuCradle) => new MegamenuReferenceRegistry(emFactory),
      )
      .singleton(),
  );

  /**
   * The two reference edges this module holds against other modules' entities
   * (T143a): an asset a menu item targets or uses as an icon, and a CMS page or
   * block a menu item links to. Both refuse the upstream delete with a 409 that
   * names the menu.
   *
   * Both roots used to cross-register these, which had the failure this cluster
   * exists to remove: a root's push survives `megamenu` being switched off, so
   * an operator who had disabled the module still could not delete a page a
   * megamenu item referenced, and the 409 named a menu the platform was no
   * longer serving.
   *
   * `ctx.onBoot` rather than a registration: both registries are *read* by
   * their owners on delete, and a registration declares without resolving.
   */
  ctx.onBoot(() => {
    const { assetReferenceRegistry, cmsReferenceRegistry, megamenuReferenceRegistry, emFactory } =
      ctx.cradle<MegamenuCradle>();
    registerMegamenuAssetReferences(assetReferenceRegistry, emFactory);
    registerMegamenuCmsReferences(cmsReferenceRegistry, megamenuReferenceRegistry);
  });

  ctx.routes(async (app) => {
    const { megamenuServices, requireAdmin } = ctx.cradle<MegamenuCradle>();
    await registerMegamenuAdminRoutes(app, {
      menuService: megamenuServices.menuService,
      itemService: megamenuServices.itemService,
      requireAdmin,
    });
    await registerMegamenuStorefrontRoutes(app, {
      storefrontResolver: megamenuServices.storefrontResolver,
    });
  });
}
