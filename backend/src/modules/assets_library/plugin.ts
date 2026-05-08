// Assets Library — Fastify plugin / composition root for the module.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import fastifyMultipart from '@fastify/multipart';

import { AdapterRegistry } from './services/storage/adapter-registry.js';
import { AssetsLibraryService } from './services/assets-library.service.js';
import { FoldersService } from './services/folders.service.js';
import { AssetReferenceRegistry } from './services/reference-registry.js';
import { HmacSigner } from './services/hmac.js';
import { createSettingsView } from './services/storage/settings-view.js';
import { Setting } from '../settings/entities/setting.entity.js';
import { SettingValue } from '../settings/entities/setting-value.entity.js';
import { registerAssetsLibraryAdminRoutes } from './routes.admin.js';
import { registerAssetsLibraryPublicRoutes } from './routes.public.js';

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface AssetsLibraryModuleOptions {
  emFactory: () => EntityManager;
  /** HMAC signer for local-FS private URLs. Uses ASSETS_LIBRARY_HMAC_KEY by default. */
  signer?: HmacSigner;
  /** Permission gate factory. When omitted, a permissive no-op is used (test default). */
  requireAdmin?: RequireAdminFactory;
}

export interface AssetsLibraryModuleHandle {
  service: AssetsLibraryService;
  folders: FoldersService;
  referenceRegistry: AssetReferenceRegistry;
  adapters: AdapterRegistry;
}

const noOpRequireAdmin: RequireAdminFactory =
  () => async () => {
    /* permissive default — production wiring overrides */
  };

async function loadUploadPolicy(emFactory: () => EntityManager): Promise<{
  allowedTypes: string[];
  maxFileSizeMb: number;
}> {
  const em = emFactory();
  const allowed = await em.findOne(Setting, { code: 'assets.allowed_file_types' });
  const allowedOverride = allowed
    ? await em.findOne(SettingValue, { setting: allowed })
    : null;
  const allowedRaw = allowedOverride
    ? allowedOverride.value
    : allowed?.defaultValue ?? ['*'];
  const allowedTypes = Array.isArray(allowedRaw) ? allowedRaw.map(String) : ['*'];

  const max = await em.findOne(Setting, { code: 'assets.max_file_size_mb' });
  const maxOverride = max ? await em.findOne(SettingValue, { setting: max }) : null;
  const maxRaw = maxOverride ? maxOverride.value : max?.defaultValue ?? 0;
  const maxFileSizeMb = typeof maxRaw === 'number' ? maxRaw : Number(maxRaw) || 0;

  return { allowedTypes, maxFileSizeMb };
}

export function assetsLibraryModule(options: AssetsLibraryModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: AssetsLibraryModuleHandle;
} {
  let cachedSigner: HmacSigner | undefined = options.signer;
  const adapters = new AdapterRegistry({
    settings: createSettingsView(options.emFactory),
    signer: () => {
      if (!cachedSigner) cachedSigner = HmacSigner.fromEnv();
      return cachedSigner;
    },
  });
  const referenceRegistry = new AssetReferenceRegistry();
  const service = new AssetsLibraryService({
    emFactory: options.emFactory,
    adapters,
    referenceRegistry,
    loadUploadPolicy: () => loadUploadPolicy(options.emFactory),
  });
  const folders = new FoldersService(options.emFactory, referenceRegistry);

  const requireAdmin = options.requireAdmin ?? noOpRequireAdmin;

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
    const initialPolicy = await loadUploadPolicy(options.emFactory);
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

  return { plugin, handle: { service, folders, referenceRegistry, adapters } };
}
