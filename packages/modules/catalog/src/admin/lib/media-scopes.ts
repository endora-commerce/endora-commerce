/**
 * 168-shim — 163's channel-roles shape, kept for this editor until S3 rewrites the gallery on the
 * scoped-values save (`galleryRole:<label>`); the backend route it called is retired.
 */
export interface GalleryChannelRoles {
  channelId: string;
  roles: { baseImage: string | null; smallImage: string | null; thumbnail: string | null };
}
import type { ScopeContext } from '../components/ProductScopeEditor.js';

/**
 * Feature 163 (US9, FR-076 to FR-079) — the pure half of the product editor's media,
 * attachment and packaging-unit scope editing: which languages to offer, what a
 * per-language map patch carries, and the hidden-channel sets.
 */

/** A per-language map as the admin DTOs carry it (`altText`, `nameTranslations`, …). */
export type TranslationMap = Record<string, string>;

/**
 * The languages to offer: the member channels' languages plus every language the maps
 * already name, so a value in a language no channel speaks any more stays reachable
 * (and removable). Sorted, so the order is stable.
 */
export function languagesToOffer(
  context: Pick<ScopeContext, 'languagesUnion'> | null,
  ...maps: ReadonlyArray<TranslationMap | undefined>
): string[] {
  const union = Array.isArray(context?.languagesUnion) ? context.languagesUnion : [];
  const named = maps.flatMap((m) => Object.keys(m ?? {}));
  return [...new Set([...union, ...named])].sort();
}

/**
 * The patch a translation-map write takes (`translationMapPatchSchema`): a changed or new
 * language with its text, a cleared one as `''`, an untouched one absent. `null` when
 * nothing changed. The draft is trimmed; whitespace alone counts as cleared.
 */
export function translationPatch(saved: TranslationMap | undefined, draft: TranslationMap): TranslationMap | null {
  const before = saved ?? {};
  const patch: TranslationMap = {};
  for (const language of new Set([...Object.keys(before), ...Object.keys(draft)])) {
    const was = before[language] ?? '';
    const now = (draft[language] ?? was).trim();
    if (now !== was) patch[language] = now;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The set with one channel added or removed, sorted — every other id is kept as it is. */
export function withChannelHidden(set: readonly string[], channelId: string, hidden: boolean): string[] {
  const next = new Set(set);
  if (hidden) next.add(channelId);
  else next.delete(channelId);
  return [...next].sort();
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((id) => left.has(id));
}

/** The gallery label spelling → the channel-roles API key (`check:naming` keeps API keys camelCase). */
export const ROLE_KEYS = {
  base_image: 'baseImage',
  small_image: 'smallImage',
  thumbnail: 'thumbnail',
} as const;

export type GalleryRoleLabel = keyof typeof ROLE_KEYS;
export type GalleryRoleKey = (typeof ROLE_KEYS)[GalleryRoleLabel];
export type ChannelRoles = GalleryChannelRoles['roles'];

export const NO_CHANNEL_ROLES: ChannelRoles = { baseImage: null, smallImage: null, thumbnail: null };

/** The `roles` of a `PUT …/gallery/channel-roles`: changed roles only; `null` = use inherited. */
export function channelRolesChanges(
  saved: ChannelRoles,
  draft: ChannelRoles,
): Partial<Record<GalleryRoleKey, string | null>> | null {
  const changes: Partial<Record<GalleryRoleKey, string | null>> = {};
  for (const key of Object.values(ROLE_KEYS)) {
    if (saved[key] !== draft[key]) changes[key] = draft[key];
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/** A channel's name from the member channels; a channel the product has left gets `fallback`. */
export function channelNameIn(context: ScopeContext | null, channelId: string, fallback: string): string {
  return context?.channels.find((c) => c.id === channelId)?.name ?? fallback;
}

/** The member channels, or none when the read did not answer with them. */
export function memberChannels(context: ScopeContext | null): ScopeContext['channels'] {
  return Array.isArray(context?.channels) ? context.channels : [];
}
