// Assets Library — Fastify plugin / composition root for the module.

import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import fastifyMultipart from '@fastify/multipart';

import { AdapterRegistry } from './services/storage/adapter-registry.js';
import { AssetsLibraryService } from './services/assets-library.service.js';
import { FoldersService } from './services/folders.service.js';
import { AssetReferenceRegistry } from './services/reference-registry.js';
import { HmacSigner } from './services/hmac.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { AdminUserReadPort, PermissionReadPort } from '@endora-commerce/contracts';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { AssetVisibility } from './services/asset-visibility.js';
import type { PlatformLogger } from '@endora-commerce/platform/kernel';
import {
  createAssetRetentionSweeper,
  type AssetRetentionSweeper,
} from './jobs/retention-sweeper.js';
import { createSettingsView } from './services/storage/settings-view.js';
import { registerAssetsLibraryAdminRoutes } from './routes.admin.js';
import { registerAssetsLibraryPublicRoutes } from './routes.public.js';
import type { RequireAdminFactory, SettingsReadPort } from '@endora-commerce/platform/kernel';

export interface AssetsLibraryModuleOptions {
  emFactory: () => EntityManager;
  /**
   * The platform's settings read. Every `assets.*` setting is read through it,
   * platform-wide (issue #333). Required, for the reason `requireAdmin` is: a
   * module that falls back to reading the `settings` table itself answers with
   * the manifest default while the operator's saved value sits beside it.
   */
  settings: Pick<SettingsReadPort, 'getMany'>;
  /** HMAC signer for local-FS private URLs. Uses ASSETS_LIBRARY_HMAC_KEY by default. */
  signer?: HmacSigner;
  /**
   * Permission gate factory. **Required** since feature 072 (T092): it used to
   * default to a permissive no-op, so a caller that forgot it got an
   * unguarded asset admin surface — silently, because the safe path is the one
   * every test exercises. The container supplies it now; there is no omission
   * left to be silent about.
   */
  requireAdmin: RequireAdminFactory;
  /**
   * This deployment's resolved public API origin, and the base every URL this
   * module produces falls back to (D-223).
   *
   * **Required**, for the reason the gate above is: an omitted origin is not a
   * failure, it is a host-relative URL in an e-mail, a push payload and a
   * partner's feed — silent, and invisible to every test that reads the URL
   * from the same host that served it. `registerModule` resolves it with the
   * platform's `resolvePublicApiBaseUrl()`, which is the idiom the payment
   * modules already use for their callback origins.
   */
  publicApiBaseUrl: string;
  /** Feature 054 — audits asset/folder writes co-transactionally when provided. */
  auditLog?: AuditPort;
  /**
   * Runs the Commands of feature 156 (`asset.replace`). Optional: a
   * composition without it serves everything except a replace.
   */
  commandBus?: CommandBus;
  /** Where a failed replace compensation is reported. */
  logError?: (message: string, context: Record<string, unknown>) => void;
  /** Names who replaced an asset's previous version; `replacedBy: null` without it. */
  adminUserReadPort?: Pick<AdminUserReadPort, 'findById'>;
  /** Where the retention sweep writes its one line per tick. */
  log?: Pick<PlatformLogger, 'info'>;
  /**
   * Whether a module is effectively present — `effectiveState.isPresent`, read
   * per evaluation. Required: an asset whose only references belong to a
   * switched-off owner is hidden, and the owner is never asked
   * (`specs/166-asset-reference-visibility/` research R-4).
   */
  isModulePresent: (moduleId: string) => boolean;
  /**
   * `admin_roles`' permission read, resolved per call. Required: it is how a
   * holder of the platform wildcard is told from a reader whose files follow
   * the records that use them (research R-3).
   */
  permissions: () => Pick<PermissionReadPort, 'listPermissions'>;
}

export interface AssetsLibraryModuleHandle {
  service: AssetsLibraryService;
  /** Which assets the ambient caller may see (feature 166) — the one evaluator. */
  visibility: AssetVisibility;
  folders: FoldersService;
  referenceRegistry: AssetReferenceRegistry;
  adapters: AdapterRegistry;
  /** `assets.soft_delete_retention_days` as read now (at least one day). */
  loadRetentionDays(): Promise<number>;
  /** The retention sweep (specs/156-asset-stable-url/), as the module's clock runs it. */
  sweeper: AssetRetentionSweeper;
}

export function assetsLibraryModule(options: AssetsLibraryModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: AssetsLibraryModuleHandle;
} {
  let cachedSigner: HmacSigner | undefined = options.signer;
  const settings = createSettingsView(options.settings);
  const loadRetentionDays = () => settings.softDeleteRetentionDays();
  const adapters = new AdapterRegistry({
    settings,
    publicApiBaseUrl: options.publicApiBaseUrl,
    signer: () => {
      if (!cachedSigner) cachedSigner = HmacSigner.fromEnv();
      return cachedSigner;
    },
  });
  const referenceRegistry = new AssetReferenceRegistry();
  const visibility = new AssetVisibility({
    registry: referenceRegistry,
    isPresent: options.isModulePresent,
    permissions: options.permissions,
    tenantContext: getTenantContext,
  });
  const service = new AssetsLibraryService({
    emFactory: options.emFactory,
    adapters,
    referenceRegistry,
    visibility,
    loadUploadPolicy: () => settings.uploadPolicy(),
    loadRetentionDays,
    ...(options.auditLog ? { auditLog: options.auditLog } : {}),
    ...(options.commandBus ? { commandBus: options.commandBus } : {}),
    ...(options.logError ? { logError: options.logError } : {}),
    ...(options.adminUserReadPort ? { adminUsers: options.adminUserReadPort } : {}),
  });
  const folders = new FoldersService(
    options.emFactory, referenceRegistry, visibility, options.auditLog, loadRetentionDays,
  );

  const requireAdmin = options.requireAdmin;

  const plugin = async (app: FastifyInstance) => {
    // Resolve the upload policy ONCE at registration so the multipart
    // parser's hard cap matches the operator-configured maximum. Without
    // an explicit `fileSize`, @fastify/multipart silently falls back to
    // its 1 MiB default and tears down the file stream on anything larger
    // — which surfaces as a 500 from the awaited adapter pipeline rather
    // than a clean 413 (the symptom that motivated this code).
    //
    // The pipeline's per-request size check still runs against the LIVE
    // setting on every upload, so tightening the cap takes effect without
    // a restart. Loosening it (or switching from a finite cap to "no cap")
    // requires a backend restart for the multipart parser to pick up the
    // new `fileSize` value.
    const initialPolicy = await settings.uploadPolicy();
    const FALLBACK_HARD_CEILING_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB
    const multipartFileSize =
      initialPolicy.maxFileSizeMb > 0
        ? initialPolicy.maxFileSizeMb * 1024 * 1024
        : FALLBACK_HARD_CEILING_BYTES;

    // Multipart is registered in a child encapsulation context so other modules'
    // routes are unaffected by its options.
    await app.register(async (childApp) => {
      await childApp.register(fastifyMultipart, {
        // Keep memory bounded; upload-pipeline streams directly to the adapter.
        limits: { files: 1, fields: 10, fileSize: multipartFileSize },
      });
      await registerAssetsLibraryAdminRoutes(childApp, {
        service,
        folders,
        adapters,
        emFactory: options.emFactory,
        requireAdmin,
        visibility,
      });
    });
    await registerAssetsLibraryPublicRoutes(app, {
      service,
      adapters,
      emFactory: options.emFactory,
      signer: () => {
        if (!cachedSigner) cachedSigner = HmacSigner.fromEnv();
        return cachedSigner;
      },
    });
  };

  const sweeper = createAssetRetentionSweeper({
    emFactory: options.emFactory,
    adapters,
    referenceRegistry,
    loadRetentionDays,
    ...(options.log ? { log: options.log } : {}),
  });

  return {
    plugin,
    handle: {
      service,
      visibility,
      folders,
      referenceRegistry,
      adapters,
      loadRetentionDays,
      sweeper,
    },
  };
}
