// E-mail block renderers a module contributes
// (`specs/141-module-block-renderers/contracts/block-renderers.md` §3).
//
// React-free and I/O-free on purpose: one function per block is run by the
// backend send path, by the admin editor's canvas and by the admin's HTML
// preview, so what an operator previews is what is sent. This file holds the
// contract and the one host routine both renderers share; it knows no block.

/** What the host hands a contributed renderer for one node. */
export interface EmailBlockRenderContext {
  /** The content language of the message being rendered, BCP 47. */
  readonly language: string;
  /** The brand accent colour the first-party blocks use. */
  readonly accentColor: string;
  /**
   * Renders a slot of this node — nested content — with the **host's** own node
   * renderer, so a first-party child and another module's child both render,
   * and a child's failure is isolated like any other block's. Returns HTML from
   * `html` and plain text from `text`. Anything that is not a list of nodes
   * renders as the empty string.
   */
  readonly renderSlot: (nodes: unknown) => string;
}

/**
 * One block, drawn for e-mail.
 *
 * `html` returns a fragment of the table layout `renderEmailHtml` writes — one
 * or more `<tr>…</tr>` — with every prop escaped through `escapeHtml` /
 * `escapeAttr`. `{{…}}` directives in the output are resolved by the host
 * afterwards, exactly as for a first-party block.
 */
export interface EmailBlockRenderer<P = Record<string, unknown>> {
  readonly html: (props: P, ctx: EmailBlockRenderContext) => string;
  /** Absent → the host derives the text from `html` with `emailHtmlToPlainText`. */
  readonly text?: (props: P, ctx: EmailBlockRenderContext) => string;
  /** Merged **under** the stored props, so a prop added later has a value. */
  readonly defaultProps?: Partial<P>;
}

/**
 * Renderers keyed by the persisted block name, `<module>.<Name>`.
 *
 * The value's props are `any` rather than `Record<string, unknown>` so a module
 * can type its own props: stored props are untrusted input whatever the
 * declared type says, and a map of differently-typed renderers has no common
 * props type to name.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see the doc block above.
export type EmailBlockRenderers = Readonly<Record<string, EmailBlockRenderer<any>>>;

/** Told about a renderer that threw; the block contributed `''`. */
export type EmailBlockErrorHandler = (blockName: string, error: unknown) => void;

/** The options both `renderEmailHtml` and `renderEmailText` accept. */
export interface EmailBlockRenderingOptions {
  /**
   * Renderers for names the host does not draw itself. Consulted **only** for a
   * name no first-party `case` answers, so a first-party block is never
   * overridable.
   */
  blockRenderers?: EmailBlockRenderers;
  onBlockError?: EmailBlockErrorHandler;
}

/**
 * Run one contributed renderer for one node: defaults under the stored props,
 * a throw contained and reported, `''` when nothing answers the name.
 */
export function renderContributedBlock(
  blockName: string,
  props: Record<string, unknown>,
  options: EmailBlockRenderingOptions,
  draw: (renderer: EmailBlockRenderer, merged: Record<string, unknown>) => string,
): string {
  const renderers = options.blockRenderers;
  // `Object.hasOwn`, never `in`: stored content chooses the name, and
  // `constructor` or `toString` must not resolve to something inherited.
  if (renderers === undefined || !Object.hasOwn(renderers, blockName)) return '';
  const renderer = renderers[blockName] as EmailBlockRenderer;
  try {
    const drawn = draw(renderer, { ...(renderer.defaultProps ?? {}), ...props });
    return typeof drawn === 'string' ? drawn : '';
  } catch (error) {
    options.onBlockError?.(blockName, error);
    return '';
  }
}

/** One contributed block that threw while a message was being rendered. */
export interface EmailBlockFailure {
  readonly block: string;
  /** The module the block name states as its owner, or `null` if it states none. */
  readonly owner: string | null;
  readonly error: unknown;
}

/** Told about each {@link EmailBlockFailure}; a send path logs it. */
export type EmailBlockFailureReporter = (failure: EmailBlockFailure) => void;

/**
 * The renderer options for one render, from a table of contributed renderers
 * and a reporter.
 *
 * Both e-mail producers build their options here so that a failure is reported
 * the same way whichever sent the message: the block, and the module its name
 * states as its owner — which is what an operator needs to know whom to ask.
 * The owner is read off the name (`<module>.<Name>`) rather than looked up,
 * because this file knows no registry.
 */
export function emailBlockRendering(
  blockRenderers: EmailBlockRenderers | undefined,
  report?: EmailBlockFailureReporter,
): EmailBlockRenderingOptions {
  if (blockRenderers === undefined) return {};
  return {
    blockRenderers,
    onBlockError: (block, error) => {
      const separator = block.indexOf('.');
      report?.({ block, owner: separator > 0 ? block.slice(0, separator) : null, error });
    },
  };
}
