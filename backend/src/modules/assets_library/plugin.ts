// Assets Library — Fastify plugin / composition root for the module.
// Phase 2 wires services and exposes the module handle so composition.ts
// can inject the reference registry into Catalog and CMS.
// Routes (admin + public) and the upload pipeline land in US1 / US2.

import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';

import { AdapterRegistry } from './services/storage/adapter-registry.js';
import { AssetsLibraryService } from './services/assets-library.service.js';
import { FoldersService } from './services/folders.service.js';
import { AssetReferenceRegistry } from './services/reference-registry.js';
import { HmacSigner } from './services/hmac.js';
import { createSettingsView } from './services/storage/settings-view.js';

export interface AssetsLibraryModuleOptions {
  emFactory: () => EntityManager;
  /** HMAC signer for local-FS private URLs. Uses ASSETS_LIBRARY_HMAC_KEY by default. */
  signer?: HmacSigner;
}

export interface AssetsLibraryModuleHandle {
  service: AssetsLibraryService;
  folders: FoldersService;
  referenceRegistry: AssetReferenceRegistry;
  adapters: AdapterRegistry;
}

export function assetsLibraryModule(options: AssetsLibraryModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: AssetsLibraryModuleHandle;
} {
  // Lazy signer: HmacSigner.fromEnv() throws when ASSETS_LIBRARY_HMAC_KEY is
  // unset. The provider is only invoked when something actually signs a
  // private URL, so tests that never reach the adapter can skip env setup.
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
  });
  const folders = new FoldersService(options.emFactory);

  const plugin = async (_app: FastifyInstance) => {
    // Routes land in routes.admin.ts (US1 / US2) and routes.public.ts (US1).
    // No HTTP surface exposed yet at Phase-2 boot time.
  };

  return { plugin, handle: { service, folders, referenceRegistry, adapters } };
}
