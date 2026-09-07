// Email-safe component prop shapes (feature 047 + email builder expansion).
// Kept React-free so the pure backend renderer and the admin Puck editor share
// one source of truth. Every component renders to table-based, inline-styled
// HTML (no flexbox/grid/script).

export type EmailHeadingLevel = 'h1' | 'h2' | 'h3';
export type EmailAlign = 'left' | 'center' | 'right';

export interface EmailHeadingProps {
  level: EmailHeadingLevel;
  text: string;
  align: EmailAlign;
}

export interface EmailTextProps {
  /** Plain text; newlines become <br>. May contain {{var ...}} directives. */
  text: string;
  align: EmailAlign;
}

export interface EmailButtonProps {
  label: string;
  href: string;
  align: EmailAlign;
  backgroundColor: string;
  textColor: string;
}

export interface EmailImageProps {
  /** `url` = freeform `src`; `library` = assets library `assetId` (src synced to absolute URL in admin). */
  imageSource?: 'url' | 'library';
  src: string;
  assetId?: string;
  alt: string;
  href: string;
  width: number;
  align: EmailAlign;
}

export interface EmailDividerProps {
  /** Line thickness in px (1–8). */
  thickness: number;
  color: string;
}

export interface EmailSpacerProps {
  height: number;
}

export interface EmailTableHeader {
  label: string;
}

export interface EmailTableCell {
  value: string;
}

export interface EmailTableRow {
  cells: EmailTableCell[];
}

export interface EmailTableProps {
  columns: EmailTableHeader[];
  tableRows: EmailTableRow[];
  striped: boolean;
}

export interface EmailInsertBlockProps {
  code: string;
}

export interface EmailInsertTemplateProps {
  code: string;
}

export interface EmailSectionProps {
  backgroundColor: string;
  paddingY: number;
  paddingX: number;
  /** Puck slot — nested email-safe nodes (also resolved from zones). */
  content?: unknown;
}

export type EmailVerticalAlign = 'top' | 'middle' | 'bottom';

/**
 * Multi-column row for email — rendered as a fixed table (not responsive).
 * Children must be {@link EmailColumn} nodes (Puck slot `allow`).
 */
export interface EmailRowProps {
  /** Horizontal gap between columns (px); applied as cell padding in HTML. */
  gap: number;
  verticalAlign: EmailVerticalAlign;
  content?: unknown;
}

/** A single column inside {@link EmailRow}; holds nested email-safe blocks. */
export interface EmailColumnProps {
  /** Width on a 12-column grid (canvas + HTML %). */
  span: number;
  content?: unknown;
}

/**
 * Brand logo block. `src` is always the branding directive at send time;
 * the admin canvas resolves the live logo URL from branding settings.
 */
export interface EmailLogoProps {
  /** Persist as `{{var branding.logoUrl}}` — not author-edited. */
  src: string;
  alt: string;
  href: string;
  width: number;
  align: EmailAlign;
}

export interface EmailRichTextProps {
  /** TipTap JSON (editor round-trip). */
  content: unknown;
  /** Sanitized email-safe HTML; may contain {{var}} markers in text. */
  html: string;
  align: EmailAlign;
}

export interface EmailProductCardProps {
  /** Catalog product slug (authoring picker). */
  productSlug: string;
  productId: string;
  imageSrc: string;
  title: string;
  sku: string;
  price: string;
  href: string;
  ctaLabel: string;
  showImage: boolean;
  showPrice: boolean;
  showSku: boolean;
  align: EmailAlign;
}

export interface EmailProductGridItem {
  productId: string;
  productSlug: string;
  title: string;
  sku: string;
  price: string;
  href: string;
  imageSrc: string;
}

/** Multi-product table grid (email-safe; baked item snapshots at authoring time). */
export interface EmailProductGridProps {
  productSlugs: string[];
  columns: number;
  gap: number;
  showImage: boolean;
  showPrice: boolean;
  showSku: boolean;
  ctaLabel: string;
  items: EmailProductGridItem[];
}

export interface EmailCategoryGridItem {
  categoryId: string;
  categorySlug: string;
  title: string;
  href: string;
  imageSrc: string;
}

/** Multi-category table grid (email-safe; baked item snapshots at authoring time). */
export interface EmailCategoryGridProps {
  categorySlugs: string[];
  columns: number;
  gap: number;
  showImage: boolean;
  items: EmailCategoryGridItem[];
}

export interface EmailOrderSummaryProps {
  /** Heading above the line items. */
  title: string;
  showSku: boolean;
  showName: boolean;
  showQuantity: boolean;
  showPrice: boolean;
  showTotals: boolean;
  /** Outer spacing above the block (px). */
  marginTop: number;
  /** Outer spacing below the block (px). */
  marginBottom: number;
  /**
   * @deprecated Prefer column toggles; kept for legacy trees.
   * When set and no column flags are used, rendered as plain body.
   */
  body?: string;
}

/** Shared props for labeled order detail blocks (address, totals, methods, …). */
export interface EmailOrderLabeledVarProps {
  title: string;
  /** Outer spacing above the block (px). */
  marginTop: number;
  /** Outer spacing below the block (px). */
  marginBottom: number;
}

/** Default vertical rhythm for order detail blocks in the canvas / send HTML. */
export const EMAIL_ORDER_BLOCK_MARGIN_DEFAULT = 12;

/**
 * Order-confirmation detail blocks → template variable they emit.
 * Palette-gated via {@link EMAIL_COMPONENT_REQUIRED_VARIABLES}.
 */
export const EMAIL_ORDER_LABELED_FIELDS = {
  'orders.EmailOrderId': {
    label: 'Order ID',
    defaultTitle: 'Order',
    varKey: 'order.businessId',
    previewHint: 'ORD-1042',
  },
  'orders.EmailBillingAddress': {
    label: 'Billing address',
    defaultTitle: 'Billing address',
    varKey: 'order.billingAddressText',
    previewHint: 'Acme Sp. z o.o.\nul. Główna 1',
  },
  'orders.EmailShippingAddress': {
    label: 'Shipping address',
    defaultTitle: 'Shipping address',
    varKey: 'order.shippingAddressText',
    previewHint: 'Anna Nowak\nul. Główna 1',
  },
  'orders.EmailOrderTotals': {
    label: 'Summary',
    defaultTitle: 'Summary',
    varKey: 'order.summaryText',
    previewHint: 'Suma częściowa: …\nVAT: …\nRazem: …',
  },
  'orders.EmailAppliedDiscounts': {
    label: 'Applied discounts',
    defaultTitle: 'Applied discounts',
    varKey: 'order.discountsText',
    previewHint: 'SUMMER10: -50,00 PLN',
  },
  'orders.EmailDeliveryMethod': {
    label: 'Delivery method',
    defaultTitle: 'Delivery method',
    varKey: 'order.shippingLine',
    previewHint: 'Courier — 15,00 PLN',
  },
  'orders.EmailPaymentMethod': {
    label: 'Payment method',
    defaultTitle: 'Payment method',
    varKey: 'order.paymentLine',
    previewHint: 'Card (+5,00 PLN)',
  },
} as const;

export type EmailOrderLabeledFieldName = keyof typeof EMAIL_ORDER_LABELED_FIELDS;

export type EmailSocialNetwork =
  | 'facebook'
  | 'instagram'
  | 'linkedin'
  | 'x'
  | 'youtube'
  | 'tiktok'
  | 'other';

export interface EmailSocialLink {
  network: EmailSocialNetwork;
  href: string;
  label?: string;
  /** When false, the link is hidden. Default true. */
  enabled?: boolean;
}

export interface EmailSocialProps {
  links: EmailSocialLink[];
  align: EmailAlign;
  showIcons: boolean;
  showLabels: boolean;
  iconSize: number;
  useBrandColors: boolean;
  /** Used when useBrandColors is false. */
  color: string;
}

export interface EmailCalloutProps {
  text: string;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  align: EmailAlign;
}

export interface EmailFooterLegalProps {
  text: string;
  align: EmailAlign;
}

/**
 * Canonical set of component names the email editor exposes and the renderer
 * understands. Used by the admin palette and by backend save-time validation.
 */
export const EMAIL_SAFE_COMPONENT_NAMES = [
  'transactional_emails.EmailHeading',
  'transactional_emails.EmailText',
  'transactional_emails.EmailButton',
  'transactional_emails.EmailImage',
  'transactional_emails.EmailDivider',
  'transactional_emails.EmailSpacer',
  'transactional_emails.EmailTable',
  'transactional_emails.EmailInsertBlock',
  'transactional_emails.EmailSection',
  'transactional_emails.EmailRow',
  'transactional_emails.EmailColumn',
  'transactional_emails.EmailLogo',
  'transactional_emails.EmailRichText',
  'catalog.EmailProductCard',
  'catalog.EmailProductGrid',
  'catalog.EmailCategoryGrid',
  'orders.EmailOrderSummary',
  'orders.EmailOrderId',
  'orders.EmailBillingAddress',
  'orders.EmailShippingAddress',
  'orders.EmailOrderTotals',
  'orders.EmailAppliedDiscounts',
  'orders.EmailDeliveryMethod',
  'orders.EmailPaymentMethod',
  'transactional_emails.EmailSocial',
  'transactional_emails.EmailCallout',
  'transactional_emails.EmailFooterLegal',
] as const;

/**
 * Palette components that only make sense when the email declares these variables.
 * Used by the admin editor to hide commerce blocks outside their owning templates.
 */
export const EMAIL_COMPONENT_REQUIRED_VARIABLES: Readonly<Record<string, readonly string[]>> = {
  'orders.EmailOrderSummary': ['order.items'],
  'orders.EmailOrderId': ['order.businessId'],
  'orders.EmailBillingAddress': ['order.billingAddressText'],
  'orders.EmailShippingAddress': ['order.shippingAddressText'],
  'orders.EmailOrderTotals': ['order.summaryText'],
  'orders.EmailAppliedDiscounts': ['order.discountsText'],
  'orders.EmailDeliveryMethod': ['order.shippingLine'],
  'orders.EmailPaymentMethod': ['order.paymentLine'],
};

export type EmailComponentName = (typeof EMAIL_SAFE_COMPONENT_NAMES)[number];

export function isEmailSafeComponentName(name: string): name is EmailComponentName {
  return (EMAIL_SAFE_COMPONENT_NAMES as readonly string[]).includes(name);
}
