import type { FeedTaxonomyCheckReason } from '@endora-commerce/contracts';

/**
 * The overlay seam for taxonomy egress — feature 067 / Principle XV,
 * research §R24.
 *
 * A deployment that must not egress at all, or that populates the files
 * out-of-band into a mounted volume, replaces the transport by implementing
 * this interface in its overlay module; `tsc` is the contract gate. The refresh
 * service depends on nothing else about how the bytes arrive.
 */

export interface TaxonomyFetchRequest {
  url: string;
  /** Replayed as `If-None-Match`. A bandwidth optimisation, never an identity. */
  etag?: string | null;
  /** Aborts the request as part of the whole-check budget. */
  signal?: AbortSignal;
}

export interface TaxonomyFetchSuccess {
  ok: true;
  /** Empty when `notModified` — the caller then reuses what it already has. */
  body: string;
  bytesRead: number;
  etag: string | null;
  httpStatus: number;
  /** `304`: the provider says the stored validator still matches. */
  notModified: boolean;
}

export interface TaxonomyFetchFailure {
  ok: false;
  /**
   * `failed` = we never got a usable response (transport, HTTP status);
   * `rejected` = we got bytes and they are not a taxonomy. The distinction is
   * what lets the admin say "your proxy blocks this" rather than "something
   * went wrong" (research §R22).
   */
  outcome: 'failed' | 'rejected';
  reason: FeedTaxonomyCheckReason;
  /** One human-readable line. Never a stack trace, never response bytes. */
  detail: string;
  httpStatus: number | null;
  bytesRead: number | null;
}

export type TaxonomyFetchResult = TaxonomyFetchSuccess | TaxonomyFetchFailure;

export interface TaxonomySourceFetcherPort {
  fetchFile(request: TaxonomyFetchRequest): Promise<TaxonomyFetchResult>;
}
