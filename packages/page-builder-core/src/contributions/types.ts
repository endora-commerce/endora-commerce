// The shapes a module's Page Builder renderers are contributed in
// (`specs/141-module-block-renderers/contracts/block-renderers.md` §2, §4).
//
// Types only, and only `import type` of Puck: this file is what a module's
// `./storefront` layer and its `./admin` block factories compile against, and
// neither may acquire a runtime dependency by naming a shape.

import type { ComponentConfig, Field } from '@puckeditor/core';

/**
 * One block as the **storefront** draws it: a Puck component config whose
 * `render` is synchronous, SSR-safe and deterministic (contract R2.2).
 *
 * `fields`, `label` and `defaultProps` are accepted because a Puck config
 * carries them, and the storefront reads none of them except `defaultProps`,
 * which is merged under the stored props.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stored props are untrusted whatever a module types them as, and a map of differently-typed blocks has no common props type. A module authors `ComponentConfig<ItsProps>` and assigns it here.
export type StorefrontBlockConfig = ComponentConfig<any>;

/** What a module package's `./storefront` layer exports as `contributions`. */
export interface StorefrontContributions {
  /** Keyed by the persisted block name — `<endora.id>.<LocalName>`. */
  readonly blocks?: Readonly<Record<string, StorefrontBlockConfig>>;
}

/**
 * One block as the **admin CMS editor** draws it — the default export of an
 * `AdminBlockContribution`'s factory for the `cms` context.
 *
 * `render` is required. `fields`, when present, **override** the fields derived
 * from the block's manifest declaration, key by key — a picker in place of a
 * text input. Label, category, default props and the field *set* come from the
 * descriptor the backend serves, never from here.
 */
export type PageBuilderBlockEditorConfig = Omit<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as StorefrontBlockConfig.
  ComponentConfig<any>,
  'fields' | 'label' | 'defaultProps'
> & {
  readonly fields?: Readonly<Record<string, Field>>;
};

/** The ambient a renderer may read during render, set by the host. */
export interface BlockRenderEnvironment {
  /** The request's content language, BCP 47. */
  readonly language: string;
  /** `true` under `?cms_admin=1` and in the admin canvas. */
  readonly preview: boolean;
}

/**
 * Which modules the surface's presence source reports as **not present** —
 * serialisable, so a Server Component can hand it across a `'use client'`
 * boundary, and small: it is the handful an operator switched off, not the
 * sixty that are on.
 *
 * **Absent is something the server says, never something inferred.** An owner
 * the presence source does not list at all — an overlay module's id, which no
 * manifest index carries — is honoured, exactly as the e-mail registry's
 * tri-state probe honours it. Inferring absence from "not in the list of
 * present ids" would switch off every overlay module's block on the storefront.
 *
 * An empty list is also the answer when presence could not be decided (the
 * backend was unreachable): every block renders from its stored props, which
 * is the storefront's existing degrade-open rule.
 */
export interface BlockPresence {
  readonly absent: readonly string[];
}
