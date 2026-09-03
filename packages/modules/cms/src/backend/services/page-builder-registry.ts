// Page Builder component registry — feature 014 / T028, rebuilt on module
// declarations by feature 096 (T209/T210).
//
// **It is populated from the composed modules' manifests, not from a call.**
// Until 2026-09-03 it was populated by a single hand-written
// `register('cms', …)` at `plugin.ts:90` which declared all 35 CMS names with
// `ownerModule: 'cms'` — five of which are `catalog`'s, so the descriptor
// answered the ownership question wrongly for every one of them and FR-010's
// presence filter had nothing true to key on. Ownership is now stated once, in
// the block's own `name`, by the module that owns it
// (`contracts/block-definition.md` §1 and §4.1).
//
// The registry is React-free: it stores metadata only. The render functions
// live in `@endora-commerce/cms-components` and the per-module packages, and
// the storefront imports them directly.
//
// ## Two things it deliberately does not do
//
// **It does not merge categories at registration.** A merge performed there has
// consumed composition order and can no longer answer differently when a module
// is switched off — which is the whole of B12. Declarations are kept keyed by
// their declaring module and folded at `describe()`, after the presence filter.
//
// **It applies no context admission.** `email` admitting into `newsletter` is
// the *palette* derivation's rule, applied once through `contextAdmits`
// (`contracts/block-definition.md` §4.1.1), so the wire shape keeps saying what
// the manifests say and exactly one layer answers "which sections does the
// newsletter palette have".

import type {
  BlockCategory,
  BlockDefinition,
  CmsFieldDescriptor,
  CmsColorPaletteEntry,
  CmsPageBuilderDescriptor,
  PageBuilderBreakpoints,
  PageBuilderContext,
} from '@endora-commerce/contracts/cms';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { DEFAULT_BREAKPOINTS } from '@endora-commerce/page-builder-core/types/responsive';

export type PageBuilderBreakpointsResolver = () => Promise<PageBuilderBreakpoints>;

export type ColorPaletteResolver = () => Promise<CmsColorPaletteEntry[]>;

export interface ComponentRegistration {
  ownerModule: string;
  fields: Record<string, CmsFieldDescriptor>;
  /** Optional admin-side palette icon hint. */
  previewIcon?: string;
  /** Contexts where this component is available. Defaults to CMS-only. */
  contexts?: PageBuilderContext[];
  /** Module-relative i18n key for the palette entry's label. */
  labelKey?: string;
  /** Module-relative i18n key for the palette entry's description. */
  descriptionKey?: string;
  /** The declared category key this block sits in. */
  category?: string;
  /** Props a freshly inserted node carries. */
  defaultProps?: Record<string, unknown>;
  /** Which of `fields` accept a per-breakpoint override. */
  responsiveFields?: string[];
  /** Sort order within the category. */
  weight?: number;
}

/** One module's declaration of one palette section, kept as declared. */
interface CategoryDeclaration extends BlockCategory {
  readonly ownerModule: string;
}

export interface PageBuilderRegistryOptions {
  breakpoints?: PageBuilderBreakpoints;
  /**
   * The composed modules, in the shape both composition roots contribute as
   * `resolvedModuleRegistry` — core manifests plus this deployment's overlay
   * modules. Typed by what this registry reads (feature 075, Phase C).
   */
  manifests?: ReadonlyArray<{ manifest: ModuleManifest }> | undefined;
  /**
   * **Effective presence — both axes** (Principle XVII, FR-010).
   *
   * Omitted ⇒ every declaring module counts as present, which is the
   * pre-composition path (unit tests, the CI helpers) and not a fall-open: a
   * presence read before the registry cache is loaded throws rather than
   * answering, so an unwired registry cannot be mistaken for a loaded one that
   * found nothing.
   */
  isModulePresent?: ((moduleId: string) => boolean) | undefined;
}

/**
 * Raised when two modules declare one block name.
 *
 * **D-31's collision requirement, and the reversal of defect D-d**: the old
 * `register` warned and overwrote, which is last-writer-wins over a *persisted*
 * identifier — one contributor's stored documents silently rendering as
 * another's block. It has never been exercised because there was one
 * contributor; there are now six.
 *
 * **Two contributors, never one registering twice.** The owner is compared, so
 * a module re-declaring its own manifest is idempotent; a name that arrives
 * from a second module id is the collision, and it is the only thing this error
 * is for.
 */
export class DuplicateBlockNameError extends Error {
  constructor(name: string, first: string, second: string) {
    super(
      `[cms/page-builder-registry] Block name "${name}" is declared by both "${first}" and ` +
        `"${second}". A block name is persisted and must have one owner — rename one of the ` +
        'two declarations (`contracts/block-definition.md` §4.1).',
    );
    this.name = 'DuplicateBlockNameError';
  }
}

export class PageBuilderRegistry {
  private readonly components = new Map<string, ComponentRegistration>();
  private readonly categories: CategoryDeclaration[] = [];
  private readonly schemaVersion = 1;
  private readonly breakpoints: PageBuilderBreakpoints;
  private readonly isModulePresent: (moduleId: string) => boolean;
  private breakpointsResolver?: PageBuilderBreakpointsResolver;
  private colorPaletteResolver?: ColorPaletteResolver;

  constructor(options: PageBuilderRegistryOptions = {}) {
    this.breakpoints = options.breakpoints ?? { ...DEFAULT_BREAKPOINTS };
    this.isModulePresent = options.isModulePresent ?? (() => true);
    for (const entry of options.manifests ?? []) {
      this.registerManifest(entry.manifest);
    }
  }

  /**
   * Take one module's `blocks` and `blockCategories` declarations.
   *
   * The owner is the block name's first segment, which `defineModuleManifest`
   * has already refused to let differ from the declaring module's `id`. It is
   * read from the name rather than from the manifest so that the registry and
   * the persisted document agree by construction.
   */
  registerManifest(manifest: ModuleManifest): void {
    for (const block of (manifest.blocks ?? []) as BlockDefinition[]) {
      const existing = this.components.get(block.name);
      // **The refusal's subject is two contributors**, which is what D-31 asks
      // for and what defect D-d got wrong by warning and overwriting. One
      // module registering twice — an idempotent re-composition, a harness
      // calling a fixture once per test case — is not a collision, and refusing
      // it produced the sentence `declared by both "x" and "x"`, which is
      // self-evidently not one.
      if (existing && existing.ownerModule !== manifest.id) {
        throw new DuplicateBlockNameError(block.name, existing.ownerModule, manifest.id);
      }
      this.components.set(block.name, {
        ownerModule: block.name.slice(0, block.name.indexOf('.')),
        fields: block.fields,
        contexts: [...block.contexts],
        labelKey: block.labelKey,
        ...(block.descriptionKey !== undefined ? { descriptionKey: block.descriptionKey } : {}),
        category: block.category,
        ...(block.defaultProps !== undefined ? { defaultProps: block.defaultProps } : {}),
        ...(block.responsiveFields !== undefined
          ? { responsiveFields: [...block.responsiveFields] }
          : {}),
        ...(block.previewIcon !== undefined ? { previewIcon: block.previewIcon } : {}),
        ...(block.weight !== undefined ? { weight: block.weight } : {}),
      });
    }
    for (const category of (manifest.blockCategories ?? []) as BlockCategory[]) {
      this.categories.push({ ...category, ownerModule: manifest.id });
    }
  }

  setBreakpointsResolver(resolver: PageBuilderBreakpointsResolver): void {
    this.breakpointsResolver = resolver;
  }

  setColorPaletteResolver(resolver: ColorPaletteResolver): void {
    this.colorPaletteResolver = resolver;
  }

  async resolveBreakpoints(): Promise<PageBuilderBreakpoints> {
    if (this.breakpointsResolver) {
      return this.breakpointsResolver();
    }
    return this.getBreakpoints();
  }

  isComponentRegistered(name: string): boolean {
    return this.components.has(name);
  }

  /**
   * Every declared block name, **unfiltered by presence**.
   *
   * This answers "is this string a block name this platform knows", which the
   * reference registries ask when they decide whether a stored node is a known
   * embed. A switched-off module's blocks are still real names in stored
   * documents, so filtering here would make a present document's node look
   * unknown — a different question with a different right answer from the
   * palette's.
   */
  knownNames(): Set<string> {
    return new Set(this.components.keys());
  }

  getBreakpoints(): PageBuilderBreakpoints {
    return { ...this.breakpoints };
  }

  /**
   * The metadata view used by `GET /api/v1/admin/cms/page-builder/config`.
   *
   * Filters to the effectively present modules and *then* folds the categories,
   * in that order (`contracts/block-definition.md` §4.1). Both outputs are
   * sorted by a function of the declarations alone, so the response is
   * byte-identical under a re-composition or a reordering of `MODULES` — the
   * D-45 property, which a fold at registration cannot have.
   */
  async describe(): Promise<CmsPageBuilderDescriptor> {
    const breakpoints = await this.resolveBreakpoints();
    const colorPalette = this.colorPaletteResolver ? await this.colorPaletteResolver() : [];
    return {
      schemaVersion: this.schemaVersion,
      breakpoints,
      colorPalette,
      components: Array.from(this.components.entries())
        .filter(([, reg]) => this.isModulePresent(reg.ownerModule))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, reg]) => ({
          name,
          ownerModule: reg.ownerModule,
          fields: reg.fields,
          ...(reg.previewIcon !== undefined ? { previewIcon: reg.previewIcon } : {}),
          contexts: reg.contexts ?? ['cms'],
          ...(reg.labelKey !== undefined ? { labelKey: reg.labelKey } : {}),
          ...(reg.descriptionKey !== undefined ? { descriptionKey: reg.descriptionKey } : {}),
          ...(reg.category !== undefined ? { category: reg.category } : {}),
          ...(reg.defaultProps !== undefined ? { defaultProps: reg.defaultProps } : {}),
          ...(reg.responsiveFields !== undefined ? { responsiveFields: reg.responsiveFields } : {}),
          ...(reg.weight !== undefined ? { weight: reg.weight } : {}),
        })),
      categories: this.foldCategories(),
    };
  }

  /**
   * Reduce every `(key, context)` group to one served record.
   *
   * `titleKey`, `weight` and `visible` come from **one** winning declaration and
   * never field by field: a title from one module beside a weight from another
   * is a presentation nobody wrote. The order is lowest `weight` first with an
   * absent `weight` sorting after every declared one, ties broken by the
   * declaring module's `id` ascending — a function of the declarations and of
   * nothing else, so it is stable under re-composition
   * (`contracts/block-definition.md` §1.1).
   */
  private foldCategories(): NonNullable<CmsPageBuilderDescriptor['categories']> {
    const groups = new Map<string, CategoryDeclaration[]>();
    for (const declaration of this.categories) {
      if (!this.isModulePresent(declaration.ownerModule)) continue;
      for (const context of declaration.contexts) {
        const key = `${context} ${declaration.key}`;
        const bucket = groups.get(key);
        if (bucket) bucket.push(declaration);
        else groups.set(key, [declaration]);
      }
    }

    return [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, declarations]) => {
        const context = key.slice(0, key.indexOf(' ')) as PageBuilderContext;
        const winner = [...declarations].sort(compareCategoryDeclarations)[0]!;
        return {
          key: winner.key,
          titleKey: winner.titleKey,
          contexts: [context],
          ...(winner.weight !== undefined ? { weight: winner.weight } : {}),
          ...(winner.visible !== undefined ? { visible: winner.visible } : {}),
          ownerModule: winner.ownerModule,
        };
      });
  }
}

function compareCategoryDeclarations(a: CategoryDeclaration, b: CategoryDeclaration): number {
  const aw = a.weight ?? Number.POSITIVE_INFINITY;
  const bw = b.weight ?? Number.POSITIVE_INFINITY;
  if (aw !== bw) return aw - bw;
  return a.ownerModule < b.ownerModule ? -1 : a.ownerModule > b.ownerModule ? 1 : 0;
}
