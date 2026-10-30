// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { BlockRenderEnvironmentProvider } from '@endora-commerce/page-builder-core/contributions';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R20E (T301–T303) — `cms.DownloadTile`
 * extended (plan § *Extend, don't narrow*: unset is today's tile):
 *
 * - T301: a minimum height per breakpoint (today's 180 px);
 * - T302: the subtitle's size per breakpoint and its colour (today's 14 px muted);
 * - T303: the tile may link to a page, a product, a URL… (the shared link)
 *   instead of a file — the same card, no file badge, no `download` attribute,
 *   the icon button still pinned to the bottom end.
 *
 * R23 (T444): the minimum height is one value (a stored per-breakpoint one
 * reads as its desktop value, else its base); the subtitle's size and colour
 * (T302) were removed — it keeps today's 14 px muted text.
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.DownloadTile'] as ComponentConfig;
const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
const FILE = '9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a';
const BASE = { title: 'Catalogue', subtitle: 'Product range', fileAssetId: FILE, linkLabel: 'Download' };

function html(props: Record<string, unknown> = {}, preview = false): string {
  const content = [{ type: 'cms.DownloadTile', props: { ...defaults, id: 'download-1', ...BASE, ...props } }] as Data['content'];
  return renderToString(
    <BlockRenderEnvironmentProvider value={{ language: 'en', preview }}>
      <CmsRenderProvider
        embeds={{ blocks: {}, templates: {} }}
        assets={{ [FILE]: { url: '/assets/file/terms.pdf', mimeType: 'application/pdf', filename: 'terms.pdf' } }}
        mediaBaseUrl="https://api.example.com"
      >
        <Render config={config} data={{ root: { props: {} }, content }} />
      </CmsRenderProvider>
    </BlockRenderEnvironmentProvider>,
  );
}

function host(props: Record<string, unknown> = {}, preview = false): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html(props, preview);
  return element;
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

async function keys(props: Record<string, unknown>): Promise<string[]> {
  const fields = block.fields as Fields;
  const resolved = await block.resolveFields!(
    { props: { ...defaults, ...BASE, ...props } } as never,
    { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
  );
  return Object.keys(resolved);
}

describe('cms.DownloadTile minimum height and subtitle (T301, T302)', () => {
  it('unset (and the file link at its default) renders today’s tile', () => {
    expect(html({ linkTo: 'file', subtitleColor: '' })).toBe(html());
  });

  it('one minimum height for every breakpoint; a stored per-breakpoint one reads as its desktop value', () => {
    expect(host({ minHeightPx: 320 }).querySelector('a')!.getAttribute('style')).toBe('--pb-dl-min-h:320px');
    expect(host({ minHeightPx: { base: 320, desktop: 400 } }).querySelector('a')!.getAttribute('style')).toBe('--pb-dl-min-h:400px');
    const css = sheet();
    expect(css).toContain('min-height: var(--pb-dl-min-h, 180px);');
  });

  it('a stored subtitle size and colour are ignored: today’s 14 px muted subtitle', () => {
    expect(host({ subtitleSizePx: { base: 14, tablet: 16 }, subtitleColor: '#ffffff' }).querySelector('a')!.hasAttribute('style')).toBe(false);
    expect(sheet()).toContain('.cmsc-pb-download-tile__subtitle { color: var(--cmsb-fg-muted, #64748b); font-size: 0.875rem; }');
  });
});

describe('cms.DownloadTile linking to a page or URL (T303)', () => {
  it('one link to the page: no download attribute, no file badge, the icon button pinned', () => {
    const tile = host({ linkTo: 'link', link: { kind: 'url', href: 'https://example.com/terms' }, linkLook: 'icon', fileAssetId: '' });
    const anchors = tile.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    const anchor = anchors[0]!;
    expect(anchor.getAttribute('href')).toBe('https://example.com/terms');
    expect(anchor.hasAttribute('download')).toBe(false);
    expect(anchor.className).toContain('cmsc-pb-download-tile--page-link');
    expect(tile.querySelector('.cmsc-pb-download-tile__type')).toBeNull();
    expect(tile.querySelector('.cmsc-pb-download-tile__icon-button svg')).not.toBeNull();
    expect(anchor.textContent).toContain('Catalogue');
  });

  it('a link that resolves to nothing: nothing for customers, a warning in the preview', () => {
    expect(host({ linkTo: 'link', link: undefined }).querySelector('a, [role="note"]')).toBeNull();
    expect(host({ linkTo: 'link', link: undefined }, true).querySelector('[role="note"]')?.textContent).toContain('Choose a link');
  });

  it('offers the link with the link target, the file without it', async () => {
    const file = await keys({});
    expect(file).toEqual(expect.arrayContaining(['linkTo', 'fileAssetId', 'minHeightPx']));
    expect(file).not.toContain('subtitleSizePx');
    expect(file).not.toContain('subtitleColor');
    expect(file).not.toContain('link');
    const page = await keys({ linkTo: 'link' });
    expect(page).toContain('link');
    expect(page).not.toContain('fileAssetId');
  });
});

/**
 * `specs/169-page-builder-contact-form/` US4, FR-008, FR-009 (T013, T014) — the
 * round icon button's size preset (S today's 48 px, M 72 px, L 112 px) and its
 * style (today's outline, or a filled disc with the glyph in the card's
 * background). No px, no colour (R23); both shown with the icon look only.
 */
describe('cms.DownloadTile icon button size and style (feature 169, T013, T014)', () => {
  // Whole class tokens: `--icon-l` is a prefix of today's `--icon-link`.
  const tileClass = (props: Record<string, unknown>): string[] => [...host({ linkLook: 'icon', ...props }).querySelector('a')!.classList];

  it('a size and the filled style are classes on the tile', () => {
    expect(tileClass({ iconButtonSize: 'l' })).toContain('cmsc-pb-download-tile--icon-l');
    expect(tileClass({ iconButtonSize: 'm' })).toContain('cmsc-pb-download-tile--icon-m');
    expect(tileClass({ iconButtonStyle: 'filled' })).toContain('cmsc-pb-download-tile--icon-filled');
  });

  it('unset, outline or an unknown value add nothing: a stored tile renders byte-identically', () => {
    const today = html({ linkLook: 'icon' });
    for (const props of [{ iconButtonStyle: 'outline' }, { iconButtonStyle: 'nope' }, { iconButtonSize: 'xl' }, { iconButtonSize: 48 }]) {
      expect(html({ linkLook: 'icon', ...props }), JSON.stringify(props)).toBe(today);
    }
    // With the text label the options do not apply.
    expect(html({ iconButtonSize: 'l', iconButtonStyle: 'filled' })).toBe(html());
  });

  it('both fields are shown with the icon look only, right after the icon, as the cached field objects', async () => {
    const shown = await keys({ linkLook: 'icon' });
    const at = shown.indexOf('iconButtonIcon');
    expect(shown.slice(at, at + 3)).toEqual(['iconButtonIcon', 'iconButtonSize', 'iconButtonStyle']);
    expect(await keys({ linkLook: 'label' })).not.toContain('iconButtonSize');
    expect(await keys({})).not.toContain('iconButtonStyle');
    const fields = block.fields as Record<string, { type?: string; options?: Array<{ label: string; value: unknown }> }>;
    expect(fields['iconButtonSize']?.options?.map((option) => option.value)).toEqual(['s', 'm', 'l']);
    expect(fields['iconButtonStyle']?.options?.map((option) => option.value)).toEqual(['outline', 'filled']);
    const resolved = (await block.resolveFields!(
      { props: { ...defaults, ...BASE, linkLook: 'icon' } } as never,
      { fields: block.fields, lastFields: block.fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
    )) as Record<string, unknown>;
    expect(resolved['iconButtonSize']).toBe(fields['iconButtonSize']);
    expect(resolved['iconButtonStyle']).toBe(fields['iconButtonStyle']);
    for (const key of ['iconButtonSize', 'iconButtonStyle']) expect(defaults, key).not.toHaveProperty(key);
  });

  it('the stylesheet: 48, 72 and 112 px discs; filled is the text colour with the glyph in the card background', () => {
    const css = sheet();
    expect(css).toContain('.cmsc-pb-download-tile--icon-s .cmsc-pb-download-tile__icon-button { width: 48px; height: 48px; }');
    expect(css).toContain('.cmsc-pb-download-tile--icon-m .cmsc-pb-download-tile__icon-button { width: 72px; height: 72px; }');
    expect(css).toContain('.cmsc-pb-download-tile--icon-l .cmsc-pb-download-tile__icon-button { width: 112px; height: 112px; }');
    const filled = /\.cmsc-pb-download-tile--icon-filled \.cmsc-pb-download-tile__icon-button \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(filled).toContain('background: currentColor;');
    expect(css).toContain('.cmsc-pb-download-tile--icon-filled .cmsc-pb-download-tile__icon { color: var(--pb-dl-bg, var(--cmsb-bg, #fff)); }');
    // After the base icon button rules, which they override.
    expect(css.indexOf('.cmsc-pb-download-tile--icon-l .cmsc-pb-download-tile__icon-button')).toBeGreaterThan(css.indexOf('.cmsc-pb-download-tile__icon {'));
  });
});
