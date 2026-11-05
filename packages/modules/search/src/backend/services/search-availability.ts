import type { ChannelAvailability, ProductAudience } from '@endora-commerce/contracts';

/**
 * Feature 163 (`specs/163-product-data-scopes/research.md` R8, data-model §11) —
 * availability in a channel index.
 *
 * One index per channel and one document per product stay. A document is
 * indexed for every channel member that is effectively on in **at least one**
 * channel language, and carries what a query needs to narrow the hit list the
 * page is cut from (issue #151): the languages it is on in, its effective
 * publication window, and its channel-effective audience rule. The window is
 * evaluated at query time, so it is exact without a reindex (SC-005).
 *
 * The audience fields are filter inputs only: the query names the attributes
 * it retrieves (`attributesToRetrieve`), and the allow-list is not among them,
 * so no response carries it. Hydration re-asks `catalog` for every hit
 * (`filterAvailable`), so a stale document cannot decide a disclosure either.
 */

/** "No lower bound" — every instant is after it. */
export const OPEN_FROM_MS = 0;
/** "No upper bound" — every instant is before it. */
export const OPEN_UNTIL_MS = Number.MAX_SAFE_INTEGER;

/** The availability fields of an `IndexedDocument`. */
export interface DocumentAvailabilityFields {
  /** Channel languages where the product is effectively on. */
  liveLanguages: string[];
  /** Effective window start, epoch ms; {@link OPEN_FROM_MS} when open. */
  publishFromMs: number;
  /** Effective window end, epoch ms; {@link OPEN_UNTIL_MS} when open. */
  publishUntilMs: number;
  /** Channel-effective visibility. */
  visibility: string;
  /** Channel-effective allow-list — a filter input, never retrieved. */
  allowedOrganizationIds: string[];
}

/** The filterable attributes the fields above add to a channel index. */
export const AVAILABILITY_FILTERABLE_ATTRIBUTES = [
  'liveLanguages',
  'publishFromMs',
  'publishUntilMs',
  'visibility',
  'allowedOrganizationIds',
] as const;

/**
 * The settings a channel index still needs for this release's queries (code
 * review W1): the filterable set when any availability field is missing from
 * it — every query names them, and a refused filter sends the whole listing to
 * Postgres. `{}` when the index is up to date, so a boot leaves it alone: a
 * settings update re-indexes the corpus it lands on. Meilisearch's default
 * searchable list `['*']` searches every field.
 *
 * Feature 174 (`contracts/search-index.md` §2) — an index whose searchable set lacks `texts` was
 * built before the language-keyed documents, so its documents carry no `texts` and a settings
 * push cannot fix it: `{ reindex: true }`, and the boot check reindexes the channel (which writes
 * every setting). Until then a query falls back to searching without `attributesToSearchOn`.
 */
export function pendingAvailabilitySettings(
  current: { filterable: readonly string[]; searchable: readonly string[] },
  wanted: { filterable: string[]; searchable: string[] },
): { filterable?: string[]; reindex?: true } {
  if (!current.searchable.includes('*') && !current.searchable.includes('texts')) return { reindex: true };
  const out: { filterable?: string[] } = {};
  if (AVAILABILITY_FILTERABLE_ATTRIBUTES.some((field) => !current.filterable.includes(field))) {
    out.filterable = wanted.filterable;
  }
  return out;
}

export function documentAvailabilityFields(availability: ChannelAvailability): DocumentAvailabilityFields {
  return {
    liveLanguages: [...availability.liveLanguages],
    publishFromMs: availability.window.from?.getTime() ?? OPEN_FROM_MS,
    publishUntilMs: availability.window.until?.getTime() ?? OPEN_UNTIL_MS,
    visibility: availability.audience.visibility,
    allowedOrganizationIds: [...availability.audience.allowedOrganizationIds],
  };
}

function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The index filter of FR-001 at (the index's channel, `languageCode`) for
 * `audience` at `nowMs` — `isProductEffectivelyAvailable` restated over the
 * document's fields (membership is the index itself). A document indexed before
 * the deploy carries none of the fields and is served as it was (R8): it was
 * indexed because it was globally `active`, and hydration still asks `catalog`.
 *
 * The audience branch follows `isProductVisibleTo`: a non-empty allow-list
 * decides on its own; otherwise `organization_restricted` is refused, and
 * `logged_in_only` needs a signed-in caller.
 */
export function availabilityFilter(input: {
  languageCode: string;
  audience: ProductAudience;
  nowMs: number;
}): string {
  const { audience } = input;
  const noList = '(allowedOrganizationIds NOT EXISTS OR allowedOrganizationIds IS EMPTY)';
  const unrestricted =
    `visibility != ${quoted('organization_restricted')}` +
    (audience.authenticated ? '' : ` AND visibility != ${quoted('logged_in_only')}`);
  const audienceClause =
    audience.organizationId !== null
      ? `(allowedOrganizationIds = ${quoted(audience.organizationId)} OR (${noList} AND ${unrestricted}))`
      : `(${noList} AND ${unrestricted})`;
  return (
    `(liveLanguages = ${quoted(input.languageCode)} OR liveLanguages NOT EXISTS)` +
    ` AND (publishFromMs NOT EXISTS OR publishFromMs <= ${input.nowMs})` +
    ` AND (publishUntilMs NOT EXISTS OR publishUntilMs >= ${input.nowMs})` +
    ` AND ${audienceClause}`
  );
}
