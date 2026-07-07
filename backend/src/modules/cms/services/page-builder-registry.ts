// Page Builder component-extension registry — feature 014 / T028.
//
// Maps 1:1 onto Puck's `Config` model: each backend module that wants to
// contribute components calls `register(moduleCode, partialConfig)` from
// its plugin's composition step. The registry merges entries into a single
// master Config (last-writer-wins on collisions, with a warning), and
// exposes a metadata view (`describe()`) consumed by the admin's
// `GET /api/v1/admin/cms/page-builder/config` endpoint.
//
// The registry is React-free: it only stores component metadata
// (fields shape, owner module, optional preview-icon hint). The actual
// React render functions live in @b2b/cms-components (or in per-module
// extension packages); the storefront imports them directly.

import type {
  CmsFieldDescriptor,
  CmsPageBuilderDescriptor,
  PageBuilderBreakpoints,
  PageBuilderContext,
} from '@b2b/contracts/cms.js';
import { DEFAULT_BREAKPOINTS } from '@b2b/page-builder-core';

export type PageBuilderBreakpointsResolver = () => Promise<PageBuilderBreakpoints>;

export interface ComponentRegistration {
  ownerModule: string;
  fields: Record<string, CmsFieldDescriptor>;
  /** Optional admin-side palette icon hint. */
  previewIcon?: string;
  /** Contexts where this component is available. Defaults to CMS-only. */
  contexts?: PageBuilderContext[];
}

export interface PartialPageBuilderConfig {
  /** Map of component name → registration metadata. */
  components?: Record<string, Omit<ComponentRegistration, 'ownerModule'>>;
}

export interface PageBuilderRegistryOptions {
  breakpoints?: PageBuilderBreakpoints;
}

export class PageBuilderRegistry {
  private readonly components = new Map<string, ComponentRegistration>();
  private readonly schemaVersion = 1;
  private readonly breakpoints: PageBuilderBreakpoints;
  private breakpointsResolver?: PageBuilderBreakpointsResolver;

  constructor(options: PageBuilderRegistryOptions = {}) {
    this.breakpoints = options.breakpoints ?? { ...DEFAULT_BREAKPOINTS };
  }

  setBreakpointsResolver(resolver: PageBuilderBreakpointsResolver): void {
    this.breakpointsResolver = resolver;
  }

  async resolveBreakpoints(): Promise<PageBuilderBreakpoints> {
    if (this.breakpointsResolver) {
      return this.breakpointsResolver();
    }
    return this.getBreakpoints();
  }

  /**
   * Register a partial config from a contributing module. Multiple calls
   * from the same module accumulate. Name collisions warn and overwrite.
   */
  register(moduleCode: string, partial: PartialPageBuilderConfig): void {
    if (!partial.components) return;
    for (const [name, entry] of Object.entries(partial.components)) {
      if (this.components.has(name)) {
        const existing = this.components.get(name)!;

        console.warn(
          `[cms/page-builder-registry] Component "${name}" already registered by ` +
            `"${existing.ownerModule}"; overwriting with registration from "${moduleCode}".`,
        );
      }
      this.components.set(name, {
        ownerModule: moduleCode,
        fields: entry.fields,
        ...(entry.previewIcon !== undefined ? { previewIcon: entry.previewIcon } : {}),
        contexts: entry.contexts ?? ['cms'],
      });
    }
  }

  isComponentRegistered(name: string): boolean {
    return this.components.has(name);
  }

  knownNames(): Set<string> {
    return new Set(this.components.keys());
  }

  getBreakpoints(): PageBuilderBreakpoints {
    return { ...this.breakpoints };
  }

  /**
   * Returns the metadata view used by the admin `/page-builder/config`
   * endpoint. Excludes React render functions — those come from
   * `@b2b/cms-components` and per-module extension packages.
   */
  async describe(): Promise<CmsPageBuilderDescriptor> {
    const breakpoints = await this.resolveBreakpoints();
    return {
      schemaVersion: this.schemaVersion,
      breakpoints,
      components: Array.from(this.components.entries()).map(([name, reg]) => ({
        name,
        ownerModule: reg.ownerModule,
        fields: reg.fields,
        ...(reg.previewIcon !== undefined ? { previewIcon: reg.previewIcon } : {}),
        contexts: reg.contexts ?? ['cms'],
      })),
    };
  }
}
