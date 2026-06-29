// Pure email-HTML renderer (feature 047, research R1).
//
// Walks a Puck data tree and emits table-based, inline-styled HTML safe for the
// broadest set of email clients (no flexbox/grid/script/web-font dependency).
// React-free so the backend can call it on the send path. Directive markers
// ({{var}}/{{if}}/{{for}}) are left intact for the directive engine to resolve.

import type { PuckDataTree } from '../schema/envelope.js';
import type {
  EmailAlign,
  EmailButtonProps,
  EmailColumnsProps,
  EmailHeadingProps,
  EmailImageProps,
  EmailSpacerProps,
  EmailTextProps,
} from '../schema/component-types.js';
import { escapeAttr, escapeHtml } from './escape-html.js';

export interface EmailRenderEmbeds {
  blocks: Record<string, PuckDataTree>;
  templates: Record<string, PuckDataTree>;
}

export interface RenderEmailHtmlOptions {
  embeds?: EmailRenderEmbeds;
  accentColor?: string;
  maxDepth?: number;
  /** Wrap the body in a full HTML document shell. Default true. */
  document?: boolean;
}

interface PuckNode {
  type: string;
  props?: Record<string, unknown>;
}

interface RenderCtx {
  embeds: EmailRenderEmbeds;
  accent: string;
  depth: number;
  maxDepth: number;
}

const DEFAULT_ACCENT = '#1f2937';
const DEFAULT_MAX_DEPTH = 3;

function asNodes(tree: PuckDataTree | null | undefined): PuckNode[] {
  if (!tree || !Array.isArray(tree.content)) return [];
  const out: PuckNode[] = [];
  for (const raw of tree.content) {
    if (raw && typeof raw === 'object' && typeof (raw as PuckNode).type === 'string') {
      out.push(raw as PuckNode);
    }
  }
  return out;
}

function str(props: Record<string, unknown> | undefined, key: string, fallback = ''): string {
  const v = props?.[key];
  return typeof v === 'string' ? v : fallback;
}

function num(props: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = props?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function align(props: Record<string, unknown> | undefined, fallback: EmailAlign = 'left'): EmailAlign {
  const v = props?.['align'];
  return v === 'left' || v === 'center' || v === 'right' ? v : fallback;
}

function multiline(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br />');
}

// One outer table row wrapping a cell — the email-safe unit of vertical stacking.
function row(inner: string, padding = '0 24px'): string {
  return `<tr><td style="padding:${padding};font-family:Arial,Helvetica,sans-serif;">${inner}</td></tr>`;
}

function renderHeading(p: EmailHeadingProps): string {
  const size = p.level === 'h1' ? '28px' : p.level === 'h2' ? '22px' : '18px';
  return row(
    `<${p.level} style="margin:0;padding:12px 0;font-size:${size};line-height:1.3;color:#15202b;text-align:${p.align};font-weight:bold;">${multiline(
      p.text,
    )}</${p.level}>`,
  );
}

function renderText(p: EmailTextProps): string {
  return row(
    `<p style="margin:0;padding:8px 0;font-size:15px;line-height:1.5;color:#1f2937;text-align:${p.align};">${multiline(
      p.text,
    )}</p>`,
  );
}

function renderButton(p: EmailButtonProps, accent: string): string {
  const bg = p.backgroundColor || accent;
  const fg = p.textColor || '#ffffff';
  const href = p.href || '#';
  const btn =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;">` +
    `<tr><td style="background-color:${escapeAttr(bg)};border-radius:6px;">` +
    `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer" ` +
    `style="display:inline-block;padding:12px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;` +
    `font-weight:bold;color:${escapeAttr(fg)};text-decoration:none;">${escapeHtml(p.label)}</a>` +
    `</td></tr></table>`;
  return row(`<div style="text-align:${p.align};">${btn}</div>`);
}

function renderImage(p: EmailImageProps): string {
  if (!p.src) return '';
  const img =
    `<img src="${escapeAttr(p.src)}" alt="${escapeAttr(p.alt)}" width="${p.width}" ` +
    `style="display:block;border:0;outline:none;max-width:100%;height:auto;width:${p.width}px;" />`;
  const wrapped = p.href
    ? `<a href="${escapeAttr(p.href)}" target="_blank" rel="noreferrer">${img}</a>`
    : img;
  return row(`<div style="text-align:${p.align};">${wrapped}</div>`);
}

function renderSpacer(p: EmailSpacerProps): string {
  const h = Math.max(0, p.height);
  return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`;
}

function renderDivider(): string {
  return row(
    `<hr style="border:0;border-top:1px solid #e5e7eb;margin:8px 0;" />`,
  );
}

function renderColumns(p: EmailColumnsProps): string {
  const cells = Array.isArray(p.columns) ? p.columns : [];
  if (cells.length === 0) return '';
  const width = Math.floor(100 / cells.length);
  const tds = cells
    .map(
      (c) =>
        `<td valign="top" style="width:${width}%;padding:0 8px;font-family:Arial,Helvetica,sans-serif;` +
        `font-size:15px;line-height:1.5;color:#1f2937;">${multiline(c?.text ?? '')}</td>`,
    )
    .join('');
  return row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${tds}</tr></table>`,
  );
}

function renderEmbed(
  kind: 'blocks' | 'templates',
  code: string,
  ctx: RenderCtx,
): string {
  if (!code || ctx.depth >= ctx.maxDepth) return '';
  const tree = ctx.embeds[kind][code];
  if (!tree) return '';
  return renderNodes(asNodes(tree), { ...ctx, depth: ctx.depth + 1 });
}

function renderNode(node: PuckNode, ctx: RenderCtx): string {
  const p = node.props ?? {};
  switch (node.type) {
    case 'EmailHeading':
      return renderHeading({ level: (p['level'] as EmailHeadingProps['level']) ?? 'h2', text: str(p, 'text'), align: align(p) });
    case 'EmailText':
      return renderText({ text: str(p, 'text'), align: align(p) });
    case 'EmailButton':
      return renderButton(
        {
          label: str(p, 'label', 'Button'),
          href: str(p, 'href'),
          align: align(p, 'left'),
          backgroundColor: str(p, 'backgroundColor'),
          textColor: str(p, 'textColor'),
        },
        ctx.accent,
      );
    case 'EmailImage':
      return renderImage({
        src: str(p, 'src'),
        alt: str(p, 'alt'),
        href: str(p, 'href'),
        width: num(p, 'width', 200),
        align: align(p, 'center'),
      });
    case 'EmailDivider':
      return renderDivider();
    case 'EmailSpacer':
      return renderSpacer({ height: num(p, 'height', 16) });
    case 'EmailColumns':
      return renderColumns({ columns: Array.isArray(p['columns']) ? (p['columns'] as EmailColumnsProps['columns']) : [] });
    case 'EmailInsertBlock':
      return renderEmbed('blocks', str(p, 'code'), ctx);
    case 'EmailInsertTemplate':
      return renderEmbed('templates', str(p, 'code'), ctx);
    default:
      // Unknown / non-email-safe component: contribute nothing (defensive).
      return '';
  }
}

function renderNodes(nodes: PuckNode[], ctx: RenderCtx): string {
  return nodes.map((n) => renderNode(n, ctx)).join('');
}

function wrapDocument(body: string): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /></head>` +
    `<body style="margin:0;padding:0;background-color:#f3f4f6;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:600px;max-width:600px;background-color:#ffffff;border-radius:8px;">` +
    body +
    `</table></td></tr></table></body></html>`
  );
}

export function renderEmailHtml(
  tree: PuckDataTree | null | undefined,
  opts: RenderEmailHtmlOptions = {},
): string {
  const ctx: RenderCtx = {
    embeds: opts.embeds ?? { blocks: {}, templates: {} },
    accent: opts.accentColor ?? DEFAULT_ACCENT,
    depth: 0,
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
  const body = renderNodes(asNodes(tree), ctx);
  return opts.document === false ? body : wrapDocument(body);
}
