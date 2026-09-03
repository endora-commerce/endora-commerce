// Pure email-HTML renderer (feature 047 + email builder expansion).
// Table-based, inline-styled HTML. Directive markers left intact for the engine.

import type { PuckDataTree } from '../schema/envelope.js';
import type {
  EmailAlign,
  EmailButtonProps,
  EmailCalloutProps,
  EmailDividerProps,
  EmailFooterLegalProps,
  EmailHeadingProps,
  EmailImageProps,
  EmailLogoProps,
  EmailOrderLabeledVarProps,
  EmailOrderSummaryProps,
  EmailProductCardProps,
  EmailProductGridProps,
  EmailCategoryGridProps,
  EmailRichTextProps,
  EmailRowProps,
  EmailSectionProps,
  EmailSocialNetwork,
  EmailSocialProps,
  EmailSpacerProps,
  EmailTableProps,
  EmailTextProps,
  EmailVerticalAlign,
} from '../schema/component-types.js';
import {
  EMAIL_ORDER_BLOCK_MARGIN_DEFAULT,
  EMAIL_ORDER_LABELED_FIELDS,
} from '../schema/component-types.js';
import { escapeAttr, escapeHtml } from './escape-html.js';
import { orderSummaryColumnLabels } from './order-labels.js';
import { emailHtmlToPlainText, sanitizeEmailHtml } from './sanitize-email-html.js';
import {
  EMAIL_SOCIAL_BRAND_COLORS,
  EMAIL_SOCIAL_LABELS,
  socialIconDataUri,
} from './social-icon-svg.js';

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
  /** Locale for built-in strings (e.g. order table column headers). */
  language?: string;
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
  tree: PuckDataTree;
  language: string;
}

const DEFAULT_ACCENT = '#1f2937';
const DEFAULT_MAX_DEPTH = 3;

function bool(props: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  const v = props?.[key];
  if (typeof v === 'boolean') return v;
  // Puck radio fields sometimes persist Yes/No as strings.
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function asNodes(list: unknown[] | null | undefined): PuckNode[] {
  if (!Array.isArray(list)) return [];
  const out: PuckNode[] = [];
  for (const raw of list) {
    if (raw && typeof raw === 'object' && typeof (raw as PuckNode).type === 'string') {
      out.push(raw as PuckNode);
    }
  }
  return out;
}

function treeContent(tree: PuckDataTree | null | undefined): PuckNode[] {
  return asNodes(tree?.content);
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

/** Nested column content uses tighter horizontal padding than the outer mail shell. */
const cellPaddingStack: string[] = ['0 24px'];

function withCellPadding<T>(padding: string, fn: () => T): T {
  cellPaddingStack.push(padding);
  try {
    return fn();
  } finally {
    cellPaddingStack.pop();
  }
}

function row(inner: string, padding?: string, extraTdStyle = ''): string {
  const pad = padding ?? cellPaddingStack[cellPaddingStack.length - 1] ?? '0 24px';
  return `<tr><td style="padding:${pad};font-family:Arial,Helvetica,sans-serif;${extraTdStyle}">${inner}</td></tr>`;
}

function orderBlockPadding(marginTop?: number, marginBottom?: number): string {
  const top = Math.max(0, marginTop ?? EMAIL_ORDER_BLOCK_MARGIN_DEFAULT);
  const bottom = Math.max(0, marginBottom ?? EMAIL_ORDER_BLOCK_MARGIN_DEFAULT);
  return `${top}px 24px ${bottom}px 24px`;
}

/** Resolve Puck slot children from zones (`id:slot`) or inline props.content. */
function slotChildren(node: PuckNode, ctx: RenderCtx, slotName = 'content'): PuckNode[] {
  const id = node.props?.['id'];
  if (typeof id === 'string' && ctx.tree.zones) {
    const zone = ctx.tree.zones[`${id}:${slotName}`];
    if (Array.isArray(zone) && zone.length > 0) return asNodes(zone);
  }
  const inline = node.props?.[slotName];
  if (Array.isArray(inline)) return asNodes(inline);
  return [];
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
  const margin =
    p.align === 'center' ? '0 auto' : p.align === 'right' ? '0 0 0 auto' : '0';
  const img =
    `<img src="${escapeAttr(p.src)}" alt="${escapeAttr(p.alt)}" width="${p.width}" ` +
    `style="display:block;border:0;outline:none;max-width:100%;height:auto;width:${p.width}px;margin:${margin};" />`;
  const wrapped = p.href
    ? `<a href="${escapeAttr(p.href)}" target="_blank" rel="noreferrer" style="display:inline-block;margin:${margin};">${img}</a>`
    : img;
  // Table cell align is more reliable than text-align + display:block img.
  return `<tr><td align="${p.align}" style="padding:0 24px;font-family:Arial,Helvetica,sans-serif;">${wrapped}</td></tr>`;
}

function renderLogo(p: EmailLogoProps): string {
  return renderImage({
    src: p.src,
    alt: p.alt || 'Logo',
    href: p.href,
    width: p.width || 160,
    align: p.align || 'center',
  });
}

function renderSpacer(p: EmailSpacerProps): string {
  const h = Math.max(0, p.height);
  return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`;
}

function renderDivider(p: EmailDividerProps): string {
  const thickness = Math.min(8, Math.max(1, p.thickness || 1));
  const color = p.color || '#e5e7eb';
  return row(
    `<hr style="border:0;border-top:${thickness}px solid ${escapeAttr(color)};margin:8px 0;" />`,
  );
}

function renderSection(p: EmailSectionProps, innerRows: string): string {
  const bg = p.backgroundColor || 'transparent';
  const py = Math.max(0, p.paddingY ?? 16);
  const px = Math.max(0, p.paddingX ?? 24);
  return (
    `<tr><td style="padding:0;background-color:${escapeAttr(bg)};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="padding:${py}px ${px}px;font-family:Arial,Helvetica,sans-serif;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${innerRows}</table>` +
    `</td></tr></table></td></tr>`
  );
}

function wrapAsInnerTable(innerRows: string): string {
  if (!innerRows) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${innerRows}</table>`;
}

function renderRow(
  p: EmailRowProps,
  columns: Array<{ innerRows: string; span: number }>,
): string {
  if (columns.length === 0) return '';
  const gap = Math.max(0, p.gap ?? 16);
  const valign: EmailVerticalAlign =
    p.verticalAlign === 'middle' || p.verticalAlign === 'bottom' ? p.verticalAlign : 'top';
  const n = columns.length;
  const spanTotal = columns.reduce((sum, col) => sum + Math.max(1, col.span || 1), 0) || n;
  const halfGap = Math.floor(gap / 2);
  const tds = columns
    .map((col, i) => {
      const span = Math.max(1, col.span || 1);
      const widthPct = Math.max(1, Math.floor((100 * span) / spanTotal));
      const padLeft = i === 0 ? 0 : halfGap;
      const padRight = i === n - 1 ? 0 : gap - halfGap;
      return (
        `<td width="${widthPct}%" valign="${valign}" ` +
        `style="width:${widthPct}%;vertical-align:${valign};padding:0 ${padRight}px 0 ${padLeft}px;font-family:Arial,Helvetica,sans-serif;">` +
        wrapAsInnerTable(col.innerRows) +
        `</td>`
      );
    })
    .join('');
  return row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;table-layout:fixed;">` +
      `<tr>${tds}</tr></table>`,
  );
}

function renderRichText(p: EmailRichTextProps): string {
  const safe = sanitizeEmailHtml(p.html || '');
  if (!safe) return '';
  return row(`<div style="text-align:${p.align};font-size:15px;line-height:1.5;color:#1f2937;">${safe}</div>`);
}

function renderProductCard(p: EmailProductCardProps, accent: string): string {
  const showImage = p.showImage;
  const showPrice = p.showPrice;
  const showSku = p.showSku;
  let img = '';
  if (showImage) {
    if (p.imageSrc) {
      img = `<img src="${escapeAttr(p.imageSrc)}" alt="" width="120" style="display:block;border:0;max-width:120px;height:auto;" />`;
    } else {
      img =
        `<div style="width:120px;height:120px;background-color:#f3f4f6;border:1px solid #e5e7eb;` +
        `font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;text-align:center;line-height:120px;">No image</div>`;
    }
  }
  const cta =
    p.href && p.ctaLabel
      ? `<a href="${escapeAttr(p.href)}" target="_blank" rel="noreferrer" ` +
        `style="display:inline-block;margin-top:8px;padding:10px 16px;background-color:${escapeAttr(accent)};` +
        `color:#ffffff;text-decoration:none;font-weight:bold;border-radius:6px;font-size:13px;">${escapeHtml(p.ctaLabel)}</a>`
      : '';
  const body =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    (img ? `<td valign="top" style="width:128px;padding-right:16px;">${img}</td>` : '') +
    `<td valign="top" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;text-align:${p.align || 'left'};">` +
    `<div style="font-weight:bold;margin-bottom:4px;">${multiline(p.title)}</div>` +
    (showSku && p.sku ? `<div style="margin-bottom:4px;font-size:13px;color:#6b7280;">${multiline(p.sku)}</div>` : '') +
    (showPrice && p.price ? `<div style="margin-bottom:4px;">${multiline(p.price)}</div>` : '') +
    cta +
    `</td></tr></table>`;
  return row(body, '12px 24px');
}

function renderProductGrid(p: EmailProductGridProps, accent: string): string {
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length === 0) return '';
  const columns = Math.min(3, Math.max(1, p.columns || 2));
  const gap = Math.max(0, p.gap ?? 16);
  const halfGap = Math.floor(gap / 2);
  const showImage = p.showImage;
  const showPrice = p.showPrice;
  const showSku = p.showSku;
  const ctaLabel = p.ctaLabel || 'View';
  const widthPct = Math.floor(100 / columns);
  const rowsHtml: string[] = [];
  for (let i = 0; i < items.length; i += columns) {
    const slice = items.slice(i, i + columns);
    while (slice.length < columns) slice.push(null as never);
    const tds = slice
      .map((item, ci) => {
        const padLeft = ci === 0 ? 0 : halfGap;
        const padRight = ci === columns - 1 ? 0 : gap - halfGap;
        if (!item) {
          return `<td width="${widthPct}%" style="width:${widthPct}%;padding:0 ${padRight}px 12px ${padLeft}px;"></td>`;
        }
        const img =
          showImage && item.imageSrc
            ? `<img src="${escapeAttr(item.imageSrc)}" alt="" width="100%" style="display:block;border:0;max-width:100%;height:auto;margin-bottom:8px;" />`
            : showImage
              ? `<div style="width:100%;height:100px;background:#f3f4f6;margin-bottom:8px;"></div>`
              : '';
        const cta = item.href
          ? `<a href="${escapeAttr(item.href)}" target="_blank" rel="noreferrer" style="display:inline-block;margin-top:8px;padding:8px 12px;background-color:${escapeAttr(accent)};color:#ffffff;text-decoration:none;font-size:12px;font-weight:bold;border-radius:4px;">${escapeHtml(ctaLabel)}</a>`
          : '';
        return (
          `<td width="${widthPct}%" valign="top" style="width:${widthPct}%;padding:0 ${padRight}px 12px ${padLeft}px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;">` +
          img +
          `<div style="font-weight:bold;margin-bottom:4px;">${multiline(item.title)}</div>` +
          (showSku && item.sku ? `<div style="font-size:12px;color:#6b7280;margin-bottom:4px;">${multiline(item.sku)}</div>` : '') +
          (showPrice && item.price ? `<div style="margin-bottom:4px;">${multiline(item.price)}</div>` : '') +
          cta +
          `</td>`
        );
      })
      .join('');
    rowsHtml.push(`<tr>${tds}</tr>`);
  }
  return row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;table-layout:fixed;">${rowsHtml.join('')}</table>`,
  );
}

function renderCategoryGrid(p: EmailCategoryGridProps): string {
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length === 0) return '';
  const columns = Math.min(3, Math.max(1, p.columns || 2));
  const gap = Math.max(0, p.gap ?? 16);
  const halfGap = Math.floor(gap / 2);
  const showImage = p.showImage;
  const widthPct = Math.floor(100 / columns);
  const rowsHtml: string[] = [];
  for (let i = 0; i < items.length; i += columns) {
    const slice = items.slice(i, i + columns);
    while (slice.length < columns) slice.push(null as never);
    const tds = slice
      .map((item, ci) => {
        const padLeft = ci === 0 ? 0 : halfGap;
        const padRight = ci === columns - 1 ? 0 : gap - halfGap;
        if (!item) {
          return `<td width="${widthPct}%" style="width:${widthPct}%;padding:0 ${padRight}px 12px ${padLeft}px;"></td>`;
        }
        const img =
          showImage && item.imageSrc
            ? `<img src="${escapeAttr(item.imageSrc)}" alt="" width="100%" style="display:block;border:0;max-width:100%;height:auto;margin-bottom:8px;" />`
            : showImage
              ? `<div style="width:100%;height:80px;background:#f3f4f6;margin-bottom:8px;"></div>`
              : '';
        const title = item.href
          ? `<a href="${escapeAttr(item.href)}" target="_blank" rel="noreferrer" style="color:#1f2937;text-decoration:none;font-weight:bold;">${multiline(item.title)}</a>`
          : `<div style="font-weight:bold;">${multiline(item.title)}</div>`;
        return (
          `<td width="${widthPct}%" valign="top" style="width:${widthPct}%;padding:0 ${padRight}px 12px ${padLeft}px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;">` +
          img +
          title +
          `</td>`
        );
      })
      .join('');
    rowsHtml.push(`<tr>${tds}</tr>`);
  }
  return row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;table-layout:fixed;">${rowsHtml.join('')}</table>`,
  );
}

function renderOrderSummaryLegacy(title: string, body: string): string {
  return row(
    `<div style="font-weight:bold;margin-bottom:8px;font-size:16px;color:#15202b;">${multiline(title)}</div>` +
      `<div style="font-size:14px;line-height:1.5;color:#1f2937;white-space:pre-wrap;">${multiline(body)}</div>`,
  );
}

function renderOrderSummary(p: EmailOrderSummaryProps, language: string): string {
  const title = p.title || 'Order summary';
  const showSku = p.showSku === true;
  const showName = p.showName !== false;
  const showQty = p.showQuantity !== false;
  const showPrice = p.showPrice !== false;
  const showTotals = p.showTotals === true;
  const col = orderSummaryColumnLabels(language);

  const headers: string[] = [];
  if (showSku) headers.push(col.sku);
  if (showName) headers.push(col.item);
  if (showQty) headers.push(col.qty);
  if (showPrice) headers.push(col.price);

  const headerRow =
    headers.length > 0
      ? `<tr>${headers
          .map(
            (h) =>
              `<th align="left" style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;">${escapeHtml(h)}</th>`,
          )
          .join('')}</tr>`
      : '';

  const cells: string[] = [];
  if (showSku) {
    cells.push(
      `<td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#1f2937;">{{var item.sku}}</td>`,
    );
  }
  if (showName) {
    cells.push(
      `<td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#1f2937;">{{var item.name}}</td>`,
    );
  }
  if (showQty) {
    cells.push(
      `<td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#1f2937;">{{var item.quantity}}</td>`,
    );
  }
  if (showPrice) {
    cells.push(
      `<td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#1f2937;">{{var item.price}}</td>`,
    );
  }

  const loop =
    cells.length > 0 ? `{{for item in order.items}}<tr>${cells.join('')}</tr>{{/for}}` : '';

  const totals =
    showTotals
      ? `<div style="margin-top:12px;font-size:14px;color:#1f2937;white-space:pre-wrap;">{{var order.summaryText}}</div>`
      : '';

  return row(
    `<div style="font-weight:bold;margin-bottom:8px;font-size:16px;color:#15202b;">${multiline(title)}</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">` +
      headerRow +
      loop +
      `</table>` +
      totals,
    orderBlockPadding(p.marginTop, p.marginBottom),
  );
}

function renderOrderLabeledVar(p: EmailOrderLabeledVarProps, varKey: string): string {
  const title = p.title?.trim() ?? '';
  const heading = title
    ? `<div style="font-weight:bold;margin-bottom:6px;font-size:14px;color:#15202b;">${multiline(title)}</div>`
    : '';
  return row(
    heading +
      `<div style="font-size:14px;line-height:1.5;color:#1f2937;white-space:pre-wrap;">{{var ${varKey}}}</div>`,
    orderBlockPadding(p.marginTop, p.marginBottom),
  );
}

function renderTable(p: EmailTableProps): string {
  const columns = Array.isArray(p.columns) ? p.columns : [];
  const rows = Array.isArray(p.tableRows) ? p.tableRows : [];
  if (columns.length === 0 && rows.length === 0) return '';
  const colCount = Math.max(1, columns.length);
  const header =
    columns.length > 0
      ? `<thead><tr>${columns
          .map(
            (c) =>
              `<th align="left" style="padding:6px 8px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase;">${escapeHtml(
                c?.label ?? '',
              )}</th>`,
          )
          .join('')}</tr></thead>`
      : '';
  const body = rows
    .map((rowData, ri) => {
      const cells = [...(rowData.cells ?? [])];
      while (cells.length < colCount) cells.push({ value: '' });
      const bg = p.striped && ri % 2 === 1 ? 'background-color:#f9fafb;' : '';
      return `<tr>${cells
        .slice(0, colCount)
        .map(
          (cell) =>
            `<td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#1f2937;${bg}">${multiline(
              cell?.value ?? '',
            )}</td>`,
        )
        .join('')}</tr>`;
    })
    .join('');
  return row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;max-width:100%;">${header}<tbody>${body}</tbody></table>`,
  );
}

function renderSocial(p: EmailSocialProps): string {
  const links = Array.isArray(p.links) ? p.links : [];
  const active = links.filter((l) => l?.enabled !== false && l?.href);
  if (active.length === 0) return '';
  const showIcons = p.showIcons !== false;
  const showLabels = p.showLabels === true;
  const iconSize = Math.min(48, Math.max(16, p.iconSize || 28));
  const useBrand = p.useBrandColors !== false;
  const fallbackColor = p.color || '#1f2937';

  const parts = active
    .map((l) => {
      const network = (
        l.network in EMAIL_SOCIAL_LABELS ? l.network : 'other'
      ) as EmailSocialNetwork;
      const label = l.label || EMAIL_SOCIAL_LABELS[network];
      const color = useBrand ? EMAIL_SOCIAL_BRAND_COLORS[network] : fallbackColor;
      const icon = showIcons
        ? `<img src="${escapeAttr(socialIconDataUri(network, color))}" width="${iconSize}" height="${iconSize}" ` +
          `alt="" style="display:inline-block;border:0;outline:none;width:${iconSize}px;height:${iconSize}px;vertical-align:middle;" />`
        : '';
      const text = showLabels
        ? `<span style="font-size:13px;color:${escapeAttr(color)};vertical-align:middle;${showIcons ? 'padding-left:6px;' : ''}">${escapeHtml(label)}</span>`
        : '';
      if (!icon && !text) {
        return `<a href="${escapeAttr(l.href)}" target="_blank" rel="noreferrer" style="color:${escapeAttr(color)};text-decoration:underline;margin:0 8px;">${escapeHtml(label)}</a>`;
      }
      return (
        `<a href="${escapeAttr(l.href)}" target="_blank" rel="noreferrer" ` +
        `style="display:inline-block;text-decoration:none;margin:0 8px;vertical-align:middle;" aria-label="${escapeAttr(label)}">` +
        icon +
        text +
        `</a>`
      );
    })
    .join('');
  return row(`<div style="text-align:${p.align};padding:8px 0;line-height:1;">${parts}</div>`);
}

function prepareFooterLegalHtml(text: string): string {
  let t = text || '';
  const alreadyLinked = /href\s*=\s*["']\s*\{\{\s*var\s+unsubscribeUrl\s*\}\}/i.test(t);
  if (!alreadyLinked && t.includes('{{var unsubscribeUrl}}')) {
    if (/Unsubscribe:\s*\{\{\s*var\s+unsubscribeUrl\s*\}\}/i.test(t)) {
      t = t.replace(
        /Unsubscribe:\s*\{\{\s*var\s+unsubscribeUrl\s*\}\}/gi,
        '<a href="{{var unsubscribeUrl}}">Unsubscribe</a>',
      );
    } else {
      t = t.replace(
        /\{\{\s*var\s+unsubscribeUrl\s*\}\}/g,
        '<a href="{{var unsubscribeUrl}}">Unsubscribe</a>',
      );
    }
  }
  return sanitizeEmailHtml(t.replace(/\r?\n/g, '<br />'));
}

function renderCallout(p: EmailCalloutProps): string {
  const bg = p.backgroundColor || '#f3f4f6';
  const border = p.borderColor || '#d1d5db';
  const textColor = p.textColor || '#1f2937';
  return row(
    `<div style="background-color:${escapeAttr(bg)};border:1px solid ${escapeAttr(border)};border-radius:6px;` +
      `padding:14px 16px;text-align:${p.align};font-size:15px;line-height:1.5;color:${escapeAttr(textColor)};">${multiline(p.text)}</div>`,
    '8px 24px',
  );
}

function renderFooterLegal(p: EmailFooterLegalProps): string {
  const html = prepareFooterLegalHtml(p.text);
  if (!html) return '';
  return row(
    `<div style="margin:0;padding:8px 0;font-size:12px;line-height:1.5;color:#6b7280;text-align:${p.align};">${html}</div>`,
  );
}

function renderEmbed(kind: 'blocks' | 'templates', code: string, ctx: RenderCtx): string {
  if (!code || ctx.depth >= ctx.maxDepth) return '';
  const tree = ctx.embeds[kind][code];
  if (!tree) return '';
  return renderNodes(treeContent(tree), { ...ctx, tree, depth: ctx.depth + 1 });
}

function renderNode(node: PuckNode, ctx: RenderCtx): string {
  const p = node.props ?? {};
  switch (node.type) {
    case 'transactional_emails.EmailHeading':
      return renderHeading({
        level: (p['level'] as EmailHeadingProps['level']) ?? 'h2',
        text: str(p, 'text'),
        align: align(p),
      });
    case 'transactional_emails.EmailText':
      return renderText({ text: str(p, 'text'), align: align(p) });
    case 'transactional_emails.EmailButton':
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
    case 'transactional_emails.EmailImage':
      return renderImage({
        src: str(p, 'src'),
        alt: str(p, 'alt'),
        href: str(p, 'href'),
        width: num(p, 'width', 200),
        align: align(p, 'center'),
        ...(p['imageSource'] === 'library' || p['imageSource'] === 'url'
          ? { imageSource: p['imageSource'] as 'url' | 'library' }
          : {}),
        ...(typeof p['assetId'] === 'string' ? { assetId: p['assetId'] } : {}),
      });
    case 'transactional_emails.EmailLogo':
      return renderLogo({
        src: str(p, 'src', '{{var branding.logoUrl}}'),
        alt: str(p, 'alt', 'Logo'),
        href: str(p, 'href'),
        width: num(p, 'width', 160),
        align: align(p, 'center'),
      });
    case 'transactional_emails.EmailDivider':
      return renderDivider({
        thickness: num(p, 'thickness', 1),
        color: str(p, 'color', '#e5e7eb'),
      });
    case 'transactional_emails.EmailSpacer':
      return renderSpacer({ height: num(p, 'height', 16) });
    case 'transactional_emails.EmailTable':
      return renderTable({
        columns: Array.isArray(p['columns']) ? (p['columns'] as EmailTableProps['columns']) : [],
        tableRows: Array.isArray(p['tableRows'])
          ? (p['tableRows'] as EmailTableProps['tableRows'])
          : [],
        striped: bool(p, 'striped', true),
      });
    case 'transactional_emails.EmailSection': {
      const children = slotChildren(node, ctx, 'content');
      const inner = renderNodes(children, ctx);
      return renderSection(
        {
          backgroundColor: str(p, 'backgroundColor', '#ffffff'),
          paddingY: num(p, 'paddingY', 16),
          paddingX: num(p, 'paddingX', 24),
        },
        inner,
      );
    }
    case 'transactional_emails.EmailRow': {
      const columnNodes = slotChildren(node, ctx, 'content').filter((n) => n.type === 'transactional_emails.EmailColumn');
      const equalFallback = columnNodes.length > 0 ? Math.floor(12 / columnNodes.length) : 6;
      const columns = columnNodes.map((col) => ({
        innerRows: withCellPadding('4px 0', () =>
          renderNodes(slotChildren(col, ctx, 'content'), ctx),
        ),
        span: num(col.props, 'span', equalFallback),
      }));
      const valignRaw = str(p, 'verticalAlign', 'top');
      const verticalAlign: EmailVerticalAlign =
        valignRaw === 'middle' || valignRaw === 'bottom' ? valignRaw : 'top';
      return renderRow(
        {
          gap: num(p, 'gap', 16),
          verticalAlign,
        },
        columns,
      );
    }
    case 'transactional_emails.EmailColumn': {
      // Standalone column (should only live inside EmailRow) — stack children full-width.
      return renderNodes(slotChildren(node, ctx, 'content'), ctx);
    }
    case 'transactional_emails.EmailRichText':
      return renderRichText({
        content: p['content'],
        html: str(p, 'html'),
        align: align(p),
      });
    case 'catalog.EmailProductCard':
      return renderProductCard(
        {
          productSlug: str(p, 'productSlug'),
          productId: str(p, 'productId'),
          imageSrc: str(p, 'imageSrc'),
          title: str(p, 'title', 'Product'),
          sku: str(p, 'sku'),
          price: str(p, 'price'),
          href: str(p, 'href'),
          ctaLabel: str(p, 'ctaLabel', 'View'),
          showImage: bool(p, 'showImage', true),
          showPrice: bool(p, 'showPrice', true),
          showSku: bool(p, 'showSku', false),
          align: align(p, 'left'),
        },
        ctx.accent,
      );
    case 'catalog.EmailProductGrid':
      return renderProductGrid(
        {
          productSlugs: Array.isArray(p['productSlugs']) ? (p['productSlugs'] as string[]) : [],
          columns: num(p, 'columns', 2),
          gap: num(p, 'gap', 16),
          showImage: bool(p, 'showImage', true),
          showPrice: bool(p, 'showPrice', true),
          showSku: bool(p, 'showSku', false),
          ctaLabel: str(p, 'ctaLabel', 'View'),
          items: Array.isArray(p['items']) ? (p['items'] as EmailProductGridProps['items']) : [],
        },
        ctx.accent,
      );
    case 'catalog.EmailCategoryGrid':
      return renderCategoryGrid({
        categorySlugs: Array.isArray(p['categorySlugs']) ? (p['categorySlugs'] as string[]) : [],
        columns: num(p, 'columns', 2),
        gap: num(p, 'gap', 16),
        showImage: bool(p, 'showImage', true),
        items: Array.isArray(p['items']) ? (p['items'] as EmailCategoryGridProps['items']) : [],
      });
    case 'orders.EmailOrderSummary': {
      const rawBody = typeof p['body'] === 'string' ? p['body'] : '';
      const hasNewFlags =
        'showName' in p ||
        'showSku' in p ||
        'showQuantity' in p ||
        'showPrice' in p ||
        'showTotals' in p;
      if (rawBody && !hasNewFlags) {
        return renderOrderSummaryLegacy(str(p, 'title', 'Order summary'), rawBody);
      }
      return renderOrderSummary(
        {
          title: str(p, 'title', 'Order summary'),
          showSku: p['showSku'] === true,
          showName: p['showName'] !== false,
          showQuantity: p['showQuantity'] !== false,
          showPrice: p['showPrice'] !== false,
          showTotals: p['showTotals'] === true,
          marginTop: num(p, 'marginTop', EMAIL_ORDER_BLOCK_MARGIN_DEFAULT),
          marginBottom: num(p, 'marginBottom', EMAIL_ORDER_BLOCK_MARGIN_DEFAULT),
        },
        ctx.language,
      );
    }
    case 'orders.EmailOrderId':
    case 'orders.EmailBillingAddress':
    case 'orders.EmailShippingAddress':
    case 'orders.EmailOrderTotals':
    case 'orders.EmailAppliedDiscounts':
    case 'orders.EmailDeliveryMethod':
    case 'orders.EmailPaymentMethod': {
      const meta = EMAIL_ORDER_LABELED_FIELDS[node.type];
      return renderOrderLabeledVar(
        {
          title: str(p, 'title', meta.defaultTitle),
          marginTop: num(p, 'marginTop', EMAIL_ORDER_BLOCK_MARGIN_DEFAULT),
          marginBottom: num(p, 'marginBottom', EMAIL_ORDER_BLOCK_MARGIN_DEFAULT),
        },
        meta.varKey,
      );
    }
    case 'transactional_emails.EmailSocial':
      return renderSocial({
        links: Array.isArray(p['links']) ? (p['links'] as EmailSocialProps['links']) : [],
        align: align(p, 'center'),
        showIcons: bool(p, 'showIcons', true),
        showLabels: bool(p, 'showLabels', false),
        iconSize: num(p, 'iconSize', 28),
        useBrandColors: bool(p, 'useBrandColors', true),
        color: str(p, 'color', '#1f2937'),
      });
    case 'transactional_emails.EmailCallout':
      return renderCallout({
        text: str(p, 'text'),
        backgroundColor: str(p, 'backgroundColor', '#f3f4f6'),
        borderColor: str(p, 'borderColor', '#d1d5db'),
        textColor: str(p, 'textColor', '#1f2937'),
        align: align(p),
      });
    case 'transactional_emails.EmailFooterLegal':
      return renderFooterLegal({
        text: str(
          p,
          'text',
          'You received this email because you are subscribed.\n<a href="{{var unsubscribeUrl}}">Unsubscribe</a>',
        ),
        align: align(p, 'center'),
      });
    case 'transactional_emails.EmailInsertBlock':
      return renderEmbed('blocks', str(p, 'code'), ctx);
    case 'transactional_emails.EmailInsertTemplate':
      return renderEmbed('templates', str(p, 'code'), ctx);
    default:
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
    `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />` +
    `</head>` +
    `<body style="margin:0;padding:0;background-color:#f3f4f6;-webkit-text-size-adjust:100%;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;width:100%;">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;max-width:600px;background-color:#ffffff;border-radius:8px;">` +
    body +
    `</table></td></tr></table></body></html>`
  );
}

export function renderEmailHtml(
  tree: PuckDataTree | null | undefined,
  opts: RenderEmailHtmlOptions = {},
): string {
  const safeTree: PuckDataTree = tree ?? { root: { props: {} }, content: [], zones: {} };
  const ctx: RenderCtx = {
    embeds: opts.embeds ?? { blocks: {}, templates: {} },
    accent: opts.accentColor ?? DEFAULT_ACCENT,
    depth: 0,
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    tree: safeTree,
    language: opts.language ?? 'en-US',
  };
  const body = renderNodes(treeContent(safeTree), ctx);
  return opts.document === false ? body : wrapDocument(body);
}

export { emailHtmlToPlainText, sanitizeEmailHtml };
