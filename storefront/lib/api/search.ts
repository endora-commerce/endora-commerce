import type { ProductSummary } from '@b2b/contracts';

/**
 * Storefront client for the search module's typeahead endpoint —
 * feature 006 / US1 / T016.
 *
 * Hit from a 'use client' component (`<SearchAutocomplete>`), so the URL
 * must be reachable from the browser. We accept `apiBaseUrl` as a prop
 * from the server-rendered shell rather than reading the env directly,
 * matching the convention in `components/ComparisonTable.tsx`.
 */

export interface SuggestResponse {
  data: ProductSummary[];
  meta: {
    limit: number;
    minimumQueryLength: number;
    queryEcho: string;
  };
}

export interface SuggestOptions {
  apiBaseUrl: string;
  q: string;
  limit?: number;
  signal?: AbortSignal;
  /** Forwarded as `X-Sales-Channel` so the browser-side query honours the
   *  same channel scoping as the server-rendered page. */
  salesChannelCode?: string;
}

export class SearchSuggestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'SearchSuggestError';
  }
}

export async function getSuggestions(opts: SuggestOptions): Promise<SuggestResponse> {
  const params = new URLSearchParams({ q: opts.q });
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.salesChannelCode) headers['X-Sales-Channel'] = opts.salesChannelCode;

  const response = await fetch(
    `${opts.apiBaseUrl}/api/v1/search/suggest?${params.toString()}`,
    {
      method: 'GET',
      headers,
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      credentials: 'include',
      cache: 'no-store',
    },
  );
  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as
      | { error: { code: string; message: string } }
      | null;
    if (envelope?.error) {
      throw new SearchSuggestError(
        response.status,
        envelope.error.code,
        envelope.error.message,
      );
    }
    throw new SearchSuggestError(
      response.status,
      'INTERNAL',
      `HTTP ${response.status}`,
    );
  }
  return (await response.json()) as SuggestResponse;
}

// ---------------------------------------------------------------------------
// POST /api/v1/search/record — feature 006 / US3 / T038
// ---------------------------------------------------------------------------

export interface RecordPhraseOptions {
  /** Backend base URL — server-side env (`BACKEND_BASE_URL`). */
  apiBaseUrl: string;
  /** Verbatim phrase the customer committed (Enter / "Search"). */
  phrase: string;
  /** Result-page count; pass `0` for dead-end phrases. */
  resultCount: number;
  /** Forwarded as `X-Sales-Channel`. Resolved server-side from the page context. */
  salesChannelCode?: string;
}

/**
 * Fire-and-forget analytics ingest from the storefront `/search` page
 * server component. The promise resolves once the HTTP request has
 * been dispatched; the page MUST NOT await it. Any failure (network,
 * 5xx, 4xx) is swallowed and console-logged so the page render is
 * never delayed by analytics persistence (FR-015).
 *
 * The endpoint always returns `202 { ok: true }` once shape validation
 * passes; clients do not retry, do not surface errors.
 */
export async function recordPhrase(opts: RecordPhraseOptions): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (opts.salesChannelCode) headers['X-Sales-Channel'] = opts.salesChannelCode;
  try {
    await fetch(`${opts.apiBaseUrl}/api/v1/search/record`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phrase: opts.phrase, resultCount: opts.resultCount }),
      cache: 'no-store',
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'storefront recordPhrase failed',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
