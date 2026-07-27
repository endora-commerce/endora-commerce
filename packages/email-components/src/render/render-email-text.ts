// Pure plain-text email renderer (feature 047 + email builder expansion).

import type { PuckDataTree } from '../schema/envelope.js';
import type { EmailSocialProps } from '../schema/component-types.js';
import { EMAIL_ORDER_LABELED_FIELDS } from '../schema/component-types.js';
import { emailHtmlToPlainText } from './sanitize-email-html.js';

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
  tree: PuckDataTree;
}

function asNodes(list: unknown[] | null | undefined): PuckNode[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (raw): raw is PuckNode =>
      !!raw && typeof raw === 'object' && typeof (raw as PuckNode).type === 'string',
  );
}

function treeContent(tree: PuckDataTree | null | undefined): PuckNode[] {
  return asNodes(tree?.content);
}

function str(props: Record<string, unknown> | undefined, key: string, fallback = ''): string {
  const v = props?.[key];
  return typeof v === 'string' ? v : fallback;
}

function slotChildren(node: PuckNode, ctx: Ctx, slotName = 'content'): PuckNode[] {
  const id = node.props?.['id'];
  if (typeof id === 'string' && ctx.tree.zones) {
    const zone = ctx.tree.zones[`${id}:${slotName}`];
    if (Array.isArray(zone) && zone.length > 0) return asNodes(zone);
  }
  const inline = node.props?.[slotName];
  if (Array.isArray(inline)) return asNodes(inline);
  return [];
}

function renderNode(node: PuckNode, ctx: Ctx): string {
  const p = node.props ?? {};
  switch (node.type) {
    case 'EmailHeading':
    case 'EmailText':
    case 'EmailCallout':
    case 'EmailFooterLegal':
      return `${str(p, 'text')}\n`;
    case 'EmailRichText':
      return `${emailHtmlToPlainText(str(p, 'html'))}\n`;
    case 'EmailButton': {
      const href = str(p, 'href');
      return `${str(p, 'label', 'Button')}${href ? `: ${href}` : ''}\n`;
    }
    case 'EmailImage':
    case 'EmailLogo': {
      const alt = str(p, 'alt');
      return alt ? `[${alt}]\n` : '';
    }
    case 'EmailDivider':
      return `----------------------------------------\n`;
    case 'EmailSpacer':
      return `\n`;
    case 'EmailTable': {
      const headers = Array.isArray(p['columns'])
        ? (p['columns'] as Array<{ label?: string }>).map((c) => c?.label ?? '').join('\t')
        : '';
      const rows = Array.isArray(p['tableRows'])
        ? (p['tableRows'] as Array<{ cells?: Array<{ value?: string }> }>)
            .map((row) => (row.cells ?? []).map((c) => c?.value ?? '').join('\t'))
            .join('\n')
        : '';
      return `${[headers, rows].filter(Boolean).join('\n')}\n`;
    }
    case 'EmailSection':
      return slotChildren(node, ctx)
        .map((n) => renderNode(n, ctx))
        .join('');
    case 'EmailRow': {
      const cols = slotChildren(node, ctx, 'content').filter((n) => n.type === 'EmailColumn');
      return (
        cols
          .map((col) =>
            slotChildren(col, ctx, 'content')
              .map((n) => renderNode(n, ctx))
              .join(''),
          )
          .filter(Boolean)
          .join('\n') + (cols.length ? '\n' : '')
      );
    }
    case 'EmailColumn':
      return slotChildren(node, ctx, 'content')
        .map((n) => renderNode(n, ctx))
        .join('');
    case 'EmailProductCard':
      return [str(p, 'title'), str(p, 'sku'), str(p, 'price'), str(p, 'href')].filter(Boolean).join(' — ') + '\n';
    case 'EmailProductGrid': {
      const items = Array.isArray(p['items'])
        ? (p['items'] as Array<{ title?: string; sku?: string; price?: string; href?: string }>)
        : [];
      return (
        items
          .map((item) => [item?.title, item?.sku, item?.price, item?.href].filter(Boolean).join(' — '))
          .filter(Boolean)
          .join('\n') + (items.length ? '\n' : '')
      );
    }
    case 'EmailCategoryGrid': {
      const items = Array.isArray(p['items'])
        ? (p['items'] as Array<{ title?: string; href?: string }>)
        : [];
      return (
        items
          .map((item) => [item?.title, item?.href].filter(Boolean).join(' — '))
          .filter(Boolean)
          .join('\n') + (items.length ? '\n' : '')
      );
    }
    case 'EmailOrderSummary': {
      if (typeof p['body'] === 'string' && !('showName' in p)) {
        return `${str(p, 'title', 'Order summary')}\n${str(p, 'body')}\n`;
      }
      const lines = [str(p, 'title', 'Order summary')];
      lines.push('{{for item in order.items}}');
      const parts: string[] = [];
      if (p['showSku'] === true) parts.push('{{var item.sku}}');
      if (p['showName'] !== false) parts.push('{{var item.name}}');
      if (p['showQuantity'] !== false) parts.push('× {{var item.quantity}}');
      if (p['showPrice'] !== false) parts.push('{{var item.price}}');
      lines.push(parts.join(' '));
      lines.push('{{/for}}');
      if (p['showTotals'] === true) lines.push('{{var order.summaryText}}');
      return `${lines.join('\n')}\n`;
    }
    case 'EmailOrderId':
    case 'EmailBillingAddress':
    case 'EmailShippingAddress':
    case 'EmailOrderTotals':
    case 'EmailAppliedDiscounts':
    case 'EmailDeliveryMethod':
    case 'EmailPaymentMethod': {
      const meta = EMAIL_ORDER_LABELED_FIELDS[node.type];
      const title = str(p, 'title', meta.defaultTitle);
      return `${title ? `${title}\n` : ''}{{var ${meta.varKey}}}\n`;
    }
    case 'EmailSocial': {
      const links = Array.isArray(p['links']) ? (p['links'] as EmailSocialProps['links']) : [];
      return `${links.map((l) => l?.href ?? '').filter(Boolean).join(' ')}\n`;
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
  return treeContent(tree)
    .map((n) => renderNode(n, { ...ctx, tree, depth: ctx.depth + 1 }))
    .join('');
}

export function renderEmailText(
  tree: PuckDataTree | null | undefined,
  opts: RenderEmailTextOptions = {},
): string {
  const safeTree: PuckDataTree = tree ?? { root: { props: {} }, content: [], zones: {} };
  const ctx: Ctx = {
    embeds: opts.embeds ?? { blocks: {}, templates: {} },
    depth: 0,
    maxDepth: opts.maxDepth ?? 3,
    tree: safeTree,
  };
  return treeContent(safeTree)
    .map((n) => renderNode(n, ctx))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
