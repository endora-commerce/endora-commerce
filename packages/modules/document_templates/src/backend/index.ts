import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetReadPort, DocumentRenderPort, ModuleManifest } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  effectiveState,
  lazyPort,
  type ModuleContext,
  type RequireAdminFactory,
  type SalesChannelResolutionPort,
} from '@endora-commerce/platform/kernel';
import { DocumentTemplate } from './entities/document-template.entity.js';
import { DocumentTypeRegistry } from './registry/document-type-registry.js';
import { DocumentRenderer } from './rendering/document-renderer.js';
import { registerDocumentTemplatesAdminRoutes } from './routes.admin.js';
import { BlockDeclarations } from './services/block-declarations.js';
import { DocumentTemplateService, templateReaderOver } from './services/document-template-service.js';
import { TemplateResolver } from './services/template-resolver.js';

/**
 * `document_templates` — the document-template facility
 * (`specs/152-compare-pdf-template/`).
 *
 * What it composes: the document-type registry hosts push into, the block
 * declarations of the present modules, the engine published as the gated
 * `documentRenderPort`, the management service behind the admin API, and the
 * routes. It reads no host's table and imports no host's code — a host's data
 * reaches a render only as the argument the host passes.
 */
export interface DocumentTemplatesCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  /** Core manifests plus this deployment's overlay modules — the block declarations live there. */
  readonly resolvedModuleRegistry: ReadonlyArray<{ manifest: ModuleManifest }>;
  readonly documentTypeRegistry: DocumentTypeRegistry;
  readonly documentBlockDeclarations: BlockDeclarations;
  readonly documentRenderer: DocumentRenderer;
  readonly documentTemplateService: DocumentTemplateService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // A **contribution registry**, and a plain `di.register` on purpose: hosts
    // push their document types from contribution-only boot hooks, which run
    // whatever this module's effective state is. A `providePort` gate here
    // would throw `MODULE_DISABLED` during composition and stop the backend
    // from starting while document templates are switched off. A type — and a
    // single contributed block — is answered only while its module is present,
    // read on every call (the `adminSearchProviderRegistry` precedent).
    documentTypeRegistry: ctx
      .asFunction(() => new DocumentTypeRegistry((moduleId) => effectiveState.isPresent(moduleId)))
      .singleton(),

    documentBlockDeclarations: ctx
      .asFunction(
        ({ resolvedModuleRegistry }: DocumentTemplatesCradle) =>
          new BlockDeclarations(
            () => resolvedModuleRegistry,
            (moduleId) => effectiveState.isPresent(moduleId),
          ),
      )
      .singleton(),

    documentRenderer: ctx
      .asFunction(
        ({ emFactory, documentTypeRegistry, documentBlockDeclarations }: DocumentTemplatesCradle) =>
          new DocumentRenderer({
            registry: documentTypeRegistry,
            resolver: new TemplateResolver(templateReaderOver(emFactory)),
            declarations: documentBlockDeclarations,
            // `assets_library` is non-deactivatable; read per call, never captured.
            assets: lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
          }),
      )
      .singleton(),

    documentTemplateService: ctx
      .asFunction(
        ({
          emFactory,
          commandBus,
          documentTypeRegistry,
          documentBlockDeclarations,
          documentRenderer,
        }: DocumentTemplatesCradle) =>
          new DocumentTemplateService({
            emFactory,
            commandBus,
            registry: documentTypeRegistry,
            declarations: documentBlockDeclarations,
            // A kernel registration: no module edge, nothing to switch off.
            salesChannels: lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort'),
            renderer: documentRenderer,
            // Issue #544 — `assets_library` is non-deactivatable; read per call.
            assets: lazyPort<AssetReadPort>(ctx, 'assetReadPort'),
          }),
      )
      .singleton(),
  });

  /**
   * The engine, published to hosts. **Gated**: while document templates are
   * off a host that resolves it gets `MODULE_DISABLED` — `comparisons` probes
   * presence first and prints its fixed layout; `invoices` binds this module,
   * so the lifecycle refuses to switch it off under invoicing (owner answer N2).
   */
  ctx.di.providePort<DocumentRenderPort>(
    'documentRenderPort',
    ctx.asFunction(({ documentRenderer }: DocumentTemplatesCradle) => documentRenderer).singleton(),
  );

  ctx.routes(async (app) => {
    const { documentTemplateService, requireAdmin } = ctx.cradle<DocumentTemplatesCradle>();
    await registerDocumentTemplatesAdminRoutes(app, { service: documentTemplateService, requireAdmin });
  });
}

/** The module's persisted entity classes (D-168). */
export const entities = [DocumentTemplate];
