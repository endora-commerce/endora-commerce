import { apiClient } from '@/lib/api-client';
import { slugify as sharedSlugify } from '@endora-commerce/contracts';
import type {
  FeedDeliveryAttempt,
  FeedDeliveryConfig,
  FeedDeliveryFailureReason,
  FeedFieldSourceCatalogue,
  FeedFieldSourceKind,
  FeedFieldTransform,
  FeedOutputFormat,
  FeedItemGranularity,
  FeedProviderCode,
  FeedRunStatus,
  FeedRunTrigger,
  FeedPricePresentation,
  ProductSelectionRule,
  TaxonomyProviderCode,
  UpsertFeedDeliveryRequest,
} from '@endora-commerce/contracts';

/**
 * Admin API client for the Product Feed module (feature 067).
 *
 * A thin wrapper over `/api/v1/admin/product-feeds/**`. Two shapes are
 * module-local rather than imported from `@endora-commerce/contracts`:
 *
 *  - `IssuedFeedToken` — the plaintext link, returned exactly once on create
 *    and on rotate and never readable afterwards (FR-046). It is deliberately
 *    NOT part of the feed DTO, so no screen can accidentally re-render it from
 *    a list response.
 *  - `FeedTemplateSummary` — the read-only template list this phase exposes;
 *    the full template CRUD contract lands with the template editor.
 */

const BASE = '/api/v1/admin/product-feeds';
const TEMPLATES = '/api/v1/admin/feed-templates';

/** Origin for the download anchors, which bypass `apiClient` on purpose. */
function apiOrigin(): string {
  return (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';
}

export interface FeedTokenView {
  prefix: string | null;
  rotatedAt: string | null;
  revokedAt: string | null;
  /**
   * The feed's absolute public URL, or null when revoked. It is the real,
   * working link whenever {@link urlIsLive} is true; otherwise it is a masked
   * display form built from the prefix.
   */
  url: string | null;
  /**
   * False for tokens issued before the plaintext became recoverable, and on a
   * deployment with no encryption key. The card must not offer to copy a URL
   * that would 404.
   */
  urlIsLive: boolean;
}

export interface FeedRunSummary {
  id: string;
  status: FeedRunStatus;
  trigger: FeedRunTrigger;
  startedAt: string | null;
  finishedAt: string | null;
  emittedCount: number;
  skippedCount: number;
  warningCount: number;
  failureCode: string | null;
}

/**
 * FR-054 — one item-level skip or warning.
 *
 * `sku` is a **snapshot** taken when the run happened, and `productId` carries
 * no foreign key, so the row stays readable after the product is renamed or
 * deleted. The run detail therefore never links a SKU to a product page it
 * cannot promise still exists.
 */
export interface FeedRunIssueDto {
  id: string;
  severity: 'skip' | 'warning';
  reason: string;
  productId: string | null;
  variantId: string | null;
  sku: string | null;
  outputName: string | null;
  detail: string | null;
}

export interface FeedRunDetail extends FeedRunSummary {
  productFeedId: string;
  triggeredByAdminUserId: string | null;
  consideredCount: number;
  durationMs: number | null;
  failureDetail: string | null;
  skipReason: string | null;
  issueOverflow: boolean;
  artefact: {
    id: string;
    byteSize: number;
    itemCount: number;
    contentType: string;
    producedAt: string;
    isPublished: boolean;
  } | null;
  createdAt: string;
}

export interface ProductFeedDto {
  id: string;
  name: string;
  slug: string;
  feedTemplateId: string;
  feedTemplateName: string;
  salesChannelId: string;
  salesChannelCode: string;
  languageCode: string;
  currencyCode: string;
  priceListId: string | null;
  pricePresentation: FeedPricePresentation;
  taxCountry: string | null;
  selectionRule: ProductSelectionRule;
  schedule: { cron: string; timezone: string } | null;
  enabled: boolean;
  token: FeedTokenView;
  lastRun: FeedRunSummary | null;
  nextRunAt: string | null;
  publishedArtefactId: string | null;
  publishedItemCount: number | null;
  publishedAt: string | null;
  isRunning: boolean;
  scheduleTooTightWarning: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface IssuedFeedToken {
  token: string;
  url: string;
  prefix: string;
  rotatedAt: string;
}

export interface FeedTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  providerCode: FeedProviderCode;
  outputFormat: FeedOutputFormat;
  itemGranularity: FeedItemGranularity;
  taxonomyProviderCode: TaxonomyProviderCode | null;
  isSystem: boolean;
  systemCode: string | null;
  usedByFeedCount: number;
  fieldCount: number;
  version: number;
  updatedAt: string;
}

export interface FeedTemplateFieldDto {
  id: string;
  outputName: string;
  sourceKind: FeedFieldSourceKind;
  sourceKey: string | null;
  constantValue: string | null;
  fallbackValue: string | null;
  providerRequired: boolean;
  transform: FeedFieldTransform | null;
  transformArg: string | null;
  sortOrder: number;
  helpKey: string | null;
  unbound: boolean;
}

export interface FeedTemplateDetail extends FeedTemplateSummary {
  fields: FeedTemplateFieldDto[];
}

/** FR-074 — what the operator has to acknowledge before a save goes through. */
export interface TemplateSaveWarning {
  code: 'provider_required_field_removed';
  outputName: string;
}

export interface TemplateWriteBody {
  name?: string;
  description?: string | null;
  providerCode?: FeedProviderCode;
  outputFormat?: FeedOutputFormat;
  itemGranularity?: FeedItemGranularity;
  taxonomyProviderCode?: TaxonomyProviderCode | null;
  fields?: Array<Record<string, unknown>>;
}

/** FR-072 — the resolved value of one field for the operator's sample product. */
export interface TemplatePreviewField {
  outputName: string;
  value: string | null;
  resolvedFrom: 'source' | 'fallback' | 'omitted';
  wouldSkipItem: boolean;
  issueReason: string | null;
  unbound: boolean;
  helpKey: string | null;
}

export interface TemplatePreview {
  fields: TemplatePreviewField[];
  wouldEmitItem: boolean;
  skipReason: string | null;
  renderedItem: string;
  resolvedContext: {
    salesChannelId: string;
    languageCode: string;
    currencyCode: string;
    priceListId: string | null;
    pricePresentation: FeedPricePresentation;
    taxCountry: string | null;
  };
}

export interface CreateFeedBody {
  name: string;
  slug: string;
  feedTemplateId: string;
  salesChannelId: string;
  languageCode: string;
  currencyCode: string;
  pricePresentation?: FeedPricePresentation;
  taxCountry?: string | null;
}

export interface UpdateFeedBody {
  name?: string;
  enabled?: boolean;
  pricePresentation?: FeedPricePresentation;
  taxCountry?: string | null;
  priceListId?: string | null;
  selectionRule?: ProductSelectionRule;
  /** `null` clears the schedule; the server removes the Job Scheduler after commit. */
  schedule?: { cron: string; timezone: string } | null;
}

/**
 * FR-012 — the portability envelope, exactly as a file on disk carries it.
 *
 * Typed loosely on purpose: the browser has just read this out of a file the
 * operator was handed, so the admin must not pretend to know its shape. The
 * server is the only place that parses it (`feedTemplateDocumentSchema`), and
 * the admin's job is to hand it over unmodified and render the refusal.
 */
export type FeedTemplateDocumentBody = Record<string, unknown>;

/** FR-015 — a binding the target installation could not resolve. */
export interface UnresolvedBinding {
  outputName: string;
  sourceKind: FeedFieldSourceKind;
  sourceKey: string;
}

/** FR-028 — the match count for an **unsaved** criteria set. Never takes a feed id. */
export interface SelectionPreview {
  matchedCount: number;
  sample: Array<{ id: string; sku: string; name: string }>;
}

/**
 * The largest page `listQuerySchema` accepts (`packages/contracts/src/pagination.ts`).
 * Exported so the run-detail page can tell "this run had 200 problems" from
 * "this run had more problems than one page holds" — a full page means the
 * list is truncated and the CSV export is the only complete view.
 */
export const RUN_ISSUE_PAGE_LIMIT = 200;

export const productFeedsClient = {
  list(limit = 50): Promise<{ data: ProductFeedDto[] }> {
    return apiClient.get<{ data: ProductFeedDto[] }>(`${BASE}?limit=${limit}`);
  },

  get(id: string): Promise<{ data: ProductFeedDto }> {
    return apiClient.get<{ data: ProductFeedDto }>(`${BASE}/${id}`);
  },

  create(body: CreateFeedBody): Promise<{
    data: { feed: ProductFeedDto; issuedToken: IssuedFeedToken };
  }> {
    return apiClient.post(BASE, body);
  },

  update(id: string, body: UpdateFeedBody): Promise<{ data: ProductFeedDto }> {
    return apiClient.patch<{ data: ProductFeedDto }>(`${BASE}/${id}`, body);
  },

  duplicate(
    id: string,
    body: { name: string; slug: string },
  ): Promise<{ data: { feed: ProductFeedDto; issuedToken: IssuedFeedToken } }> {
    return apiClient.post(`${BASE}/${id}/duplicate`, body);
  },

  remove(id: string): Promise<void> {
    return apiClient.delete(`${BASE}/${id}`);
  },

  generate(id: string): Promise<{ data: { runId: string; status: 'queued' } }> {
    return apiClient.post(`${BASE}/${id}/generate`, {});
  },

  rotateToken(id: string): Promise<{ data: IssuedFeedToken }> {
    return apiClient.post(`${BASE}/${id}/token/rotate`, {});
  },

  revokeToken(id: string): Promise<{ data: ProductFeedDto }> {
    return apiClient.post(`${BASE}/${id}/token/revoke`, {});
  },

  listRuns(id: string, limit = 20): Promise<{ data: FeedRunDetail[] }> {
    return apiClient.get<{ data: FeedRunDetail[] }>(`${BASE}/${id}/runs?limit=${limit}`);
  },

  getRun(id: string, runId: string): Promise<{ data: FeedRunDetail }> {
    return apiClient.get<{ data: FeedRunDetail }>(`${BASE}/${id}/runs/${runId}`);
  },

  /**
   * FR-054 — the per-item diagnostics. `:read`, deliberately: a read-only
   * operator has to be able to answer "why were 61 products left out" without
   * being handed the priced catalogue the artefact carries.
   *
   * Capped at `RUN_ISSUE_PAGE_LIMIT`: the shared `listQuerySchema` rejects
   * anything larger, and the run-detail page loads this alongside the feed and
   * the run in one `Promise.all`, so a 400 here hid the whole run.
   */
  listRunIssues(
    id: string,
    runId: string,
    limit: number = RUN_ISSUE_PAGE_LIMIT,
  ): Promise<{ data: FeedRunIssueDto[] }> {
    return apiClient.get<{ data: FeedRunIssueDto[] }>(
      `${BASE}/${id}/runs/${runId}/issues?limit=${limit}`,
    );
  },

  /** Absolute URL of the admin download. Gated on `product_feeds:write`. */
  artefactUrl(id: string): string {
    return `${apiOrigin()}${BASE}/${id}/artefact`;
  },

  /** The file one specific run produced, which may not be the published one. */
  runArtefactUrl(id: string, runId: string): string {
    return `${apiOrigin()}${BASE}/${id}/runs/${runId}/artefact`;
  },

  /** The complete recorded issue list as CSV. `:write` — it names every SKU. */
  runIssueExportUrl(id: string, runId: string): string {
    return `${apiOrigin()}${BASE}/${id}/runs/${runId}/issues/export`;
  },

  /**
   * Match count for a criteria set the operator has not saved yet (FR-028).
   * Draft-shaped on purpose — a channel and a rule, no feed id — so it answers
   * on `/product-feeds/new` too. Side-effect-free.
   */
  previewSelection(input: {
    salesChannelId: string;
    selectionRule: ProductSelectionRule;
  }): Promise<{ data: SelectionPreview }> {
    return apiClient.post<{ data: SelectionPreview }>(
      '/api/v1/admin/feed-previews/selection',
      input,
    );
  },

  listTemplates(): Promise<{ data: FeedTemplateSummary[] }> {
    return apiClient.get<{ data: FeedTemplateSummary[] }>(TEMPLATES);
  },

  getTemplate(id: string): Promise<{ data: FeedTemplateDetail }> {
    return apiClient.get<{ data: FeedTemplateDetail }>(`${TEMPLATES}/${id}`);
  },

  createTemplate(body: TemplateWriteBody): Promise<{ data: FeedTemplateDetail }> {
    return apiClient.post<{ data: FeedTemplateDetail }>(TEMPLATES, body);
  },

  /**
   * The whole ordered field list is saved at once (contract §2), guarded by the
   * version the editor loaded — so fifteen minutes of work is never silently
   * overwritten, and never silently overwrites (FR-076).
   */
  updateTemplate(
    id: string,
    version: number,
    body: TemplateWriteBody,
    options: { acknowledgeWarnings?: boolean } = {},
  ): Promise<{ data: FeedTemplateDetail; warnings: TemplateSaveWarning[] }> {
    const query = options.acknowledgeWarnings ? '?acknowledgeWarnings=true' : '';
    return apiClient.put<{ data: FeedTemplateDetail; warnings: TemplateSaveWarning[] }>(
      `${TEMPLATES}/${id}${query}`,
      body,
      { headers: { 'If-Match': `W/"${id}:${version}"` } },
    );
  },

  duplicateTemplate(id: string, name: string): Promise<{ data: FeedTemplateDetail }> {
    return apiClient.post<{ data: FeedTemplateDetail }>(`${TEMPLATES}/${id}/duplicate`, { name });
  },

  removeTemplate(id: string, version: number): Promise<void> {
    return apiClient.delete<void>(`${TEMPLATES}/${id}`, {
      headers: { 'If-Match': `W/"${id}:${version}"` },
    });
  },

  /** FR-070 — everything the operator may bind to, on this installation. */
  listFieldSources(): Promise<{ data: FeedFieldSourceCatalogue }> {
    return apiClient.get<{ data: FeedFieldSourceCatalogue }>(`${TEMPLATES}/field-sources`);
  },

  /**
   * FR-012 — the portability document, as a download.
   *
   * An absolute URL rather than a fetch: the document is a file the operator
   * hands to another installation, so the browser's own download machinery
   * (filename from `Content-Disposition`, no blob in memory) is the right one.
   */
  templateExportUrl(id: string): string {
    const apiBase = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';
    return `${apiBase}${TEMPLATES}/${id}/export`;
  },

  /**
   * FR-014 – FR-018. `onNameConflict` is deliberately absent on the first
   * attempt: the server refuses a collision rather than guessing, and the
   * operator is shown the choice before anything is written.
   */
  importTemplate(
    document: FeedTemplateDocumentBody,
    onNameConflict?: 'create_copy' | 'replace',
  ): Promise<{ data: { template: FeedTemplateDetail; unresolvedBindings: UnresolvedBinding[] } }> {
    return apiClient.post(`${TEMPLATES}/import`, {
      document,
      ...(onNameConflict ? { onNameConflict } : {}),
    });
  },

  /**
   * FR-072 — evaluates the draft **on screen**, never a saved template id, so
   * the operator never has to save a broken intermediate state to see a value.
   */
  previewTemplate(input: {
    baseTemplateId?: string;
    draft: {
      providerCode: FeedProviderCode;
      outputFormat: FeedOutputFormat;
      itemGranularity: FeedItemGranularity;
      taxonomyProviderCode: TaxonomyProviderCode | null;
      fields: Array<Record<string, unknown>>;
    };
    context?: Record<string, unknown>;
    productId: string;
    variantId?: string;
  }): Promise<{ data: TemplatePreview }> {
    return apiClient.post<{ data: TemplatePreview }>(
      '/api/v1/admin/feed-previews/template',
      input,
    );
  },
};

/**
 * Kebab-cases a feed name into a slug candidate, the way the operator expects.
 *
 * The generator is `slugify` from `@endora-commerce/contracts`, **imported, never
 * re-implemented** (issues #239, #245). !753 repaired the fold here by
 * composing `lib/text-normalization.ts`; issue #245 found seven more copies of
 * the same four-line chain and moved the whole thing — fold, collapse, cut,
 * trim, fallback — into one function the backend, the admin and the storefront
 * all import.
 *
 * The private one-liner this started as deleted `ł` instead of folding it:
 * U+0142 has no canonical decomposition, so NFD left it standing and the
 * `[^a-z0-9]` collapse swallowed it. `Kanał sprzedaży` produced
 * `kana-sprzedazy`, a slug missing a letter for no reason the operator can see.
 *
 * **The shared generator is NFD, not NFKD, deliberately.** The compatibility
 * mappings NFKD adds only reach a slug through characters that map *into*
 * `[a-z0-9]` — the `fi` ligature, superscript digits, full-width forms. None of
 * them is typed into a feed name, and where one is, it now collapses to the `-`
 * separator rather than to a wrong letter, so the slug stays legal. That is a
 * much smaller loss than deleting a letter out of every Polish name.
 *
 * The 160-character cut is this caller's own and is passed explicitly: the
 * eight callers cap at 80, 150, 160, 180 or not at all, and a cap decides which
 * new values collide under that caller's constraint.
 *
 * Slugs already published are **not** migrated (owner's ruling, 2026-08-19).
 * A feed's slug is a URL somebody may have handed to Google; re-folding it is
 * a rename, and with two developer environments in existence it buys nothing.
 * New slugs are correct from here on.
 */
export function slugify(value: string): string {
  return sharedSlugify(value, { maxLength: 160 });
}

// ---------------------------------------------------------------------------
// Delivery (feature 070)
// ---------------------------------------------------------------------------

/**
 * The delivery surface, split out from `productFeedsClient` because it is a
 * separable capability: a deployment wired without the credentials module has
 * no delivery routes at all, and the screen has to render that as "unavailable"
 * rather than as a broken tab.
 *
 * The DTO types come from `@endora-commerce/contracts` — every secret on them is already a
 * boolean, so there is nothing here to be careful about beyond not inventing a
 * field the server does not send.
 */
export const feedDeliveryClient = {
  /** `null` data means this feed has no delivery configured, which is a state. */
  get(feedId: string): Promise<{ data: FeedDeliveryConfig | null }> {
    return apiClient.get<{ data: FeedDeliveryConfig | null }>(`${BASE}/${feedId}/delivery`);
  },

  save(
    feedId: string,
    body: UpsertFeedDeliveryRequest,
  ): Promise<{ data: FeedDeliveryConfig }> {
    return apiClient.put<{ data: FeedDeliveryConfig }>(`${BASE}/${feedId}/delivery`, body);
  },

  remove(feedId: string): Promise<void> {
    return apiClient.delete<void>(`${BASE}/${feedId}/delivery`);
  },

  /** FR-106. Rate-limited server-side; a 429 is the expected refusal. */
  test(feedId: string): Promise<{
    data: {
      ok: boolean;
      failureReason: FeedDeliveryFailureReason | null;
      failureDetail: string | null;
      attempt: FeedDeliveryAttempt;
    };
  }> {
    return apiClient.post(`${BASE}/${feedId}/delivery/test`, {});
  },

  listAttempts(feedId: string, limit = 20): Promise<{ data: FeedDeliveryAttempt[] }> {
    return apiClient.get<{ data: FeedDeliveryAttempt[] }>(
      `${BASE}/${feedId}/delivery/attempts?limit=${limit}`,
    );
  },
};
