import type {
  AdminUserReadPort,
  CatalogAttributeReadPort,
  CatalogAttributeView,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  CustomFieldDefinitionReadPort,
  LineGroup,
  OrganizationDetailsPort,
  QuoteRequestDocumentData,
} from '@endora-commerce/contracts';
import { arrangeLineGroups, flattenSections, organizationCompanyTaxId } from '@endora-commerce/contracts';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import type { QuoteRequest } from '../entities/quote-request.entity.js';
import type { QuoteRequestItem } from '../entities/quote-request-item.entity.js';
import { localized } from './texts.js';

/**
 * Builds the data one quote PDF prints (`data-model.md` §4.1, research R-12).
 *
 * It is handed a quote the caller has already proven the requesting
 * administrator may see (the service's visibility rule), so a template cannot
 * widen what the PDF shows (152 FR-033, Constitution XI). It reads one port per
 * question and one call per port: the organisation, the requesting customer,
 * the assigned representative, the channel, the products and their variants for
 * SKUs and attribute values, the attributes shown on the product page, and the
 * quote's custom-field definitions — of which only those customers may see
 * reach the document.
 *
 * Every owner read here is a binding dependency of this module; `catalog`,
 * `custom_fields` and `sales_channels` are non-deactivatable.
 */

export interface QuoteDocumentDataBuilderDeps {
  readonly catalogProducts: Pick<CatalogProductReadPort, 'findByIds' | 'listVariantsByProductIds'>;
  readonly attributes: Pick<CatalogAttributeReadPort, 'listByFlag'>;
  readonly customFieldDefinitions: Pick<CustomFieldDefinitionReadPort, 'listForEntity'>;
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'findById'>;
  readonly adminUsers: Pick<AdminUserReadPort, 'findById'>;
  readonly salesChannels: Pick<SalesChannelResolutionPort, 'getById' | 'getSystemDefault'>;
  readonly taxRate: (organizationId: string) => Promise<number>;
  readonly now?: () => Date;
}

export type QuoteDocumentQuote = Pick<
  QuoteRequest,
  | 'id'
  | 'businessId'
  | 'status'
  | 'currentRevisionNumber'
  | 'createdAt'
  | 'submittedAt'
  | 'approvedAt'
  | 'expiresAt'
  | 'headerNote'
  | 'organizationId'
  | 'customerAccountId'
  | 'assignedAdminUserId'
  | 'salesChannelId'
  | 'customFieldValues'
>;

export type QuoteDocumentLine = Pick<
  QuoteRequestItem,
  | 'id'
  | 'productId'
  | 'variantId'
  | 'productName'
  | 'variantLabel'
  | 'quantity'
  | 'packagingUnitName'
  | 'packagingUnitBaseQuantity'
  | 'agreedUnitPrice'
  | 'desiredUnitPrice'
  | 'referenceUnitPrice'
  | 'referenceCurrency'
  | 'lineCurrency'
  | 'lineNote'
> &
  /** Feature 159 — absent reads as ungrouped at position 0. */
  Partial<Pick<QuoteRequestItem, 'groupId' | 'position'>>;

const BOOLEAN_TEXT: Readonly<Record<'en' | 'pl', readonly [string, string]>> = { en: ['Yes', 'No'], pl: ['Tak', 'Nie'] };

const decimal = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const fullName = (first: string | null | undefined, last: string | null | undefined): string | null => {
  const name = [first, last].map((part) => (part ?? '').trim()).filter((part) => part !== '').join(' ');
  return name === '' ? null : name;
};

function booleanText(value: boolean, language: string): string {
  const pair = language.split('-')[0]?.toLowerCase() === 'pl' ? BOOLEAN_TEXT.pl : BOOLEAN_TEXT.en;
  return value ? pair[0] : pair[1];
}

type Option = { value: string; label: Record<string, string>; labelDefault: string };

/** A stored value as a reader of `language` should see it — option labels resolved, per-locale values picked. */
function displayValue(raw: unknown, options: readonly Option[], language: string): string {
  if (raw === null || raw === undefined) return '';
  const optionLabel = (value: string): string => {
    const option = options.find((candidate) => candidate.value === value);
    return option ? localized(option.label, language, option.labelDefault || value) : value;
  };
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => displayValue(entry, options, language))
      .filter((text) => text !== '')
      .join(', ');
  }
  if (typeof raw === 'boolean') return booleanText(raw, language);
  if (typeof raw === 'number') return Number.isFinite(raw) ? new Intl.NumberFormat(language).format(raw) : '';
  if (typeof raw === 'string') return optionLabel(raw);
  if (typeof raw === 'object') {
    // A language-scoped value: `{ 'pl-PL': '…', 'en-US': '…' }`.
    const values = raw as Record<string, unknown>;
    const strings = Object.fromEntries(
      Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    if (Object.keys(strings).length === 0) return '';
    return optionLabel(localized(strings, language, Object.values(strings)[0] ?? ''));
  }
  return '';
}

export class QuoteDocumentDataBuilder {
  private readonly now: () => Date;

  constructor(private readonly deps: QuoteDocumentDataBuilderDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** The default language of the quote's channel — the system default channel's for a quote with none. */
  async suggestedLanguage(salesChannelId: string | null | undefined): Promise<string> {
    const channel = salesChannelId ? await this.deps.salesChannels.getById(salesChannelId) : null;
    return (channel ?? (await this.deps.salesChannels.getSystemDefault())).defaultLanguage;
  }

  async build(input: {
    readonly quote: QuoteDocumentQuote;
    /** In storage order; arranged here into the display order (feature 159). */
    readonly lines: readonly QuoteDocumentLine[];
    /** Feature 159 — the quote's stored groups; empty ones are not printed (D2). */
    readonly groups?: readonly LineGroup[];
    readonly language: string;
    /** The customer's proposal per line from the submission record, where the row lost it (146 R4). */
    readonly proposals?: ReadonlyMap<string, number | null>;
  }): Promise<QuoteRequestDocumentData> {
    const { quote, language } = input;
    // Feature 159 (FR-011) — the one display order; only groups holding a line
    // reach the document (D2, FR-034).
    const sections = arrangeLineGroups(input.groups ?? [], input.lines);
    const lines = flattenSections(sections);
    const groups = sections.flatMap((section) => (section.group ? [section.group] : []));
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const variantParents = [...new Set(lines.filter((line) => line.variantId).map((line) => line.productId))];
    const [organization, customer, rep, channel, taxRate, products, variants, attributes, definitions] =
      await Promise.all([
        this.deps.organizations.findById(quote.organizationId),
        this.deps.customerAccounts.findById(quote.customerAccountId),
        quote.assignedAdminUserId ? this.deps.adminUsers.findById(quote.assignedAdminUserId) : null,
        quote.salesChannelId ? this.deps.salesChannels.getById(quote.salesChannelId) : null,
        this.deps.taxRate(quote.organizationId),
        productIds.length > 0 ? this.deps.catalogProducts.findByIds(productIds) : [],
        variantParents.length > 0 ? this.deps.catalogProducts.listVariantsByProductIds(variantParents) : [],
        this.deps.attributes.listByFlag('isVisibleOnProductPage'),
        this.deps.customFieldDefinitions.listForEntity('quote_request'),
      ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));

    const attributeValues = (line: QuoteDocumentLine): Record<string, string> => {
      const product = productById.get(line.productId);
      if (!product) return {};
      const variant = line.variantId ? variantById.get(line.variantId) : undefined;
      const values: Record<string, unknown> = { ...(product.attributeValues ?? {}), ...(variant?.variantAttributeValues ?? {}) };
      const out: Record<string, string> = {};
      for (const attribute of attributes as readonly CatalogAttributeView[]) {
        const text = displayValue(values[attribute.key], attribute.options ?? [], language);
        if (text !== '') out[attribute.key] = text;
      }
      return out;
    };

    const bag = quote.customFieldValues ?? {};
    const details = definitions
      .filter(({ definition }) => definition.audience === 'customer')
      .sort((a, b) => a.definition.sortOrder - b.definition.sortOrder)
      .map(({ definition, options }) => ({
        label: localized(definition.label, language, definition.labelDefault || definition.key),
        value: displayValue(bag[definition.key], options ?? [], language),
      }))
      .filter((detail) => detail.value.trim() !== '');

    // A personal (B2C) Organization is not a company (#767): the person is the
    // buyer, so its placeholder tax id and its placeholder head office stay off
    // the document.
    const company = organization && !organization.isPersonal ? organization : null;
    const address = company?.registeredAddress;
    const firstCurrency = lines[0]?.lineCurrency ?? 'PLN';
    return {
      generatedAt: this.now().toISOString(),
      quote: {
        id: quote.id,
        businessId: quote.businessId,
        status: quote.status,
        revisionNumber: quote.currentRevisionNumber,
        createdAt: quote.createdAt.toISOString(),
        submittedAt: quote.submittedAt?.toISOString() ?? null,
        approvedAt: quote.approvedAt?.toISOString() ?? null,
        expiresAt: quote.expiresAt?.toISOString() ?? null,
        headerNote: quote.headerNote ?? null,
        taxRate,
        currency: firstCurrency,
      },
      channel: channel ? { id: channel.id, name: localized(channel.name, language, channel.code) } : null,
      buyer: {
        organizationName: organization?.name ?? '',
        legalName: company?.legalName ?? null,
        taxId: organization ? organizationCompanyTaxId(organization) : null,
        address:
          address && (address.street || address.city)
            ? { line1: address.street, line2: null, postalCode: address.postalCode, city: address.city, country: address.country }
            : null,
        customerName: customer ? fullName(customer.firstName, customer.lastName) : null,
        customerEmail: customer?.email ?? null,
      },
      salesRep: rep ? { name: fullName(rep.firstName, rep.lastName) ?? rep.email, email: rep.email } : null,
      details,
      groups,
      lines: lines.map((line) => {
        const product = productById.get(line.productId);
        const variant = line.variantId ? variantById.get(line.variantId) : undefined;
        return {
          id: line.id,
          productId: line.productId,
          productName: line.productName,
          variantLabel: line.variantLabel ?? null,
          sku: variant?.sku ?? product?.sku ?? null,
          quantity: line.quantity,
          packagingUnitName: line.packagingUnitName ?? null,
          packagingUnitBaseQuantity: line.packagingUnitBaseQuantity ?? null,
          agreedUnitPrice: decimal(line.agreedUnitPrice),
          proposedUnitPrice: decimal(line.desiredUnitPrice) ?? input.proposals?.get(line.id) ?? null,
          referenceUnitPrice: decimal(line.referenceUnitPrice),
          referenceCurrency: line.referenceCurrency ?? null,
          lineCurrency: line.lineCurrency,
          lineNote: line.lineNote ?? null,
          attributes: attributeValues(line),
          groupId: groups.some((group) => group.id === line.groupId) ? (line.groupId ?? null) : null,
          position: line.position ?? 0,
        };
      }),
    };
  }
}
