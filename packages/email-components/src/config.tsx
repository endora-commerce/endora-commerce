// Email-safe Puck editor configuration (feature 047 + expansion).

import { createElement, type ComponentType, type ReactNode, type Ref } from 'react';
import type { ComponentConfig, Config } from '@measured/puck';
import {
  createColorField,
  definePageBuilderComponent,
  type PageBuilderComponentDefinition,
} from '@endora-commerce/page-builder-core';
import { useEmailEmbeds } from './components/email-embeds-context.js';
import { useEmailBrandingPreview } from './components/email-branding-preview-context.js';
import type {
  EmailButtonProps,
  EmailCalloutProps,
  EmailColumnProps,
  EmailDividerProps,
  EmailFooterLegalProps,
  EmailHeadingProps,
  EmailImageProps,
  EmailInsertBlockProps,
  EmailLogoProps,
  EmailOrderLabeledVarProps,
  EmailOrderSummaryProps,
  EmailProductCardProps,
  EmailProductGridProps,
  EmailCategoryGridProps,
  EmailRichTextProps,
  EmailRowProps,
  EmailSectionProps,
  EmailSocialProps,
  EmailSpacerProps,
  EmailTableHeader,
  EmailTableProps,
  EmailTableRow,
  EmailTextProps,
} from './schema/component-types.js';
import {
  EMAIL_COMPONENT_REQUIRED_VARIABLES,
  EMAIL_ORDER_BLOCK_MARGIN_DEFAULT,
  EMAIL_ORDER_LABELED_FIELDS,
} from './schema/component-types.js';
import { EMAIL_SOCIAL_BRAND_COLORS, EMAIL_SOCIAL_LABELS } from './render/social-icon-svg.js';

const ALIGN_OPTIONS = [
  { label: 'Left', value: 'left' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'right' },
];

const SOCIAL_NETWORK_OPTIONS = [
  { label: 'Facebook', value: 'facebook' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'LinkedIn', value: 'linkedin' },
  { label: 'X', value: 'x' },
  { label: 'YouTube', value: 'youtube' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Other', value: 'other' },
];

const VERTICAL_ALIGN_OPTIONS = [
  { label: 'Top', value: 'top' },
  { label: 'Middle', value: 'middle' },
  { label: 'Bottom', value: 'bottom' },
];

const BRANDING_LOGO_SRC = '{{var branding.logoUrl}}';

export const EmailHeading: ComponentConfig<EmailHeadingProps> = {
  label: 'Heading',
  fields: {
    level: {
      type: 'select',
      label: 'Level',
      options: [
        { label: 'H1', value: 'h1' },
        { label: 'H2', value: 'h2' },
        { label: 'H3', value: 'h3' },
      ],
    },
    text: { type: 'textarea', label: 'Text' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: { level: 'h2', text: 'Heading', align: 'left' },
  render: ({ level, text, align }) => {
    const Tag = level;
    return <Tag style={{ margin: '8px 0', textAlign: align, color: '#15202b' }}>{text}</Tag>;
  },
};

export const EmailText: ComponentConfig<EmailTextProps> = {
  label: 'Text',
  fields: {
    text: { type: 'textarea', label: 'Text' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: { text: 'Email text. Use {{var your.variable}} for dynamic values.', align: 'left' },
  render: ({ text, align }) => (
    <p style={{ margin: '6px 0', textAlign: align, color: '#1f2937', whiteSpace: 'pre-wrap' }}>{text}</p>
  ),
};

export const EmailButton = {
  label: 'Button',
  fields: {
    label: { type: 'text', label: 'Label' },
    href: { type: 'text', label: 'Link' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
    backgroundColor: createColorField({ label: 'Background color' }),
    textColor: createColorField({ label: 'Text color' }),
  },
  defaultProps: {
    label: 'Call to action',
    href: '#',
    align: 'left' as const,
    backgroundColor: '#1f2937',
    textColor: '#ffffff',
  },
  render: ({ label, href, align, backgroundColor, textColor }: EmailButtonProps) => (
    <div style={{ textAlign: align, margin: '8px 0' }}>
      <a
        href={href || '#'}
        style={{
          display: 'inline-block',
          padding: '12px 22px',
          backgroundColor: backgroundColor || '#1f2937',
          color: textColor || '#ffffff',
          borderRadius: 6,
          textDecoration: 'none',
          fontWeight: 'bold',
        }}
      >
        {label}
      </a>
    </div>
  ),
} as ComponentConfig<EmailButtonProps>;

export const EmailImage = {
  label: 'Image',
  fields: {
    imageSource: {
      type: 'select',
      label: 'Image source',
      options: [
        { label: 'URL', value: 'url' },
        { label: 'Asset library', value: 'library' },
      ],
    },
    src: { type: 'text', label: 'Image URL' },
    assetId: { type: 'text', label: 'Image' },
    alt: { type: 'text', label: 'Alt text' },
    href: { type: 'text', label: 'Link (optional)' },
    width: { type: 'number', label: 'Width (px)' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: {
    imageSource: 'url' as const,
    src: '',
    assetId: '',
    alt: '',
    href: '',
    width: 200,
    align: 'center' as const,
  },
  resolveFields: (data: { props: EmailImageProps }, { fields }: { fields: Record<string, unknown> }) => {
    const source = data.props.imageSource ?? 'url';
    const next = { ...fields };
    if (source === 'library') {
      delete next['src'];
    } else {
      delete next['assetId'];
    }
    return next;
  },
  render: ({ src, alt, width, align }: EmailImageProps) => {
    const margin =
      align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0';
    return (
      <div style={{ textAlign: align }}>
        {src ? (
          <img
            src={src}
            alt={alt}
            width={width}
            style={{ display: 'block', maxWidth: '100%', margin }}
          />
        ) : (
          <span style={{ color: '#9ca3af' }}>[image]</span>
        )}
      </div>
    );
  },
} as unknown as ComponentConfig<EmailImageProps>;

export const EmailLogo = {
  label: 'Logo',
  fields: {
    alt: { type: 'text', label: 'Alt text' },
    href: { type: 'text', label: 'Link (optional)' },
    width: { type: 'number', label: 'Width (px)' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: {
    src: BRANDING_LOGO_SRC,
    alt: 'Logo',
    href: '',
    width: 160,
    align: 'center' as const,
  },
  resolveData: async ({ props }: { props: EmailLogoProps }) => ({
    props: {
      ...props,
      src: BRANDING_LOGO_SRC,
    },
  }),
  render: ({ alt, width, align }: EmailLogoProps) => {
    // Puck calls `render` as a React component — it is mounted, not invoked —
    // so a hook here obeys the rules of hooks. The linter cannot see that
    // through `ComponentConfig`, and it is the field's name rather than the
    // call that it objects to. Surfaced when feature 091 registered
    // `react-hooks` for every `.tsx` in the repository rather than for the
    // admin application alone; the call has always been correct.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { logoUrl } = useEmailBrandingPreview();
    const margin =
      align === 'center' ? '0 auto' : align === 'right' ? '0 0 0 auto' : '0';
    return (
      <div style={{ textAlign: align, width: '100%' }}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={alt || 'Logo'}
            width={width}
            style={{ display: 'block', maxWidth: '100%', height: 'auto', margin }}
          />
        ) : (
          <span style={{ color: '#9ca3af', fontSize: 13, display: 'inline-block' }}>
            [{alt || 'logo'} — set in Branding]
          </span>
        )}
      </div>
    );
  },
} as unknown as ComponentConfig<EmailLogoProps>;

export const EmailDivider = {
  label: 'Divider',
  fields: {
    thickness: { type: 'number', label: 'Thickness (px)', min: 1, max: 8 },
    color: createColorField({ label: 'Color' }),
  },
  defaultProps: { thickness: 1, color: '#e5e7eb' },
  render: ({ thickness, color }: EmailDividerProps) => (
    <hr
      style={{
        border: 0,
        borderTop: `${Math.max(1, thickness || 1)}px solid ${color || '#e5e7eb'}`,
        margin: '8px 0',
      }}
    />
  ),
} as ComponentConfig<EmailDividerProps>;

export const EmailSpacer: ComponentConfig<EmailSpacerProps> = {
  label: 'Spacer',
  fields: { height: { type: 'number', label: 'Height (px)' } },
  defaultProps: { height: 16 },
  render: ({ height }) => <div style={{ height }} />,
};

function padEmailTableRow(row: EmailTableRow, colCount: number): EmailTableRow {
  const cells = [...(row.cells ?? [])];
  while (cells.length < colCount) cells.push({ value: '' });
  return { cells: cells.slice(0, Math.max(colCount, 1)) };
}

export const EmailTable = {
  label: 'Table',
  fields: {
    columns: {
      type: 'array',
      label: 'Columns',
      getItemSummary: (item: EmailTableHeader, index?: number) =>
        item.label?.trim() || `Column ${(index ?? 0) + 1}`,
      arrayFields: {
        label: { type: 'text', label: 'Header' },
      },
      defaultItemProps: { label: 'Column' },
      min: 1,
      max: 6,
    },
    tableRows: {
      type: 'array',
      label: 'Rows',
      getItemSummary: (item: EmailTableRow, index?: number) => {
        const preview = (item.cells ?? [])
          .map((c) => c.value?.trim())
          .filter(Boolean)
          .join(' | ');
        return preview || `Row ${(index ?? 0) + 1}`;
      },
      arrayFields: {
        cells: {
          type: 'array',
          label: 'Cells',
          arrayFields: {
            value: { type: 'text', label: 'Value' },
          },
          getItemSummary: (item: { value?: string }, i?: number) =>
            item.value?.trim() || `Cell ${(i ?? 0) + 1}`,
        },
      },
      defaultItemProps: { cells: [{ value: '' }, { value: '' }] },
    },
    striped: {
      type: 'radio',
      label: 'Striped rows',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
  },
  defaultProps: {
    columns: [{ label: 'Column 1' }, { label: 'Column 2' }],
    tableRows: [
      { cells: [{ value: 'A1' }, { value: 'B1' }] },
      { cells: [{ value: 'A2' }, { value: 'B2' }] },
    ],
    striped: true,
  },
  resolveData: async ({ props }: { props: EmailTableProps }) => {
    const columns =
      Array.isArray(props.columns) && props.columns.length > 0
        ? props.columns
        : [{ label: 'Column 1' }];
    const colCount = columns.length;
    const tableRows = (Array.isArray(props.tableRows) ? props.tableRows : []).map((row) =>
      padEmailTableRow(row, colCount),
    );
    return { props: { ...props, columns, tableRows } };
  },
  render: ({ columns, tableRows, striped }: EmailTableProps) => {
    const cols = columns?.length ? columns : [{ label: 'Column 1' }];
    const rows = (tableRows ?? []).map((row) => padEmailTableRow(row, cols.length));
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                key={i}
                style={{
                  textAlign: 'left',
                  borderBottom: '2px solid #e5e7eb',
                  padding: '6px 8px',
                  color: '#6b7280',
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={striped && ri % 2 === 1 ? { background: '#f9fafb' } : undefined}>
              {(row.cells ?? []).map((cell, ci) => (
                <td key={ci} style={{ padding: '6px 8px', borderBottom: '1px solid #f3f4f6' }}>
                  {cell.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
} as unknown as ComponentConfig<EmailTableProps>;

export const EmailSection = {
  label: 'Section',
  fields: {
    backgroundColor: createColorField({ label: 'Background color' }),
    paddingY: { type: 'number', label: 'Vertical padding (px)' },
    paddingX: { type: 'number', label: 'Horizontal padding (px)' },
    content: {
      type: 'slot',
      /** Columns only belong inside EmailRow. */
      disallow: ['transactional_emails.EmailColumn'],
    },
  },
  defaultProps: {
    backgroundColor: '#ffffff',
    paddingY: 16,
    paddingX: 24,
    content: [] as unknown[],
  },
  render: ({
    backgroundColor,
    paddingY,
    paddingX,
    content: contentSlot,
  }: EmailSectionProps & { content?: (() => ReactNode) | unknown }) => (
    <div
      style={{
        backgroundColor: backgroundColor || '#ffffff',
        padding: `${paddingY ?? 16}px ${paddingX ?? 24}px`,
        minHeight: 48,
      }}
    >
      {typeof contentSlot === 'function' ? (contentSlot as () => ReactNode)() : null}
    </div>
  ),
} as ComponentConfig<EmailSectionProps>;

const EMAIL_ROW_SLOT_EDIT_PROPS = {
  minEmptyHeight: 144,
  collisionAxis: 'dynamic' as const,
  className: 'cmsc-pb-slot cmsc-pb-row-slot',
};

const EMAIL_COLUMN_SLOT_EDIT_PROPS = {
  minEmptyHeight: 0,
  collisionAxis: 'y' as const,
  className: 'cmsc-pb-slot cmsc-pb-column-slot',
};

export const EmailColumn = {
  label: 'Column',
  /** Grid cell is .cmsc-pb-row-col — Puck must not wrap it in an extra block. */
  inline: true,
  fields: {
    span: {
      type: 'number',
      label: 'Width (1–12)',
      min: 1,
      max: 12,
    },
    content: {
      type: 'slot',
      disallow: ['transactional_emails.EmailColumn'],
    },
  },
  defaultProps: {
    span: 6,
    content: [] as unknown[],
  },
  render: (
    props: EmailColumnProps & {
      content?: ComponentType<Record<string, unknown>> | unknown;
      puck?: { isEditing?: boolean; dragRef?: Ref<HTMLDivElement> | null };
    },
  ) => {
    const { content: contentSlot, span, puck } = props;
    const editing = puck?.isEditing !== false;
    const colSpan = Math.min(12, Math.max(1, span ?? 6));
    const Slot = typeof contentSlot === 'function' ? (contentSlot as ComponentType<Record<string, unknown>>) : null;
    return (
      <div
        ref={puck?.dragRef ?? undefined}
        className="cmsc-pb-row-col cmsc:min-w-0 cmsc:self-stretch"
        style={{ gridColumn: `span ${colSpan}` }}
        data-pb-editing={editing ? '1' : '0'}
      >
        {Slot ? createElement(Slot, EMAIL_COLUMN_SLOT_EDIT_PROPS) : null}
      </div>
    );
  },
} as unknown as ComponentConfig<EmailColumnProps>;

export const EmailRow = {
  label: 'Row',
  fields: {
    gap: { type: 'number', label: 'Column gap (px)' },
    verticalAlign: {
      type: 'select',
      label: 'Vertical align',
      options: VERTICAL_ALIGN_OPTIONS,
    },
    content: {
      type: 'slot',
      allow: ['transactional_emails.EmailColumn'],
    },
  },
  defaultProps: {
    gap: 16,
    verticalAlign: 'top' as const,
    content: [] as unknown[],
  },
  render: (
    props: EmailRowProps & {
      content?: ComponentType<Record<string, unknown>> | unknown;
      puck?: { isEditing?: boolean };
    },
  ) => {
    const { gap, verticalAlign, content: contentSlot, puck } = props;
    const editing = puck?.isEditing !== false;
    const alignItems =
      verticalAlign === 'middle' ? 'center' : verticalAlign === 'bottom' ? 'flex-end' : 'stretch';
    const Slot = typeof contentSlot === 'function' ? (contentSlot as ComponentType<Record<string, unknown>>) : null;
    return (
      <div
        className={`cmsc-pb-row-cols cmsc:w-full ${editing ? 'cmsc-pb-row-cols--editing' : ''}`}
        style={{
          gap: gap ?? 16,
          alignItems,
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {Slot
          ? editing
            ? createElement(Slot, EMAIL_ROW_SLOT_EDIT_PROPS)
            : createElement(Slot)
          : null}
      </div>
    );
  },
} as unknown as ComponentConfig<EmailRowProps>;

export const EmailRichText: ComponentConfig<EmailRichTextProps> = {
  label: 'Rich text',
  fields: {
    content: { type: 'textarea', label: 'Content (TipTap JSON — edited in admin)' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  } as NonNullable<ComponentConfig<EmailRichTextProps>['fields']>,
  defaultProps: {
    content: null,
    html: '<p>Rich text. Use {{var your.variable}} for dynamic values.</p>',
    align: 'left',
  },
  render: ({ html, align }) => (
    <div
      style={{ textAlign: align, fontSize: 15, lineHeight: 1.5, color: '#1f2937' }}
      dangerouslySetInnerHTML={{ __html: html || '<p></p>' }}
    />
  ),
};

export const EmailProductCard = {
  label: 'Product card',
  fields: {
    productSlug: { type: 'text', label: 'Product' },
    showImage: {
      type: 'radio',
      label: 'Show image',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showSku: {
      type: 'radio',
      label: 'Show SKU',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showPrice: {
      type: 'radio',
      label: 'Show price',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    price: { type: 'text', label: 'Price (override)' },
    ctaLabel: { type: 'text', label: 'CTA label' },
    href: { type: 'text', label: 'Link (override)' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: {
    productSlug: '',
    productId: '',
    imageSrc: '',
    title: 'Select a product',
    sku: '',
    price: '',
    href: '',
    ctaLabel: 'View product',
    showImage: true,
    showPrice: true,
    showSku: false,
    align: 'left' as const,
  },
  render: ({ imageSrc, title, sku, price, ctaLabel, showImage, showPrice, showSku }: EmailProductCardProps) => {
    const showImg = showImage !== false && showImage !== ('false' as unknown as boolean);
    return (
      <div style={{ display: 'flex', gap: 12, padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
        {showImg ? (
          imageSrc && !String(imageSrc).includes('{{') ? (
            <img src={imageSrc} alt="" width={64} height={64} style={{ objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                background: '#f3f4f6',
                border: '1px dashed #d1d5db',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: '#9ca3af',
                textAlign: 'center',
                lineHeight: 1.2,
                padding: 4,
                boxSizing: 'border-box',
              }}
            >
              No image
            </div>
          )
        ) : null}
        <div>
          <div style={{ fontWeight: 600 }}>{title}</div>
          {showSku && sku ? <div style={{ fontSize: 12, color: '#6b7280' }}>{sku}</div> : null}
          {showPrice !== false && price ? <div>{price}</div> : null}
          <div style={{ marginTop: 4, fontSize: 13, color: '#1f2937' }}>{ctaLabel}</div>
        </div>
      </div>
    );
  },
} as unknown as ComponentConfig<EmailProductCardProps>;

export const EmailProductGrid = {
  label: 'Product grid',
  fields: {
    productSlugs: { type: 'text', label: 'Products' },
    columns: { type: 'number', label: 'Columns', min: 1, max: 3 },
    gap: { type: 'number', label: 'Gap (px)', min: 0, max: 48 },
    showImage: {
      type: 'radio',
      label: 'Show image',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showSku: {
      type: 'radio',
      label: 'Show SKU',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showPrice: {
      type: 'radio',
      label: 'Show price',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    ctaLabel: { type: 'text', label: 'CTA label' },
  },
  defaultProps: {
    productSlugs: [] as string[],
    columns: 2,
    gap: 16,
    showImage: true,
    showPrice: true,
    showSku: false,
    ctaLabel: 'View',
    items: [] as EmailProductGridProps['items'],
  },
  render: ({
    items,
    columns,
    showImage,
    showPrice,
    showSku,
    ctaLabel,
  }: EmailProductGridProps) => {
    const cols = Math.min(3, Math.max(1, columns || 2));
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return (
        <div style={{ padding: 12, color: '#9ca3af', fontSize: 13, border: '1px dashed #e5e7eb' }}>
          Select products for the grid
        </div>
      );
    }
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 12,
        }}
      >
        {list.map((item) => (
          <div key={item.productId || item.productSlug} style={{ fontSize: 13 }}>
            {showImage !== false ? (
              item.imageSrc ? (
                <img
                  src={item.imageSrc}
                  alt=""
                  style={{ width: '100%', height: 80, objectFit: 'cover', marginBottom: 6 }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: 80,
                    background: '#f3f4f6',
                    border: '1px dashed #d1d5db',
                    marginBottom: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: '#9ca3af',
                  }}
                >
                  No image
                </div>
              )
            ) : null}
            <div style={{ fontWeight: 600 }}>{item.title}</div>
            {showSku && item.sku ? <div style={{ fontSize: 11, color: '#6b7280' }}>{item.sku}</div> : null}
            {showPrice !== false && item.price ? <div>{item.price}</div> : null}
            <div style={{ marginTop: 4, fontSize: 12 }}>{ctaLabel}</div>
          </div>
        ))}
      </div>
    );
  },
} as unknown as ComponentConfig<EmailProductGridProps>;

export const EmailCategoryGrid = {
  label: 'Category grid',
  fields: {
    categorySlugs: { type: 'text', label: 'Categories' },
    columns: { type: 'number', label: 'Columns', min: 1, max: 3 },
    gap: { type: 'number', label: 'Gap (px)', min: 0, max: 48 },
    showImage: {
      type: 'radio',
      label: 'Show image',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
  },
  defaultProps: {
    categorySlugs: [] as string[],
    columns: 2,
    gap: 16,
    showImage: true,
    items: [] as EmailCategoryGridProps['items'],
  },
  render: ({ items, columns, showImage }: EmailCategoryGridProps) => {
    const cols = Math.min(3, Math.max(1, columns || 2));
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
      return (
        <div style={{ padding: 12, color: '#9ca3af', fontSize: 13, border: '1px dashed #e5e7eb' }}>
          Select categories for the grid
        </div>
      );
    }
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 12,
        }}
      >
        {list.map((item) => (
          <div key={item.categoryId || item.categorySlug} style={{ fontSize: 13 }}>
            {showImage !== false ? (
              item.imageSrc ? (
                <img
                  src={item.imageSrc}
                  alt=""
                  style={{ width: '100%', height: 64, objectFit: 'cover', marginBottom: 6 }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: 64,
                    background: '#f3f4f6',
                    border: '1px dashed #d1d5db',
                    marginBottom: 6,
                  }}
                />
              )
            ) : null}
            <div style={{ fontWeight: 600 }}>{item.title}</div>
          </div>
        ))}
      </div>
    );
  },
} as unknown as ComponentConfig<EmailCategoryGridProps>;

export const EmailOrderSummary = {
  label: 'Order summary',
  fields: {
    title: { type: 'text', label: 'Title' },
    showSku: {
      type: 'radio',
      label: 'Show SKU column',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showName: {
      type: 'radio',
      label: 'Show name column',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showQuantity: {
      type: 'radio',
      label: 'Show quantity column',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showPrice: {
      type: 'radio',
      label: 'Show price column',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showTotals: {
      type: 'radio',
      label: 'Show totals',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    marginTop: { type: 'number', label: 'Margin top (px)' },
    marginBottom: { type: 'number', label: 'Margin bottom (px)' },
  },
  defaultProps: {
    title: 'Order summary',
    showSku: false,
    showName: true,
    showQuantity: true,
    showPrice: true,
    showTotals: true,
    marginTop: EMAIL_ORDER_BLOCK_MARGIN_DEFAULT,
    marginBottom: EMAIL_ORDER_BLOCK_MARGIN_DEFAULT,
  },
  render: ({
    title,
    showSku,
    showName,
    showQuantity,
    showPrice,
    showTotals,
    marginTop,
    marginBottom,
  }: EmailOrderSummaryProps) => {
    const cols = [
      showSku ? 'SKU' : null,
      showName !== false ? 'Item' : null,
      showQuantity !== false ? 'Qty' : null,
      showPrice !== false ? 'Price' : null,
    ].filter(Boolean) as string[];
    const mt = marginTop ?? EMAIL_ORDER_BLOCK_MARGIN_DEFAULT;
    const mb = marginBottom ?? EMAIL_ORDER_BLOCK_MARGIN_DEFAULT;
    return (
      <div style={{ padding: 8, marginTop: mt, marginBottom: mb }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 4 }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {cols.map((c) => (
                <td key={c} style={{ padding: 4, color: '#9ca3af' }}>
                  …
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        {showTotals ? (
          <div style={{ marginTop: 8, fontSize: 13, color: '#6b7280' }}>Totals (order.summaryText)</div>
        ) : null}
      </div>
    );
  },
} as unknown as ComponentConfig<EmailOrderSummaryProps>;

function makeOrderLabeledVarConfig(
  name: keyof typeof EMAIL_ORDER_LABELED_FIELDS,
): ComponentConfig<EmailOrderLabeledVarProps> {
  const meta = EMAIL_ORDER_LABELED_FIELDS[name];
  return {
    label: meta.label,
    fields: {
      title: { type: 'text', label: 'Title' },
      marginTop: { type: 'number', label: 'Margin top (px)' },
      marginBottom: { type: 'number', label: 'Margin bottom (px)' },
    },
    defaultProps: {
      title: meta.defaultTitle,
      marginTop: EMAIL_ORDER_BLOCK_MARGIN_DEFAULT,
      marginBottom: EMAIL_ORDER_BLOCK_MARGIN_DEFAULT,
    },
    render: ({ title, marginTop, marginBottom }: EmailOrderLabeledVarProps) => {
      const mt = marginTop ?? EMAIL_ORDER_BLOCK_MARGIN_DEFAULT;
      const mb = marginBottom ?? EMAIL_ORDER_BLOCK_MARGIN_DEFAULT;
      return (
        <div style={{ padding: 8, marginTop: mt, marginBottom: mb }}>
          {title ? <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div> : null}
          <div style={{ fontSize: 13, color: '#6b7280', whiteSpace: 'pre-wrap' }}>{meta.previewHint}</div>
        </div>
      );
    },
  } as unknown as ComponentConfig<EmailOrderLabeledVarProps>;
}

export const EmailOrderId = makeOrderLabeledVarConfig('orders.EmailOrderId');
export const EmailBillingAddress = makeOrderLabeledVarConfig('orders.EmailBillingAddress');
export const EmailShippingAddress = makeOrderLabeledVarConfig('orders.EmailShippingAddress');
export const EmailOrderTotals = makeOrderLabeledVarConfig('orders.EmailOrderTotals');
export const EmailAppliedDiscounts = makeOrderLabeledVarConfig('orders.EmailAppliedDiscounts');
export const EmailDeliveryMethod = makeOrderLabeledVarConfig('orders.EmailDeliveryMethod');
export const EmailPaymentMethod = makeOrderLabeledVarConfig('orders.EmailPaymentMethod');

export const EmailSocial = {
  label: 'Social links',
  fields: {
    links: {
      type: 'array',
      label: 'Links',
      arrayFields: {
        network: { type: 'select', label: 'Network', options: SOCIAL_NETWORK_OPTIONS },
        href: { type: 'text', label: 'URL' },
        label: { type: 'text', label: 'Label (optional)' },
        enabled: {
          type: 'radio',
          label: 'Enabled',
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
      },
      getItemSummary: (item: { label?: string; network?: string; enabled?: boolean }) => {
        const on = item.enabled !== false ? '' : ' (off)';
        return `${item.label || item.network || 'Link'}${on}`;
      },
      defaultItemProps: { network: 'facebook', href: '', label: '', enabled: true },
    },
    showIcons: {
      type: 'radio',
      label: 'Show icons',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    showLabels: {
      type: 'radio',
      label: 'Show labels',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    iconSize: { type: 'number', label: 'Icon size (px)', min: 16, max: 48 },
    useBrandColors: {
      type: 'radio',
      label: 'Brand colors',
      options: [
        { label: 'Yes', value: true },
        { label: 'No', value: false },
      ],
    },
    color: createColorField({ label: 'Icon / text color' }),
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: {
    links: [
      { network: 'facebook', href: 'https://facebook.com/', enabled: true },
      { network: 'linkedin', href: 'https://linkedin.com/', enabled: true },
    ],
    align: 'center' as const,
    showIcons: true,
    showLabels: false,
    iconSize: 28,
    useBrandColors: true,
    color: '#1f2937',
  },
  render: ({
    links,
    align,
    showIcons,
    showLabels,
    iconSize,
    useBrandColors,
    color,
  }: EmailSocialProps) => (
    <div style={{ textAlign: align, padding: 8 }}>
      {(links ?? [])
        .filter((l) => l?.enabled !== false && l?.href)
        .map((l, i) => {
          const network = l.network in EMAIL_SOCIAL_LABELS ? l.network : 'other';
          const label = l.label || EMAIL_SOCIAL_LABELS[network];
          const iconColor = useBrandColors ? EMAIL_SOCIAL_BRAND_COLORS[network] : color || '#1f2937';
          const size = Math.max(16, iconSize || 28);
          return (
            <a
              key={i}
              href={l.href || '#'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                margin: '0 8px',
                color: iconColor,
                textDecoration: 'none',
                verticalAlign: 'middle',
              }}
            >
              {showIcons !== false ? (
                <span
                  style={{
                    display: 'inline-flex',
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    background: iconColor,
                    color: '#fff',
                    fontSize: Math.round(size * 0.4),
                    fontWeight: 700,
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  {network === 'facebook'
                    ? 'f'
                    : network === 'instagram'
                      ? 'ig'
                      : network === 'linkedin'
                        ? 'in'
                        : network === 'x'
                          ? 'X'
                          : network === 'youtube'
                            ? 'yt'
                            : network === 'tiktok'
                              ? 'tt'
                              : '·'}
                </span>
              ) : null}
              {showLabels ? <span style={{ fontSize: 13 }}>{label}</span> : null}
            </a>
          );
        })}
    </div>
  ),
} as unknown as ComponentConfig<EmailSocialProps>;

export const EmailCallout = {
  label: 'Callout',
  fields: {
    text: { type: 'textarea', label: 'Text' },
    backgroundColor: createColorField({ label: 'Background' }),
    borderColor: createColorField({ label: 'Border' }),
    textColor: createColorField({ label: 'Text color' }),
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: {
    text: 'Important notice',
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
    textColor: '#1f2937',
    align: 'left' as const,
  },
  render: ({ text, backgroundColor, borderColor, textColor, align }: EmailCalloutProps) => (
    <div
      style={{
        backgroundColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        padding: 14,
        textAlign: align,
        color: textColor || '#1f2937',
      }}
    >
      {text}
    </div>
  ),
} as ComponentConfig<EmailCalloutProps>;

export const EmailFooterLegal: ComponentConfig<EmailFooterLegalProps> = {
  label: 'Footer / legal',
  fields: {
    text: { type: 'textarea', label: 'Text' },
    align: { type: 'select', label: 'Align', options: ALIGN_OPTIONS },
  },
  defaultProps: {
    text: 'You received this email because you are subscribed.\n<a href="{{var unsubscribeUrl}}">Unsubscribe</a>',
    align: 'center',
  },
  render: ({ text, align }) => (
    <p
      style={{ margin: 0, fontSize: 12, color: '#6b7280', textAlign: align }}
      dangerouslySetInnerHTML={{
        __html: (text || '').replace(/\r?\n/g, '<br />'),
      }}
    />
  ),
};

export const EmailInsertBlock: ComponentConfig<EmailInsertBlockProps> = {
  label: 'Insert block',
  fields: { code: { type: 'text', label: 'Block code' } },
  defaultProps: { code: '' },
  render: ({ code }) => {
    // Puck mounts `render` as a component — see `EmailLogo` above.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { blocks } = useEmailEmbeds();
    const preview = code ? blocks[code] : null;
    if (preview) return <>{preview}</>;
    return (
      <div style={{ padding: 8, border: '1px dashed #cbd5e1', color: '#64748b' }}>
        {code ? `Block "${code}"` : 'Choose a block'}
      </div>
    );
  },
};

/**
 * Every entry in this map declares `['email']` and nothing else (feature 096,
 * D-10).
 *
 * It wrote `['email', 'newsletter']` until 2026-09-03, through a constant named
 * `emailContexts`, and that is the spelling that diverged from the manifests:
 * **no block in this repository declares `newsletter`**, and that member of
 * `PageBuilderContext` has never had a block of its own. `contexts` states what
 * a block is *authored for*; which palette it appears in is derived, by
 * `contextAdmits` — one implementation in
 * `@endora-commerce/page-builder-core`, imported by `filterConfigByContext`,
 * `getDisallowedComponentNames` and every other reader.
 */
function emailComponent(config: unknown): PageBuilderComponentDefinition {
  return definePageBuilderComponent({
    ...(config as PageBuilderComponentDefinition),
    contexts: ['email'],
  });
}

/**
 * Hide palette entries that require variables not declared on the current email
 * (e.g. Order summary needs `order.items`).
 *
 * Hidden names are removed from both `categories` and `components` so Puck does
 * not dump them into the uncategorized "Other" drawer group.
 */
export function filterEmailPaletteByVariables(
  config: Config,
  variableKeys: readonly string[],
): Config {
  const available = new Set(variableKeys);
  const hide = new Set(
    Object.entries(EMAIL_COMPONENT_REQUIRED_VARIABLES)
      .filter(([, required]) => !required.every((key) => available.has(key)))
      .map(([name]) => name),
  );
  if (hide.size === 0) return config;

  const components: Config['components'] = {};
  for (const [name, component] of Object.entries(config.components ?? {})) {
    if (!hide.has(name)) components[name] = component;
  }

  const categories: Config['categories'] = {};
  for (const [key, category] of Object.entries(config.categories ?? {})) {
    const list = (category.components ?? []).filter((name) => !hide.has(name) && name in components);
    if (list.length > 0) {
      categories[key] = { ...category, components: list };
    }
  }
  return { ...config, components, categories };
}

/**
 * The e-mail renderer map — **the React half only**, keyed by namespaced block
 * name (feature 096, T302; `contracts/block-definition.md` §4.3).
 *
 * **The four `categories` are gone**, with `defaultExpanded` (D-11: on Puck
 * `0.20.2` `defaultExpanded: true` is indistinguishable from omitting the
 * field, so deleting it is behaviour-preserving). Sections are declared by the
 * modules whose blocks occupy them — `content`, `layout`, `embeds` and the
 * hidden `internal` by `transactional_emails`, `order` by `orders`, and
 * `content` jointly by `catalog` — and served merged by
 * `GET /api/v1/admin/cms/page-builder/config`.
 *
 * **`emailContexts` is gone too** (D-10). It wrote `['email', 'newsletter']`
 * onto every entry, which is what diverged from the declarations: no block in
 * this repository declares `newsletter`, that member of `PageBuilderContext`
 * has never had a block of its own, and the newsletter palette **is** the
 * e-mail palette. The relation that makes it so — `email` admits into
 * `newsletter` — is `contextAdmits` in `@endora-commerce/page-builder-core`,
 * one implementation, imported by every reader. Widening the declarations
 * instead buys no behaviour and leaves two mechanisms answering one question.
 */
export const defaultEmailBuilderConfig: Config = {
  components: {
    'transactional_emails.EmailHeading': emailComponent(EmailHeading),
    'transactional_emails.EmailText': emailComponent(EmailText),
    'transactional_emails.EmailRichText': emailComponent(EmailRichText),
    'transactional_emails.EmailButton': emailComponent(EmailButton),
    'transactional_emails.EmailImage': emailComponent(EmailImage),
    'transactional_emails.EmailLogo': emailComponent(EmailLogo),
    'catalog.EmailProductCard': emailComponent(EmailProductCard),
    'catalog.EmailProductGrid': emailComponent(EmailProductGrid),
    'catalog.EmailCategoryGrid': emailComponent(EmailCategoryGrid),
    'orders.EmailOrderSummary': emailComponent(EmailOrderSummary),
    'orders.EmailOrderId': emailComponent(EmailOrderId),
    'orders.EmailBillingAddress': emailComponent(EmailBillingAddress),
    'orders.EmailShippingAddress': emailComponent(EmailShippingAddress),
    'orders.EmailOrderTotals': emailComponent(EmailOrderTotals),
    'orders.EmailAppliedDiscounts': emailComponent(EmailAppliedDiscounts),
    'orders.EmailDeliveryMethod': emailComponent(EmailDeliveryMethod),
    'orders.EmailPaymentMethod': emailComponent(EmailPaymentMethod),
    'transactional_emails.EmailSocial': emailComponent(EmailSocial),
    'transactional_emails.EmailCallout': emailComponent(EmailCallout),
    'transactional_emails.EmailFooterLegal': emailComponent(EmailFooterLegal),
    'transactional_emails.EmailSection': emailComponent(EmailSection),
    'transactional_emails.EmailRow': emailComponent(EmailRow),
    'transactional_emails.EmailColumn': emailComponent(EmailColumn),
    'transactional_emails.EmailDivider': emailComponent(EmailDivider),
    'transactional_emails.EmailSpacer': emailComponent(EmailSpacer),
    'transactional_emails.EmailTable': emailComponent(EmailTable),
    'transactional_emails.EmailInsertBlock': emailComponent(EmailInsertBlock),
  },
};
