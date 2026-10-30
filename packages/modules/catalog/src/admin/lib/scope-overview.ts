import type {
  PatchProductScopesRequest,
  ProductValueOverrideDelete,
  PutProductUrlKeysRequest,
  ScopeMissingValue,
  ScopeOverviewResponse,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';

/**
 * Feature 163 (US4, FR-015, FR-041; `contracts/admin-scopes-api.md` §3) — the pure half of
 * the product's scope overview: which owning endpoint a "reset to inherited" or an orphan
 * delete goes to, and the operator's words for a field.
 *
 * Field names are the overview's own (the owning write's spellings): `status`, `window`,
 * `audience`, `minOrderQuantity`, `returnable` (the scopes PATCH), `name`, `description`,
 * `attribute:<key>` (the value overrides) and `urlKey` (the URL keys). Phases 21–22 added
 * the media fields (`media:roles`, `media:hidden`, `media:altText`), the attachment and
 * packaging-unit fields and `seo:<field>`: a channel's gallery roles reset through the
 * channel-roles PUT; the item-level ones are edited on the Media, Attachments and
 * Inventory tabs (the overview names no item), so they have no reset here.
 */

export type ScopeOverview = ScopeOverviewResponse['data'];
export type ScopeOverviewCell = ScopeOverview['cells'][number];
export type ScopeOverviewOrphan = ScopeOverview['orphans'][number];
export type OverviewLevel = 'channel_language' | 'channel' | 'language';

const CHANNEL_FIELDS = ['status', 'window', 'audience', 'minOrderQuantity', 'returnable'] as const;
type ChannelField = (typeof CHANNEL_FIELDS)[number];

function isChannelField(field: string): field is ChannelField {
  return (CHANNEL_FIELDS as readonly string[]).includes(field);
}

/** `name`, `description` or `attribute:<key>` — a row of `product_value_overrides`. */
function overrideAttributeKey(field: string): string | null {
  if (field === 'name' || field === 'description') return field;
  if (field.startsWith('attribute:')) return field.slice('attribute:'.length);
  return null;
}

/** One request to the endpoint that owns the field. */
export type ScopeFieldRequest =
  | { kind: 'scopes'; body: PatchProductScopesRequest }
  | { kind: 'valueOverrides'; body: { upserts: []; deletes: ProductValueOverrideDelete[] } }
  | { kind: 'urlKeys'; body: PutProductUrlKeysRequest }
  | { kind: 'galleryRoles'; body: { channelId: string; roles: Record<string, string | null> } };

/** Every role of one channel back to the global holder. */
function clearGalleryRoles(channelId: string): ScopeFieldRequest {
  return { kind: 'galleryRoles', body: { channelId, roles: { baseImage: null, smallImage: null, thumbnail: null } } };
}

/**
 * "Reset to inherited" for one field at one level (US4 #2): the owning endpoint with
 * `null` for that field only. `null` when the level holds no override to remove — a
 * name, description or attribute at the **language** level is the product's own value
 * in that language, edited on the Details and Attributes tabs, not an override.
 */
export function resetRequestFor(input: {
  field: string;
  level: OverviewLevel;
  channelId: string;
  languageCode: string;
}): ScopeFieldRequest | null {
  const { field, level, channelId, languageCode } = input;
  if (isChannelField(field)) {
    if (level === 'channel') {
      return { kind: 'scopes', body: { channels: [{ channelId, [field]: { inherit: true } }] } };
    }
    if (level === 'channel_language' && field === 'status') {
      return {
        kind: 'scopes',
        body: { channels: [{ channelId, languageStatuses: [{ languageCode, status: { inherit: true } }] }] },
      };
    }
    return null;
  }
  const attributeKey = overrideAttributeKey(field);
  if (attributeKey !== null) {
    if (level === 'language') return null;
    return {
      kind: 'valueOverrides',
      body: {
        upserts: [],
        deletes: [{ attributeKey, channelId, languageCode: level === 'channel_language' ? languageCode : null }],
      },
    };
  }
  if (field === 'media:roles') return level === 'channel' ? clearGalleryRoles(channelId) : null;
  if (field === 'urlKey') {
    // A URL key has no channel-wide value: a channel row never holds one (C-7).
    if (level === 'channel') return null;
    if (level === 'channel_language') {
      return { kind: 'urlKeys', body: { channelKeys: [{ channelId, languageCode, key: { inherit: true } }] } };
    }
    // 168-shim: there is no Language key any more (FR-010); T132 drops this branch.
    return null;
  }
  return null;
}

/**
 * Owner decision UX-1 = A — a reset of a text value (a name, a description, a URL key, an
 * SEO field) loses words somebody wrote, so the overview asks first; a status, a window,
 * an audience, a minimum, roles … are one click.
 */
export function isTextField(field: string): boolean {
  return field === 'name' || field === 'description' || field === 'urlKey' || field.startsWith('seo:');
}

/**
 * Removing an override the resolution ignores (FR-015) — always allowed, whatever the
 * reason: a `null` passes every scope check of the owning write (T071a, T105a).
 */
export function orphanDeleteRequest(orphan: ScopeOverviewOrphan): ScopeFieldRequest | null {
  const { field, channelId, languageCode } = orphan;
  if (isChannelField(field)) {
    if (channelId === null) return null;
    if (field === 'status' && languageCode !== null) {
      return {
        kind: 'scopes',
        body: { channels: [{ channelId, languageStatuses: [{ languageCode, status: { inherit: true } }] }] },
      };
    }
    return { kind: 'scopes', body: { channels: [{ channelId, [field]: { inherit: true } }] } };
  }
  const attributeKey = overrideAttributeKey(field);
  if (attributeKey !== null) {
    if (channelId === null) return null;
    return { kind: 'valueOverrides', body: { upserts: [], deletes: [{ attributeKey, channelId, languageCode }] } };
  }
  if (field === 'media:roles' && channelId !== null) return clearGalleryRoles(channelId);
  if (field === 'urlKey' && channelId !== null) {
    return { kind: 'urlKeys', body: { channelKeys: [{ channelId, languageCode, key: { inherit: true } }] } };
  }
  return null;
}

/** Sends a {@link ScopeFieldRequest} to its owner. */
export async function sendScopeFieldRequest(productId: string, request: ScopeFieldRequest): Promise<void> {
  const base = `/api/v1/admin/catalog/products/${encodeURIComponent(productId)}`;
  if (request.kind === 'scopes') await apiClient.patch(`${base}/scopes`, request.body);
  else if (request.kind === 'valueOverrides') await apiClient.patch(`${base}/value-overrides`, request.body);
  else if (request.kind === 'galleryRoles') await apiClient.put(`${base}/gallery/channel-roles`, request.body);
  else await apiClient.put(`${base}/url-keys`, request.body);
}

/** `GET …/scope-overview`. */
export async function getScopeOverview(productId: string): Promise<ScopeOverview> {
  const res = await apiClient.get<ScopeOverviewResponse>(
    `/api/v1/admin/catalog/products/${encodeURIComponent(productId)}/scope-overview`,
  );
  return res.data;
}

/**
 * A multilingual name in the admin's language: an exact tag, then the same language
 * (`pl` ↔ `pl-PL`), then English, then whatever there is.
 */
export function pickLocalized(name: Record<string, string> | null | undefined, language: string): string {
  if (!name) return '';
  const entries = Object.entries(name).filter(([, value]) => typeof value === 'string' && value !== '');
  const base = language.toLowerCase().split('-')[0] ?? '';
  const exact = entries.find(([tag]) => tag.toLowerCase() === language.toLowerCase());
  if (exact) return exact[1];
  const sameLanguage = entries.find(([tag]) => tag.toLowerCase().split('-')[0] === base);
  if (sameLanguage) return sameLanguage[1];
  const english = entries.find(([tag]) => tag.toLowerCase().split('-')[0] === 'en');
  if (english) return english[1];
  return entries[0]?.[1] ?? '';
}

type Translate = (key: string, params?: Record<string, string>) => string;

/** The bundle key suffix of each media, attachment, packaging-unit and SEO field (Phases 21–22). */
const SCOPED_FIELD_KEYS: Readonly<Record<string, string>> = {
  'media:roles': 'mediaRoles',
  'media:hidden': 'mediaHidden',
  'media:altText': 'mediaAltText',
  'attachments:hidden': 'attachmentsHidden',
  'attachments:name': 'attachmentsName',
  'attachments:description': 'attachmentsDescription',
  'packagingUnits:name': 'packagingUnitsName',
  'seo:title': 'seoTitle',
  'seo:description': 'seoDescription',
  'seo:ogTitle': 'seoOgTitle',
  'seo:ogDescription': 'seoOgDescription',
  'seo:ogImageUrl': 'seoOgImageUrl',
};

/** A field of the overview in the operator's words; an attribute by its label when known. */
export function describeOverviewField(
  field: string,
  t: Translate,
  attributeLabel: (key: string) => string | null,
): string {
  if (field.startsWith('attribute:')) {
    const key = field.slice('attribute:'.length);
    return attributeLabel(key) ?? key;
  }
  if (isChannelField(field) || field === 'name' || field === 'description' || field === 'urlKey') {
    return t(`productEditor.scopeOverview.field.${field}`);
  }
  const scoped = SCOPED_FIELD_KEYS[field];
  if (scoped) return t(`productEditor.scopeOverview.field.${scoped}`);
  return field;
}

/** One FR-041 missing value, with the attribute's label where it is known. */
export function describeOverviewMissing(
  value: ScopeMissingValue,
  t: Translate,
  attributeLabel: (key: string) => string | null,
): string {
  return describeOverviewField(value, t, attributeLabel);
}
