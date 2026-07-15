import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { GallerySwitcher } from '../../components/GallerySwitcher';
import { toAbsoluteAssetUrl } from '../../lib/asset-url';

/**
 * T091 — SSR contract for GallerySwitcher (feature 002 US3).
 * Pure react-dom/server.renderToString — no JSDOM. Foundation pattern.
 *
 * Pins the label-aware ordering from spec.md US3:
 *   - Base Image is the primary main view on the PDP
 *   - Thumbnail is the listing's first-shown image (separate selector)
 *   - When Thumbnail/Base absent, fall back through the chain
 *   - Empty gallery → placeholder, no crash
 */

type GalleryItem = {
  id: string;
  position: number;
  labels: Array<'base_image' | 'small_image' | 'thumbnail'>;
  asset: { id: string; kind: string; url: string };
};

const item = (
  id: string,
  labels: GalleryItem['labels'],
  position = 0,
  url = `/asset/${id}.jpg`,
): GalleryItem => ({ id, position, labels, asset: { id: `a-${id}`, kind: 'image', url } });

const video = (
  id: string,
  labels: GalleryItem['labels'] = [],
  position = 0,
  url = `/asset/${id}.mp4`,
): GalleryItem => ({ id, position, labels, asset: { id: `a-${id}`, kind: 'video', url } });

describe('GallerySwitcher — SSR contract', () => {
  it('renders placeholder when gallery is empty', () => {
    const html = renderToString(<GallerySwitcher gallery={[]} alt="Widget" />);
    expect(html).toContain('aspect-square');
  });

  it('starts the carousel on the Base Image', () => {
    const html = renderToString(
      <GallerySwitcher
        gallery={[
          item('1', [], 0, '/asset/plain.jpg'),
          item('2', ['base_image'], 1, '/asset/base.jpg'),
          item('3', ['thumbnail'], 2, '/asset/thumb.jpg'),
        ]}
        alt="Widget"
      />,
    );
    // The active slide is exposed on the stage via data-active-src, and the
    // track is shifted to it (index 1 → -100%). Host-relative URLs are rebased
    // onto the public API origin, so assert the rebased form.
    expect(html).toContain(`data-active-src="${toAbsoluteAssetUrl('/asset/base.jpg')}"`);
    expect(html).toContain('translateX(-100%)');
  });

  it('falls back to the first item when no Base Image is set', () => {
    const html = renderToString(
      <GallerySwitcher
        gallery={[
          item('1', ['thumbnail'], 0, '/asset/thumb.jpg'),
          item('2', [], 1, '/asset/plain.jpg'),
        ]}
        alt="Widget"
      />,
    );
    expect(html).toContain(`data-active-src="${toAbsoluteAssetUrl('/asset/thumb.jpg')}"`);
    expect(html).toContain('translateX(-0%)');
  });

  it('marks the Small Image as highlighted in the thumbnail strip', () => {
    const html = renderToString(
      <GallerySwitcher
        gallery={[
          item('1', ['base_image'], 0, '/asset/base.jpg'),
          item('2', ['small_image'], 1, '/asset/small.jpg'),
          item('3', [], 2, '/asset/plain.jpg'),
        ]}
        alt="Widget"
      />,
    );
    expect(html.match(/data-small-image="true"/g)?.length ?? 0).toBe(1);
  });

  it('emits one thumbnail-strip entry per gallery item', () => {
    const html = renderToString(
      <GallerySwitcher
        gallery={[
          item('1', ['base_image'], 0),
          item('2', [], 1),
          item('3', [], 2),
        ]}
        alt="Widget"
      />,
    );
    const thumbs = html.match(/class="[^"]*h-\[72px\][^"]*"/g);
    expect(thumbs?.length ?? 0).toBe(3);
  });

  it('renders a video item in the main view with a <video> element', () => {
    const html = renderToString(
      <GallerySwitcher
        gallery={[video('1', ['base_image'], 0, '/asset/clip.mp4')]}
        alt="Widget"
      />,
    );
    expect(html).toContain('<video');
    expect(html).toContain(`src="${toAbsoluteAssetUrl('/asset/clip.mp4')}"`);
    // No zoom pill for video main views.
    expect(html).not.toContain('Powiększ');
  });

  it('shows the zoom pill for image main views', () => {
    const html = renderToString(
      <GallerySwitcher gallery={[item('1', ['base_image'], 0)]} alt="Widget" />,
    );
    expect(html).toContain('Powiększ');
  });
});
