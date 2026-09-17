import { createHash } from 'node:crypto';

import type { Root } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

const PLACEHOLDER_PREFIX = '⟦EC';
const PLACEHOLDER_SUFFIX = '⟧';

/** Result of splitting a markdown file into an opaque prefix and translatable body. */
export interface FrontMatterSplit {
  /** Preamble, front matter block and the newline after it — not sent to MT. */
  readonly prefix: string;
  /** Markdown body whose prose is segmented for translation. */
  readonly body: string;
}

/** Segmented markdown ready for MT placeholder substitution. */
export interface MarkdownSegments {
  readonly prefix: string;
  readonly segments: readonly string[];
  readonly placeholderBody: string;
}

interface TextRange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function stripBom(source: string): string {
  return source.startsWith('\uFEFF') ? source.slice(1) : source;
}

function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function frontMatterBlockStart(source: string): number {
  if (source.startsWith('---\n') || source.startsWith('---\r\n')) {
    return 0;
  }
  const match = /\n---[\r\n]/.exec(source);
  return match === null ? -1 : match.index + 1;
}

/**
 * Split a markdown file into an opaque prefix (preamble + YAML front matter) and
 * the remaining body. Front matter may follow an HTML preamble (generated reference pages).
 */
export function splitFrontMatter(source: string): FrontMatterSplit {
  const text = stripBom(source);
  const start = frontMatterBlockStart(text);
  if (start === -1) {
    return { prefix: '', body: text };
  }

  const lineBreak = text.indexOf('\n', start);
  if (lineBreak === -1) {
    return { prefix: '', body: text };
  }

  const close = text.indexOf('\n---', lineBreak + 1);
  if (close === -1) {
    return { prefix: '', body: text };
  }

  const afterClose = close + 4;
  const trailingNewline = text[afterClose] === '\n' ? 1 : 0;
  const prefixEnd = afterClose + trailingNewline;
  return {
    prefix: text.slice(0, prefixEnd),
    body: text.slice(prefixEnd),
  };
}

/** sha256 of the normalised English body with front matter stripped (plan § cache entry). */
export function hashSourceBody(source: string): string {
  const { body } = splitFrontMatter(source);
  return createHash('sha256').update(normalizeLineEndings(body), 'utf8').digest('hex');
}

function placeholderFor(index: number): string {
  return `${PLACEHOLDER_PREFIX}${String(index + 1).padStart(3, '0')}${PLACEHOLDER_SUFFIX}`;
}

function collectTranslatableRanges(body: string): TextRange[] {
  const tree = unified().use(remarkParse).parse(body) as Root;
  const ranges: TextRange[] = [];

  visit(tree, (node): void | typeof SKIP => {
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'html') {
      return SKIP;
    }
    if (node.type !== 'text') {
      return undefined;
    }
    const position = node.position;
    if (position?.start.offset === undefined || position.end.offset === undefined) {
      return undefined;
    }
    if (node.value.length === 0) {
      return undefined;
    }
    ranges.push({
      start: position.start.offset,
      end: position.end.offset,
      text: body.slice(position.start.offset, position.end.offset),
    });
  });

  return ranges;
}

function applyPlaceholders(body: string, ranges: readonly TextRange[]): MarkdownSegments {
  const segments = ranges.map((range) => range.text);
  let placeholderBody = body;
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index]!;
    placeholderBody =
      placeholderBody.slice(0, range.start) +
      placeholderFor(index) +
      placeholderBody.slice(range.end);
  }
  return { prefix: '', segments, placeholderBody };
}

/** Extract translatable text runs from markdown, preserving code fences and inline code. */
export function segmentMarkdown(source: string): MarkdownSegments {
  const { prefix, body } = splitFrontMatter(source);
  const segmented = applyPlaceholders(body, collectTranslatableRanges(body));
  return { prefix, segments: segmented.segments, placeholderBody: segmented.placeholderBody };
}

/** Restore translated segments into markdown, re-attaching the opaque prefix. */
export function restoreSegmentMarkdown(
  segmented: MarkdownSegments,
  translations: readonly string[],
): string {
  if (translations.length !== segmented.segments.length) {
    throw new Error(
      `[docs-markdown-segments] expected ${segmented.segments.length} translations, got ${translations.length}.`,
    );
  }

  let body = segmented.placeholderBody;
  for (let index = 0; index < translations.length; index += 1) {
    const placeholder = placeholderFor(index);
    if (!body.includes(placeholder)) {
      throw new Error(`[docs-markdown-segments] missing placeholder ${placeholder}.`);
    }
    body = body.replace(placeholder, translations[index]!);
  }

  return segmented.prefix + body;
}
