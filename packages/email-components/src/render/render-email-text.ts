// Pure plain-text email renderer (feature 047, research R1).
//
// Produces a readable plain-text alternative of the same content tree. Directive
// markers ({{var}}/{{if}}/{{for}}) are left intact for the directive engine.

import type { PuckDataTree } from '../schema/envelope.js';
import type { EmailColumnsProps } from '../schema/component-types.js';

export interface RenderEmailTextEmbeds {
  blocks: Record<string, PuckDataTree>;
  templates: Record<string, PuckDataTree>;
}

export interface RenderEmailTextOptions {
  embeds?: RenderEmailTextEmbeds;
  maxDepth?: number;
}

interface PuckNode {
  type: string;
  props?: Record<string, unknown>;
}

interface Ctx {
  embeds: RenderEmailTextEmbeds;
  depth: number;
  maxDepth: number;
}

function asNodes(tree: PuckDataTree | null | undefined): PuckNode[] {
  if (!tree || !Array.isArray(tree.content)) return [];
  return tree.content.filter(
    (raw): raw is PuckNode =>
      !!raw && typeof raw === 'object' && typeof (raw as PuckNode).type === 'string',
  );
}

function str(props: Record<string, unknown> | undefined, key: string, fallback = ''): string {
  const v = props?.[key];
  return typeof v === 'string' ? v : fallback;
}

function renderNode(node: PuckNode, ctx: Ctx): string {
  const p = node.props ?? {};
  switch (node.type) {
    case 'EmailHeading':
      return `${str(p, 'text')}\n`;
    case 'EmailText':
      return `${str(p, 'text')}\n`;
    case 'EmailButton': {
      const href = str(p, 'href');
      return `${str(p, 'label', 'Button')}${href ? `: ${href}` : ''}\n`;
    }
    case 'EmailImage': {
      const alt = str(p, 'alt');
      return alt ? `[${alt}]\n` : '';
    }
    case 'EmailDivider':
      return `----------------------------------------\n`;
    case 'EmailSpacer':
      return `\n`;
    case 'EmailColumns': {
      const cols = Array.isArray(p['columns']) ? (p['columns'] as EmailColumnsProps['columns']) : [];
      return `${cols.map((c) => c?.text ?? '').join('\t')}\n`;
    }
    case 'EmailInsertBlock':
      return renderEmbed('blocks', str(p, 'code'), ctx);
    case 'EmailInsertTemplate':
      return renderEmbed('templates', str(p, 'code'), ctx);
    default:
      return '';
  }
}

function renderEmbed(kind: 'blocks' | 'templates', code: string, ctx: Ctx): string {
  if (!code || ctx.depth >= ctx.maxDepth) return '';
  const tree = ctx.embeds[kind][code];
  if (!tree) return '';
  return asNodes(tree)
    .map((n) => renderNode(n, { ...ctx, depth: ctx.depth + 1 }))
    .join('');
}

export function renderEmailText(
  tree: PuckDataTree | null | undefined,
  opts: RenderEmailTextOptions = {},
): string {
  const ctx: Ctx = {
    embeds: opts.embeds ?? { blocks: {}, templates: {} },
    depth: 0,
    maxDepth: opts.maxDepth ?? 3,
  };
  return asNodes(tree)
    .map((n) => renderNode(n, ctx))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
