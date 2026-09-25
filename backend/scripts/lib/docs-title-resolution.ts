/**
 * Can Docusaurus resolve a title for this markdown source at all?
 *
 * Docusaurus takes a page title from the front-matter `title`, else from the
 * page's `contentTitle` — the first content node, and only when that node is a
 * level-one heading. Both of those have a precondition nothing in this
 * repository asserted before feature 133: **front matter is front matter only
 * at byte 0**. A `---` block that opens on line 5 because an HTML banner was
 * emitted above it is not parsed, `title`, `sidebar_label` and `description`
 * are inert, and the banner is also the first content node — so neither route
 * to a title is open and the page ships titled with its own doc id.
 *
 * This module is the source-level half of FR-012. It is deliberately a string
 * predicate over one file: the artefact-level half — a `<title>` that equals
 * the doc id in the built HTML — is `verify:docs-build`'s family 9, and reaches
 * the routes that have no markdown source at all.
 */

/** Why no title is reachable. */
export type DocTitleFailure =
  /** A `---` block opens after byte 0, so Docusaurus never parses it. */
  | 'front-matter-not-at-byte-0'
  /** No front-matter `title`, and the first content node is not a `# ` heading. */
  | 'no-title-and-no-heading';

export type DocTitleResolution =
  | { readonly resolvable: true }
  | { readonly resolvable: false; readonly reason: DocTitleFailure };

const RESOLVABLE: DocTitleResolution = { resolvable: true };

function isFence(line: string): boolean {
  return line.trimEnd() === '---';
}

/** The first non-blank content line after `from`, or `null` when there is none. */
function firstContentLine(lines: readonly string[], from: number): string | null {
  for (let index = from; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '') {
      continue;
    }
    return line;
  }
  return null;
}

/** True when the first content node after `from` is a level-one heading. */
function opensWithHeading(lines: readonly string[], from: number): boolean {
  const line = firstContentLine(lines, from);
  return line !== null && /^#\s+\S/.test(line.trimEnd());
}

/**
 * Index of the closing `---` of a front-matter block opened at `open`, or `-1`.
 */
function closingFence(lines: readonly string[], open: number): number {
  for (let index = open + 1; index < lines.length; index += 1) {
    if (isFence(lines[index]!)) {
      return index;
    }
  }
  return -1;
}

function declaresTitle(block: readonly string[]): boolean {
  return block.some((line) => /^title\s*:/.test(line));
}

/**
 * Where a *late* front-matter block opens, or `-1`.
 *
 * The shape this recognises is narrow on purpose: everything above the block is
 * blank lines and HTML comments. That is exactly the generator's
 * banner-before-front-matter emission, and it cannot be confused with a
 * thematic break in prose — which is what a bare `---` means anywhere else in a
 * markdown document, and which must never be reported.
 */
function lateFrontMatterOpensAt(lines: readonly string[]): number {
  let index = 0;
  let sawComment = false;
  let insideComment = false;
  while (index < lines.length) {
    const text = lines[index]!.trim();
    if (insideComment) {
      if (text.endsWith('-->')) {
        insideComment = false;
      }
      index += 1;
      continue;
    }
    if (text === '') {
      index += 1;
      continue;
    }
    if (text.startsWith('<!--')) {
      sawComment = true;
      if (!text.endsWith('-->')) {
        insideComment = true;
      }
      index += 1;
      continue;
    }
    break;
  }
  if (!sawComment || index >= lines.length || !isFence(lines[index]!)) {
    return -1;
  }
  return closingFence(lines, index) === -1 ? -1 : index;
}

/** Whether Docusaurus can resolve any title for this source text. */
export function resolveDocTitle(source: string): DocTitleResolution {
  const text = source.replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  if (lines.length > 0 && isFence(lines[0]!)) {
    const close = closingFence(lines, 0);
    if (close === -1) {
      // An unterminated opening fence is not front matter; the body starts at 0.
      return opensWithHeading(lines, 0)
        ? RESOLVABLE
        : { resolvable: false, reason: 'no-title-and-no-heading' };
    }
    if (declaresTitle(lines.slice(1, close))) {
      return RESOLVABLE;
    }
    return opensWithHeading(lines, close + 1)
      ? RESOLVABLE
      : { resolvable: false, reason: 'no-title-and-no-heading' };
  }

  if (lateFrontMatterOpensAt(lines) !== -1) {
    return { resolvable: false, reason: 'front-matter-not-at-byte-0' };
  }

  return opensWithHeading(lines, 0)
    ? RESOLVABLE
    : { resolvable: false, reason: 'no-title-and-no-heading' };
}
