import type {
  TaxonomyFetchRequest,
  TaxonomyFetchResult,
  TaxonomySourceFetcherPort,
} from '../../../packages/modules/product_feeds/src/backend/services/taxonomy-source-fetcher.interface.js';

/**
 * Fixture taxonomies and a scriptable egress stub — feature 067 Phase 11.
 *
 * Every taxonomy-refresh test drives the module through this stub. **No test in
 * this repository may reach the network**: a test that really downloaded
 * Google's taxonomy would be a flake, a privacy leak and a dependency on CI
 * having outbound internet. The stub is the transport half of the same
 * precaution that points `taxonomyDataRoot` at a path which does not exist.
 */

/** Above the 500-node plausibility floor, so a fixture is a plausible taxonomy. */
export const PLAUSIBLE_NODE_COUNT = 600;

export interface GoogleFileOptions {
  /** Stamped as `# Google_Product_Taxonomy_Version:`; omitted ⇒ no header. */
  label?: string | null;
  count?: number;
  /** Renames every leaf, so the node SET differs without ids changing. */
  leafPrefix?: string;
  /** Node ids to leave out — how a revision "drops" a node. */
  omit?: ReadonlySet<string>;
  /** Appended verbatim, for the trailing-newline and CRLF cases. */
  trailer?: string;
}

export function googleTaxonomyFile(options: GoogleFileOptions = {}): string {
  const count = options.count ?? PLAUSIBLE_NODE_COUNT;
  const prefix = options.leafPrefix ?? 'Category';
  const lines: string[] = [];
  if (options.label !== null) {
    lines.push(`# Google_Product_Taxonomy_Version: ${options.label ?? '2026-05-14'}`);
  }
  lines.push('1 - Root');
  for (let index = 2; index <= count; index += 1) {
    if (options.omit?.has(String(index))) continue;
    lines.push(`${index} - Root > ${prefix} ${index}`);
  }
  return `${lines.join('\n')}\n${options.trailer ?? ''}`;
}

export function metaTaxonomyFile(options: { count?: number; leafPrefix?: string } = {}): string {
  const count = options.count ?? PLAUSIBLE_NODE_COUNT;
  const prefix = options.leafPrefix ?? 'category';
  const lines = ['category_id,category', '1,root'];
  for (let index = 2; index <= count; index += 1) {
    lines.push(`${index},root > ${prefix} ${index}`);
  }
  return `${lines.join('\n')}\n`;
}

export type ScriptedResponse =
  | { kind: 'body'; body: string; etag?: string | null }
  | { kind: 'result'; result: TaxonomyFetchResult };

/**
 * A fetcher whose answer per URL substring the test sets. Records every request
 * so a test can assert that **nothing** was contacted (SC-017).
 */
export class ScriptedTaxonomyFetcher implements TaxonomySourceFetcherPort {
  readonly requests: string[] = [];
  private script: Array<{ match: string; response: ScriptedResponse }> = [];
  private fallback: ScriptedResponse | null = null;

  reset(): void {
    this.requests.length = 0;
    this.script = [];
    this.fallback = null;
  }

  /** Answer any URL containing `match`. First registered rule wins. */
  on(match: string, response: ScriptedResponse): this {
    this.script.push({ match, response });
    return this;
  }

  /** Answer everything not matched above. */
  otherwise(response: ScriptedResponse): this {
    this.fallback = response;
    return this;
  }

  /** Serve one provider's two language files from the same body. */
  serve(providerMatch: string, body: string, etag?: string | null): this {
    return this.on(providerMatch, { kind: 'body', body, ...(etag !== undefined ? { etag } : {}) });
  }

  async fetchFile(request: TaxonomyFetchRequest): Promise<TaxonomyFetchResult> {
    this.requests.push(request.url);
    const rule = this.script.find((entry) => request.url.includes(entry.match));
    const response = rule?.response ?? this.fallback;
    if (!response) {
      return {
        ok: false,
        outcome: 'failed',
        reason: 'transport',
        detail: `No scripted response for ${request.url}.`,
        httpStatus: null,
        bytesRead: null,
      };
    }
    if (response.kind === 'result') return response.result;
    return {
      ok: true,
      body: response.body,
      bytesRead: Buffer.byteLength(response.body, 'utf8'),
      etag: response.etag ?? null,
      httpStatus: 200,
      notModified: false,
    };
  }
}
