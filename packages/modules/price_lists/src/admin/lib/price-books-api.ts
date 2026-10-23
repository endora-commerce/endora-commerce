import { z } from 'zod';
import {
  adminProductVariantsResponseSchema,
  precedenceViewSchema,
  priceBookLinesResponseSchema,
  priceBookListResponseSchema,
  priceBookProductLinesResponseSchema,
  priceBookResolvedLineSchema,
  priceBookRowsDryRunSchema,
  priceBookRowsResponseSchema,
  priceBookRowsWriteResultSchema,
  priceBookSchema,
  priceBookTargetAttributesResponseSchema,
  priceBookTargetCategoriesResponseSchema,
  priceBookTargetCurrenciesResponseSchema,
  priceBookTargetCustomerGroupsResponseSchema,
  priceBookTargetOrganizationsResponseSchema,
  priceBookTargetSalesChannelsResponseSchema,
  productBasePricesSchema,
  showListPriceWriteSchema,
  type BasePricesWrite,
  type PrecedenceView,
  type PriceBook,
  type PriceBookAudienceKind,
  type PriceBookBatchRowInput,
  type PriceBookCreate,
  type PriceBookDuplicate,
  type PriceBookLinesResponse,
  type PriceBookListResponse,
  type PriceBookPatch,
  type PriceBookResolvedLine,
  type PriceBookResolveRequest,
  type PriceBookRowsDryRun,
  type PriceBookRowsResponse,
  type PriceBookRowsWriteResult,
  type PriceBookSelectionKind,
  type PriceBookStatus,
  type PriceBookTargetAttribute,
  type PriceBookTargetCategory,
  type PriceBookTargetCurrency,
  type PriceBookTargetCustomerGroup,
  type PriceBookTargetOrganization,
  type PriceBookTargetSalesChannel,
  type PriceBookType,
  type ProductBasePrices,
} from '@endora-commerce/contracts';
import type { apiClient } from '@endora-commerce/admin-kit/lib';

/** The transport the client sends through: the admin kit's `apiClient`, or a test's fake of it. */
export type PriceBooksTransport = typeof apiClient;

/**
 * The price-book editor's API client (feature 161, T045) — one method per
 * endpoint of `specs/161-price-book-editor/contracts/ui-api-mapping.md`.
 *
 * Every answer is parsed through the contracts' schema of its endpoint before a
 * screen sees it. A refusal is a {@link PriceBooksApiShapeError} naming the
 * request, so a drift between the API and the editor fails at the boundary, in
 * one sentence, rather than as a screen rendering `undefined`. Refusals of the
 * API itself (`409 PRICE_BOOK_STALE`, `400` with `errors[]`) are the admin
 * kit's `ApiError`, untouched: the screens map them.
 *
 * The transport is injected — the screens pass the kit's `apiClient`, a test a
 * fake — so this file holds no session and no origin.
 */

const BASE = '/api/v1/admin/price-books';

type Issues = z.ZodError['issues'];

export class PriceBooksApiShapeError extends Error {
  readonly request: string;
  readonly issues: Issues;
  constructor(request: string, issues: Issues) {
    super(`${request} answered a shape the editor cannot read: ${issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`);
    this.name = 'PriceBooksApiShapeError';
    this.request = request;
    this.issues = issues;
  }
}

/** The book list's filters (`priceBookListQuerySchema`), as the screen holds them. */
export interface PriceBookListFilters {
  readonly type?: readonly PriceBookType[];
  readonly status?: readonly PriceBookStatus[];
  readonly currency?: string;
  readonly channelId?: string;
  readonly audienceKind?: PriceBookAudienceKind;
  readonly memberId?: string;
  readonly search?: string;
  readonly productId?: string;
  readonly variantId?: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface PriceBookLinesFilters {
  readonly kind?: readonly PriceBookSelectionKind[];
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
}

export interface PriceBookRowsFilters {
  readonly page: number;
  readonly pageSize: number;
  readonly selectionKind?: readonly PriceBookSelectionKind[];
  readonly search?: string;
}

/** One rows batch (`priceBookRowsWriteSchema`) without its version, which the write names. */
export interface PriceBookRowsBatch {
  readonly mode: 'merge' | 'replace';
  readonly upsert: readonly PriceBookBatchRowInput[];
  readonly delete: readonly string[];
}

export type OrganizationTargetQuery =
  | { readonly search?: string; readonly limit?: number; readonly ids?: undefined }
  | { readonly ids: readonly string[] };

export interface PriceBooksApi {
  list(filters: PriceBookListFilters): Promise<PriceBookListResponse>;
  get(id: string): Promise<PriceBook>;
  create(body: PriceBookCreate): Promise<PriceBook>;
  /** `PATCH` with the version the edit started from (G5). */
  patch(id: string, body: PriceBookPatch, expectedVersion: number): Promise<PriceBook>;
  activate(id: string): Promise<PriceBook>;
  draftify(id: string): Promise<PriceBook>;
  duplicate(id: string, body: PriceBookDuplicate): Promise<PriceBook>;
  remove(id: string): Promise<void>;
  /** The grid's pages, cut by line (G15). */
  lines(id: string, filters: PriceBookLinesFilters): Promise<PriceBookLinesResponse>;
  /** Which of `productIds` already have a line in the book (one request; ≤ 200 ids). */
  productLines(id: string, productIds: readonly string[]): Promise<string[]>;
  /** Rows page by page — the export. */
  rows(id: string, filters: PriceBookRowsFilters): Promise<PriceBookRowsResponse>;
  /** The import preview: the same body as the write, writing nothing (G10). */
  previewRows(id: string, batch: PriceBookRowsBatch): Promise<PriceBookRowsDryRun>;
  /** One audited batch against the version the edits started from. */
  writeRows(id: string, batch: PriceBookRowsBatch, expectedVersion: number): Promise<PriceBookRowsWriteResult>;
  basePrices(productId: string): Promise<ProductBasePrices>;
  /**
   * Every variant the catalogue holds for a product (FR-009), id and SKU,
   * through the catalogue's admin variant read (`catalog:read`) — not the
   * storefront's product read, which hides an inactive or out-of-channel
   * product.
   */
  productVariants(productId: string): Promise<Array<{ id: string; sku: string }>>;
  writeBasePrices(productId: string, body: BasePricesWrite): Promise<ProductBasePrices>;
  resolve(body: PriceBookResolveRequest): Promise<PriceBookResolvedLine[]>;
  precedence(): Promise<PrecedenceView>;
  showListPrice(): Promise<boolean>;
  setShowListPrice(value: boolean): Promise<boolean>;
  readonly targets: {
    currencies(): Promise<PriceBookTargetCurrency[]>;
    salesChannels(currency?: string): Promise<PriceBookTargetSalesChannel[]>;
    customerGroups(): Promise<PriceBookTargetCustomerGroup[]>;
    organizations(query: OrganizationTargetQuery): Promise<PriceBookTargetOrganization[]>;
    categories(): Promise<PriceBookTargetCategory[]>;
    attributes(): Promise<PriceBookTargetAttribute[]>;
  };
}

/** A `{ data: … }` envelope around `schema`, unwrapped. */
const dataOf = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ data: schema }).transform((answer) => (answer as { data: z.output<T> }).data);

function query(entries: ReadonlyArray<readonly [string, string | number | readonly string[] | undefined]>): string {
  const params = new URLSearchParams();
  for (const [name, value] of entries) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) params.append(name, String(item));
    else params.append(name, String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

const book = (id: string): string => `${BASE}/${encodeURIComponent(id)}`;

export function createPriceBooksApi(client: PriceBooksTransport): PriceBooksApi {
  /** Parse `answer` through `schema`, or refuse naming the request. */
  function read<T extends z.ZodTypeAny>(request: string, answer: unknown, schema: T): z.output<T> {
    const parsed = schema.safeParse(answer);
    if (!parsed.success) throw new PriceBooksApiShapeError(request, parsed.error.issues);
    return parsed.data;
  }
  const items = <T>(parsed: { data: { items: T[] } }): T[] => parsed.data.items;

  async function get<T extends z.ZodTypeAny>(path: string, schema: T): Promise<z.output<T>> {
    return read(`GET ${path}`, await client.get<unknown>(path), schema);
  }
  async function send<T extends z.ZodTypeAny>(
    method: 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: unknown,
    schema: T,
  ): Promise<z.output<T>> {
    const answer =
      method === 'POST'
        ? await client.post<unknown>(path, body)
        : method === 'PUT'
          ? await client.put<unknown>(path, body)
          : await client.patch<unknown>(path, body);
    return read(`${method} ${path}`, answer, schema);
  }

  return {
    list: (f) =>
      get(
        `${BASE}${query([
          ['type', f.type],
          ['status', f.status],
          ['currency', f.currency],
          ['channelId', f.channelId],
          ['audienceKind', f.audienceKind],
          ['memberId', f.memberId],
          ['search', f.search],
          ['productId', f.productId],
          ['variantId', f.variantId],
          ['page', f.page],
          ['pageSize', f.pageSize],
        ])}`,
        priceBookListResponseSchema,
      ),
    get: (id) => get(book(id), dataOf(priceBookSchema)),
    create: (body) => send('POST', BASE, body, dataOf(priceBookSchema)),
    patch: (id, body, expectedVersion) => send('PATCH', book(id), { ...body, expectedVersion }, dataOf(priceBookSchema)),
    activate: (id) => send('POST', `${book(id)}/activate`, undefined, dataOf(priceBookSchema)),
    draftify: (id) => send('POST', `${book(id)}/draftify`, undefined, dataOf(priceBookSchema)),
    duplicate: (id, body) => send('POST', `${book(id)}/duplicate`, body, dataOf(priceBookSchema)),
    remove: async (id) => {
      await client.delete<void>(book(id));
    },
    lines: (id, f) =>
      get(
        `${book(id)}/lines${query([
          ['kind', f.kind],
          ['search', f.search],
          ['page', f.page],
          ['pageSize', f.pageSize],
        ])}`,
        priceBookLinesResponseSchema,
      ),
    productLines: async (id, productIds) => {
      if (productIds.length === 0) return [];
      const answer = await get(
        `${book(id)}/product-lines${query([['productIds', productIds.join(',')]])}`,
        priceBookProductLinesResponseSchema,
      );
      return answer.data.productIds;
    },
    rows: (id, f) =>
      get(
        `${book(id)}/rows${query([
          ['selectionKind', f.selectionKind],
          ['search', f.search],
          ['page', f.page],
          ['pageSize', f.pageSize],
        ])}`,
        priceBookRowsResponseSchema,
      ),
    previewRows: (id, batch) => send('PUT', `${book(id)}/rows?dryRun=true`, batch, dataOf(priceBookRowsDryRunSchema)),
    writeRows: (id, batch, expectedVersion) =>
      send('PUT', `${book(id)}/rows`, { ...batch, expectedVersion }, dataOf(priceBookRowsWriteResultSchema)),
    basePrices: (productId) =>
      get(`${BASE}/base-prices${query([['productId', productId]])}`, dataOf(productBasePricesSchema)),
    writeBasePrices: (productId, body) =>
      send('PUT', `${BASE}/base-prices/${encodeURIComponent(productId)}`, body, dataOf(productBasePricesSchema)),
    resolve: (body) => send('POST', `${BASE}/resolve`, body, dataOf(priceBookResolvedLineSchema.array())),
    precedence: () => get(`${BASE}/precedence`, dataOf(precedenceViewSchema)),
    showListPrice: async () =>
      (await get(`${BASE}/settings/show-list-price`, dataOf(showListPriceWriteSchema))).value,
    setShowListPrice: async (value) =>
      (await send('PUT', `${BASE}/settings/show-list-price`, { value }, dataOf(showListPriceWriteSchema))).value,
    productVariants: async (productId) => {
      const answer = await get(`/api/v1/admin/catalog/products/${encodeURIComponent(productId)}/variants`, adminProductVariantsResponseSchema);
      return answer.data.map((v) => ({ id: v.id, sku: v.sku }));
    },
    targets: {
      currencies: async () => items(await get(`${BASE}/targets/currencies`, priceBookTargetCurrenciesResponseSchema)),
      salesChannels: async (currency) =>
        items(
          await get(
            `${BASE}/targets/sales-channels${query([['currency', currency]])}`,
            priceBookTargetSalesChannelsResponseSchema,
          ),
        ),
      customerGroups: async () =>
        items(await get(`${BASE}/targets/customer-groups`, priceBookTargetCustomerGroupsResponseSchema)),
      organizations: async (q) => {
        if (q.ids !== undefined && q.ids.length === 0) return [];
        const path =
          q.ids !== undefined
            ? `${BASE}/targets/organizations${query([['ids', q.ids.join(',')]])}`
            : `${BASE}/targets/organizations${query([
                ['search', q.search],
                ['limit', q.limit],
              ])}`;
        return items(await get(path, priceBookTargetOrganizationsResponseSchema));
      },
      categories: async () =>
        items(await get(`${BASE}/targets/categories`, priceBookTargetCategoriesResponseSchema)),
      attributes: async () =>
        items(await get(`${BASE}/targets/attributes`, priceBookTargetAttributesResponseSchema)),
    },
  };
}
