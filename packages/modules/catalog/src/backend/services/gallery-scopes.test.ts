import { describe, expect, it } from 'vitest';
import { effectiveGallery, resolveGalleryScope, type GalleryScopeOverrides } from './gallery-scopes.js';

/**
 * Feature 163 (FR-076, data-model §7, R14) — the gallery in one sales channel: the
 * global items minus the ones hidden there; role R held by the channel's own holder,
 * else the global one — and by nobody when that holder is hidden there.
 */
const items = [
  { id: 'hero', labels: ['base_image' as const, 'thumbnail' as const] },
  { id: 'side', labels: ['small_image' as const] },
  { id: 'life', labels: [] },
];

function overrides(partial: Partial<GalleryScopeOverrides> = {}): GalleryScopeOverrides {
  return { roles: new Map(), hidden: new Set(), altText: new Map(), ...partial };
}

describe('effectiveGallery', () => {
  it('is the global gallery when the channel has no override (off state)', () => {
    expect(effectiveGallery(items, undefined)).toEqual(items);
    expect(effectiveGallery(items, overrides())).toEqual(items);
  });

  it("moves a role to the channel's own holder, taking it off the global one (US9 #1)", () => {
    const gallery = effectiveGallery(items, overrides({ roles: new Map([['base_image', 'life']]) }));
    expect(gallery).toEqual([
      { id: 'hero', labels: ['thumbnail'] },
      { id: 'side', labels: ['small_image'] },
      { id: 'life', labels: ['base_image'] },
    ]);
  });

  it('drops a hidden item, and the roles it held resolve to none (US9 #2)', () => {
    const gallery = effectiveGallery(items, overrides({ hidden: new Set(['hero']) }));
    expect(gallery).toEqual([
      { id: 'side', labels: ['small_image'] },
      { id: 'life', labels: [] },
    ]);
  });

  it('leaves a role with no holder when the channel names a hidden item for it', () => {
    const gallery = effectiveGallery(
      items,
      overrides({ roles: new Map([['small_image', 'life']]), hidden: new Set(['life']) }),
    );
    expect(gallery.flatMap((item) => item.labels)).toEqual(['base_image', 'thumbnail']);
  });

  it('ignores a channel holder that is not one of the items: the global holder applies', () => {
    const gallery = effectiveGallery(items, overrides({ roles: new Map([['base_image', 'gone']]) }));
    expect(gallery.find((item) => item.id === 'hero')?.labels).toEqual(['base_image', 'thumbnail']);
  });

  it('keeps the items in their global order and carries their other fields', () => {
    const rich = [
      { id: 'a', labels: [], position: 0, assetId: 'x' },
      { id: 'b', labels: [], position: 1, assetId: 'y' },
    ];
    expect(effectiveGallery(rich, overrides()).map((item) => item.assetId)).toEqual(['x', 'y']);
  });

  it('an empty role override (no image) takes the role off every item (feature 170, data-model §6b)', () => {
    const gallery = effectiveGallery(items, overrides({ roles: new Map([['base_image', null]]) }));
    expect(gallery.find((item) => item.id === 'hero')?.labels).toEqual(['thumbnail']);
  });
});

describe('resolveGalleryScope (feature 170, C\u00d7L \u2192 C \u2192 G)', () => {
  const C = 'c1';
  const stored = [
    { id: 'hero', hidden: false },
    { id: 'side', hidden: true },
    { id: 'life', hidden: false },
  ];
  const row = (galleryItemId: string, field: string, languageCode: string | null, v: unknown) => ({
    galleryItemId,
    channelId: C,
    languageCode,
    field,
    value: { v },
  });
  const itemRows = [
    row('hero', 'hidden', 'pl-PL', true),
    row('side', 'hidden', null, false),
    row('life', 'alt_text', null, 'Channel alt'),
    row('life', 'alt_text', 'pl-PL', null),
    row('hero', 'alt_text', 'pl-PL', 'Polish alt'),
  ];
  const roleRows = [
    { label: 'base_image' as const, channelId: C, languageCode: null, galleryItemId: 'life' },
    { label: 'thumbnail' as const, channelId: C, languageCode: 'pl-PL', galleryItemId: null },
  ];

  it('at Global, only the Global hidden flag applies', () => {
    const out = resolveGalleryScope({ items: stored, itemRows, roleRows, scope: { channelId: null, languageCode: null } });
    expect([...out.hidden]).toEqual(['side']);
    expect(out.roles.size).toBe(0);
    expect(out.altText.size).toBe(0);
  });

  it('at C, the Channel rows override the Global hidden flag, alt text and roles', () => {
    const out = resolveGalleryScope({ items: stored, itemRows, roleRows, scope: { channelId: C, languageCode: null } });
    expect([...out.hidden]).toEqual([]);
    expect(out.altText).toEqual(new Map([['life', 'Channel alt']]));
    expect(out.roles).toEqual(new Map([['base_image', 'life']]));
  });

  it("at C\u00d7L, the pair's rows win, an empty alt override is '' and an empty role holds nothing", () => {
    const out = resolveGalleryScope({ items: stored, itemRows, roleRows, scope: { channelId: C, languageCode: 'pl-pl' } });
    expect([...out.hidden]).toEqual(['hero']);
    expect(out.altText).toEqual(new Map([['life', ''], ['hero', 'Polish alt']]));
    expect(out.roles).toEqual(new Map([['base_image', 'life'], ['thumbnail', null]]));
  });

  it('rows of another language never apply', () => {
    const out = resolveGalleryScope({ items: stored, itemRows, roleRows, scope: { channelId: C, languageCode: 'en-US' } });
    expect([...out.hidden]).toEqual([]);
    expect(out.altText).toEqual(new Map([['life', 'Channel alt']]));
  });
});
