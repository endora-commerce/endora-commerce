import type { ComponentConfig, Fields } from '@puckeditor/core';
import { describe, expect, it } from 'vitest';
import { PB_RESPONSIVE_METADATA } from '@endora-commerce/page-builder-core';
import { Row } from './Row.js';

/**
 * `specs/163-page-builder-marketing-pages/` plan § *Extend, don't narrow*
 * (binding), standing rule 14 — **a reshaped block keeps a superset of its
 * options on `origin/master`.**
 *
 * One case per reshaped or removed block. Each records the block's fields on
 * `origin/master` **as literals**, read with `git show origin/master:<file>`,
 * and maps every one of them to the place it lives after the reshape. A field
 * with no counterpart fails the case. A case is written before its reshape
 * (RED) and is never weakened to pass.
 *
 * A counterpart is checked twice: it must be a field the editor offers in the
 * position it applies to (top level, `parent: null`, or nested), and where the
 * value moves, the mapping must carry every value the old field could hold.
 */

/**
 * R17 (T213, T219, deliberately changed, standing rule 13): several settings are
 * offered only where they apply — the autoplay interval with autoplay on, the
 * disabled-arrow look on a carousel that stops at its ends, a caption's look
 * with a caption, the image side with an image, the row's content position
 * with a minimum height. An option is still *offered*, so each block is read
 * with the props under which every one of its settings applies; a case's own
 * props win over these.
 */
const APPLIES: Record<string, Record<string, unknown>> = {
  Row: { minHeight: 200 },
  Carousel: { autoplay: true, loop: false, controls: { arrows: true, dots: true, disabledArrowLook: 'color' } },
  'Product slider': { autoplay: true, loop: false, controls: { arrows: true, dots: true, disabledArrowLook: 'color' } },
  'Latest posts': { autoplay: true, loop: false, controls: { arrows: true, dots: true, disabledArrowLook: 'color' } },
  'Carousel image': { caption: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Caption' }] }] } },
  'Call-to-action card': { image: { imageSource: 'url', src: '/a.jpg' } },
};

/** The fields Puck shows for a block placed at the top level (`parent: null`) or nested. */
async function fieldsAt(config: ComponentConfig, position: 'top' | 'nested', props: Record<string, unknown> = {}): Promise<Fields> {
  const fields = config.fields as Fields;
  if (!config.resolveFields) return fields;
  const parent = position === 'top' ? null : { type: 'cms.Column', props: { id: 'column-1' } };
  const applies = APPLIES[String(config.label ?? '')] ?? {};
  return config.resolveFields(
    { props: { id: 'block-1', ...(config.defaultProps ?? {}), ...applies, ...props } } as never,
    { parent, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
  );
}

// ── cms.Row ──────────────────────────────────────────────────────────

/**
 * `ROW_FIELDS` of `packages/cms-components/src/components/Row.tsx` on
 * `origin/master` (b816c1d55, 2026-10-22), with the option values of the
 * select fields. `hideOn` and `editorName` are injected by `withHideOn` and
 * not the block's own.
 */
const ROW_ON_ORIGIN = {
  content: null,
  sectionLayout: ['in_flow', 'full_width', 'full_viewport', 'full_bleed'],
  contentMaxWidth: ['none', 'narrow', 'wide', 'custom'],
  customMaxWidthPx: null,
  contentPosition: ['top', 'middle', 'bottom'],
  minHeight: null,
  gap: null,
  rowGap: null,
  verticalAlign: ['top', 'middle', 'bottom', 'stretch'],
  margin: null,
  padding: null,
  border: null,
  background: null,
  cornerRadius: null,
  shadow: null,
  columnDivider: null,
  reverseOnMobile: null,
  overflow: null,
} as const;

describe('option parity — cms.Row, back to its origin/master shape (T034, then T112)', () => {
  // Plan § Owner ruling 2026-10-23: the section settings moved to `cms.Section`,
  // and the row is again what it is on origin/master — every field maps to
  // itself, at the top level and nested, with the same options.
  const row = Row as unknown as ComponentConfig;

  it('offers every field the Row has on origin/master, as itself, with the same options, at both levels', async () => {
    for (const position of ['top', 'nested'] as const) {
      // `customMaxWidthPx` is shown with `contentMaxWidth: 'custom'`, as on origin.
      const fields = await fieldsAt(row, position, { contentMaxWidth: 'custom' });
      for (const [field, options] of Object.entries(ROW_ON_ORIGIN)) {
        expect(Object.keys(fields), `${field} (${position})`).toContain(field);
        if (options !== null) expect(optionValues(fields[field]), `${field} options (${position})`).toEqual([...options]);
      }
    }
  });

  it('carries no section settings at either level', async () => {
    expect(Object.keys(await fieldsAt(row, 'top'))).not.toContain('section');
    expect(Object.keys(await fieldsAt(row, 'nested'))).not.toContain('section');
    expect(Object.keys(row.defaultProps ?? {})).not.toContain('section');
  });
});

// ── cms.Heading ──────────────────────────────────────────────────────

/**
 * The fields of `cms.Heading` on `origin/master` (b816c1d55, 2026-10-22):
 * `level` and `text`, the shared `TEXT_TYPOGRAPHY_FIELDS` of
 * `fields/shared-fields.ts` and the box fields, with the option values of the
 * select fields. `fontSize`, `fontWeight`, `textAlign` and `lineHeight` are
 * responsive there.
 */
const HEADING_ON_ORIGIN = {
  level: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  text: null,
  fontFamily: ['sans', 'serif', 'mono'],
  fontStyle: ['normal', 'italic'],
  color: null,
  fontSize: null,
  fontWeight: [300, 400, 500, 600, 700, 800],
  textAlign: ['left', 'center', 'right'],
  lineHeight: null,
  margin: null,
  padding: null,
  border: null,
} as const;

/**
 * Where each of today's Heading fields lives after the reshape
 * (contracts/blocks.md `cms.Heading`). Font, size, weight, style and line
 * height are the **Custom** overrides of the type tokens: `font: 'custom'`
 * reveals the literal family, `size: 'custom'` the literal px size.
 */
const HEADING_PARITY: Record<keyof typeof HEADING_ON_ORIGIN, string> = {
  level: 'level',
  text: 'text',
  fontFamily: 'font+fontFamily',
  fontStyle: 'fontStyle',
  color: 'color',
  fontSize: 'size+fontSize',
  fontWeight: 'fontWeight',
  textAlign: 'align',
  lineHeight: 'lineHeight',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

function optionValues(field: unknown): unknown[] {
  // R17 (T204, deliberately changed, standing rule 13): a Yes/No radio became a switch, which
  // stores the same two values and lists no options; it offers `true` and `false`.
  if ((field as { metadata?: { pageBuilder?: { toggle?: unknown } } } | undefined)?.metadata?.pageBuilder?.toggle === true) return [true, false];
  return ((field as { options?: { value: unknown }[] }).options ?? []).map((option) => option.value);
}

describe('option parity — cms.Heading (T038)', () => {
  it('maps every field the Heading has on origin/master', () => {
    expect(Object.keys(HEADING_PARITY).sort()).toEqual(Object.keys(HEADING_ON_ORIGIN).sort());
  });

  it('offers each counterpart, the Custom literals included', async () => {
    const heading = (await import('./Heading.js')).Heading as unknown as ComponentConfig;
    // The literal family and size are shown once "Custom" is chosen, as `customMaxWidthPx` is on the Row.
    const fields = await fieldsAt(heading, 'nested', { font: 'custom', size: 'custom' });
    for (const [field, target] of Object.entries(HEADING_PARITY)) {
      for (const key of target.split('+')) {
        expect(Object.keys(fields), `${field} → ${key}`).toContain(key);
      }
    }
  });

  it('keeps every option value of today\'s select fields', async () => {
    const heading = (await import('./Heading.js')).Heading as unknown as ComponentConfig;
    const fields = await fieldsAt(heading, 'nested', { font: 'custom', size: 'custom' });
    expect(optionValues(fields['level'])).toEqual(expect.arrayContaining([...HEADING_ON_ORIGIN.level]));
    expect(optionValues(fields['fontFamily'])).toEqual(expect.arrayContaining([...HEADING_ON_ORIGIN.fontFamily]));
    expect(optionValues(fields['fontStyle'])).toEqual(expect.arrayContaining([...HEADING_ON_ORIGIN.fontStyle]));
    expect(optionValues(fields['fontWeight'])).toEqual(expect.arrayContaining([...HEADING_ON_ORIGIN.fontWeight]));
    expect(optionValues(fields['font'])).toEqual(expect.arrayContaining(['heading', 'body', 'custom']));
    expect(optionValues(fields['size'])).toEqual(expect.arrayContaining(['display', 'h1', 'h2', 'h6', 'lead', 'body', 'small', 'custom']));
    expect(optionValues(fields['align'])).toEqual(['start', 'center', 'end']);
    // Responsive as today: size, weight, alignment and line height.
    for (const key of ['size', 'fontSize', 'fontWeight', 'align', 'lineHeight']) {
      expect((fields[key] as { metadata?: unknown }).metadata, `${key} is responsive`).toEqual(PB_RESPONSIVE_METADATA);
    }
  });

  it('carries a heading stored on origin/master into the new shape, value for value', async () => {
    const { headingFromLegacy } = await import('./Heading.js');
    const legacy = {
      level: 'h3',
      text: 'Plain heading',
      fontFamily: 'serif',
      fontStyle: 'italic',
      color: '#1d4ed8',
      fontSize: { base: 28, desktop: 44 },
      fontWeight: { base: 600, desktop: 800 },
      textAlign: { base: 'left', tablet: 'center', desktop: 'right' },
      lineHeight: 1.3,
    };
    expect(headingFromLegacy(legacy)).toMatchObject({
      level: 'h3',
      text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain heading' }] }] },
      font: 'custom',
      fontFamily: 'serif',
      fontStyle: 'italic',
      color: '#1d4ed8',
      size: 'custom',
      fontSize: { base: 28, desktop: 44 },
      fontWeight: { base: 600, desktop: 800 },
      align: { base: 'start', tablet: 'center', desktop: 'end' },
      lineHeight: 1.3,
    });
    // A heading with no size of its own keeps its level's size; the deprecated `align` still reads.
    expect(headingFromLegacy({ level: 'h4', text: 'x', align: 'center' })).toMatchObject({ size: 'h4', align: 'center' });
    // A legacy numeric level (`2`) reads as before.
    expect(headingFromLegacy({ level: 2, text: 'x' })).toMatchObject({ level: 'h2', size: 'h2' });
  });
});

// ── cms.Button ───────────────────────────────────────────────────────

/**
 * `BUTTON_FIELDS` of `packages/cms-components/src/components/Button.tsx` on
 * `origin/master` (b816c1d55, 2026-10-22). `variant` is responsive there.
 */
const BUTTON_ON_ORIGIN = {
  label: null,
  linkType: ['url', 'product', 'category', 'page'],
  linkSlug: null,
  href: null,
  target: ['_self', '_blank'],
  variant: ['primary', 'secondary', 'ghost'],
  backgroundColor: null,
  textColor: null,
  margin: null,
  padding: null,
  border: null,
} as const;

/** Where each of today's Button fields lives: `button.<key>` is a property of the `ButtonSpec`. */
const BUTTON_PARITY: Record<keyof typeof BUTTON_ON_ORIGIN, string> = {
  label: 'button.label',
  linkType: 'button.link',
  linkSlug: 'button.link',
  href: 'button.link',
  target: 'button.link',
  variant: 'button.style+button.fill',
  backgroundColor: 'button.backgroundColor',
  textColor: 'button.textColor',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

describe('option parity — cms.Button (T038)', () => {
  it('maps every field the Button has on origin/master', () => {
    expect(Object.keys(BUTTON_PARITY).sort()).toEqual(Object.keys(BUTTON_ON_ORIGIN).sort());
  });

  it('offers each counterpart, with a responsive style and fill', async () => {
    const button = (await import('./Button.js')).Button as unknown as ComponentConfig;
    const fields = await fieldsAt(button, 'nested');
    const spec = fields['button'] as { type: string; objectFields?: Fields };
    expect(spec?.type).toBe('object');
    for (const [field, target] of Object.entries(BUTTON_PARITY)) {
      for (const path of target.split('+')) {
        const [head, key] = path.split('.') as [string, string | undefined];
        expect(Object.keys(fields), `${field} → ${head}`).toContain(head);
        if (key) expect(Object.keys(spec.objectFields ?? {}), `${field} → ${path}`).toContain(key);
      }
    }
    expect(optionValues(spec.objectFields?.['fill'])).toEqual(expect.arrayContaining(['solid', 'outline', 'text']));
    expect(optionValues(spec.objectFields?.['style'])).toEqual(expect.arrayContaining(['primary']));
    for (const key of ['style', 'fill']) {
      expect((spec.objectFields?.[key] as { metadata?: unknown }).metadata, `button.${key} is responsive`).toEqual(PB_RESPONSIVE_METADATA);
    }
  });

  it('carries every variant, per breakpoint: ghost is the text fill', async () => {
    const { buttonFromLegacy } = await import('./Button.js');
    const fills = BUTTON_ON_ORIGIN.variant.map((variant) => buttonFromLegacy({ label: 'Go', variant }));
    expect(fills.map((spec) => [spec.style, spec.fill])).toEqual([
      ['primary', 'solid'],
      ['primary', 'outline'],
      ['primary', 'text'],
    ]);
    expect(buttonFromLegacy({ label: 'Go', variant: { base: 'ghost', desktop: 'primary' } })).toMatchObject({
      style: 'primary',
      fill: { base: 'text', desktop: 'solid' },
    });
  });

  it('carries every link type and the target into the link', async () => {
    const { buttonFromLegacy } = await import('./Button.js');
    expect(buttonFromLegacy({ label: 'Go', linkType: 'url', href: '/contact', target: '_blank' }).link).toEqual({
      kind: 'url',
      href: '/contact',
      target: '_blank',
    });
    for (const kind of ['product', 'category', 'page'] as const) {
      expect(buttonFromLegacy({ label: 'Go', linkType: kind, linkSlug: 'acme-widget', href: '/x' }).link).toEqual({
        kind,
        slug: 'acme-widget',
      });
    }
  });

  it('carries the label and the colour overrides', async () => {
    const { buttonFromLegacy } = await import('./Button.js');
    expect(
      buttonFromLegacy({ label: 'Contact us', backgroundColor: '#1d4ed8', textColor: '#ffffff' }),
    ).toMatchObject({ label: 'Contact us', backgroundColor: '#1d4ed8', textColor: '#ffffff', size: 'medium' });
    // "Transparent" was today's way of saying "no override".
    expect(buttonFromLegacy({ label: 'Go', backgroundColor: 'transparent' })).not.toHaveProperty('backgroundColor');
  });
});

// ── cms.Hero ─────────────────────────────────────────────────────────

/**
 * `HERO_FIELDS` of `packages/cms-components/src/components/Hero.tsx` on
 * `origin/master` (b816c1d55, 2026-10-22), with the option values of the
 * select fields and the kinds of the shared `BACKGROUND_FIELD`
 * (`page-builder-core/src/types/background.ts`). `buttonVariant` and
 * `minHeightPx` are responsive there; `overlayOpacity` runs 0–90 in steps of 5.
 */
const HERO_ON_ORIGIN = {
  heading: null,
  subtitle: null,
  buttonLabel: null,
  buttonLinkType: ['url', 'product', 'category', 'page'],
  buttonLinkSlug: null,
  buttonHref: null,
  buttonTarget: ['_self', '_blank'],
  buttonVariant: ['primary', 'secondary', 'ghost'],
  buttonBackgroundColor: null,
  buttonTextColor: null,
  background: ['none', 'solid', 'gradient', 'image', 'video'],
  overlayOpacity: null,
  textColor: null,
  contentAlign: ['left', 'center', 'right'],
  minHeightPx: null,
  cornerRadius: ['none', 'small', 'medium', 'large'],
  shadow: ['none', 'soft', 'medium'],
  margin: null,
  padding: null,
  border: null,
} as const;

/**
 * Where each of today's Hero fields lives after the reshape (contracts/blocks.md
 * `cms.Hero`, plan § *Extend, don't narrow* table): `buttons.<key>` is a
 * property of each `ButtonSpec` in the list, `media.<key>` one of the media
 * object. `minHeightPx` is the **Custom (px)** case of `minHeight`.
 */
const HERO_PARITY: Record<keyof typeof HERO_ON_ORIGIN, string> = {
  heading: 'title',
  subtitle: 'subheading',
  buttonLabel: 'buttons.label',
  buttonLinkType: 'buttons.link',
  buttonLinkSlug: 'buttons.link',
  buttonHref: 'buttons.link',
  buttonTarget: 'buttons.link',
  buttonVariant: 'buttons.style+buttons.fill',
  buttonBackgroundColor: 'buttons.backgroundColor',
  buttonTextColor: 'buttons.textColor',
  background: 'media',
  overlayOpacity: 'overlay',
  textColor: 'textColor',
  contentAlign: 'align',
  minHeightPx: 'minHeight+minHeightPx',
  cornerRadius: 'cornerRadius',
  shadow: 'shadow',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('option parity — cms.Hero (T042)', () => {
  it('maps every field the Hero has on origin/master', () => {
    expect(Object.keys(HERO_PARITY).sort()).toEqual(Object.keys(HERO_ON_ORIGIN).sort());
  });

  it('offers each counterpart at the top level and nested, the Custom min height included', async () => {
    const hero = (await import('./Hero.js')).Hero as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(hero, position, { minHeight: 'custom' });
      const buttons = fields['buttons'] as { type?: string; arrayFields?: Fields } | undefined;
      expect(buttons?.type, `buttons is a list (${position})`).toBe('array');
      for (const [field, target] of Object.entries(HERO_PARITY)) {
        for (const path of target.split('+')) {
          const [head, key] = path.split('.') as [string, string | undefined];
          expect(Object.keys(fields), `${field} → ${head} (${position})`).toContain(head);
          if (key) expect(Object.keys(buttons?.arrayFields ?? {}), `${field} → ${path} (${position})`).toContain(key);
        }
      }
    }
    // Section settings live only on `cms.Section` (plan § Owner ruling 2026-10-23).
    expect(Object.keys(await fieldsAt(hero, 'top'))).not.toContain('section');
    expect(Object.keys(await fieldsAt(hero, 'nested'))).not.toContain('section');
  });

  it('keeps every option value of today\'s select fields', async () => {
    const hero = (await import('./Hero.js')).Hero as unknown as ComponentConfig;
    // Today's `overlayOpacity` is a solid overlay's strength (T192: the strength shows for a solid or gradient overlay).
    const fields = await fieldsAt(hero, 'nested', { minHeight: 'custom', overlay: { kind: 'solid', strength: 40 } });
    const buttons = (fields['buttons'] as { arrayFields?: Fields }).arrayFields ?? {};
    expect(optionValues(buttons['fill'])).toEqual(expect.arrayContaining(['solid', 'outline', 'text']));
    expect(optionValues(buttons['style'])).toEqual(expect.arrayContaining(['primary']));
    for (const key of ['style', 'fill']) {
      expect((buttons[key] as { metadata?: unknown }).metadata, `buttons.${key} is responsive`).toEqual(PB_RESPONSIVE_METADATA);
    }
    const media = fields['media'] as { objectFields?: Fields };
    expect(optionValues(media.objectFields?.['kind'])).toEqual(expect.arrayContaining([...HERO_ON_ORIGIN.background]));
    expect(optionValues(fields['align'])).toEqual(['start', 'center', 'end']);
    expect(optionValues(fields['minHeight'])).toEqual(expect.arrayContaining(['auto', 'custom']));
    expect(optionValues(fields['cornerRadius'])).toEqual(expect.arrayContaining([...HERO_ON_ORIGIN.cornerRadius]));
    expect(optionValues(fields['shadow'])).toEqual(expect.arrayContaining([...HERO_ON_ORIGIN.shadow]));
    // Responsive as today: the min height and its Custom px.
    for (const key of ['minHeight', 'minHeightPx']) {
      expect((fields[key] as { metadata?: unknown }).metadata, `${key} is responsive`).toEqual(PB_RESPONSIVE_METADATA);
    }
    // The overlay keeps a plain opacity: today's 0–90 %, in the overlay's strength.
    const overlay = fields['overlay'] as { objectFields?: Fields };
    expect(Object.keys(overlay.objectFields ?? {})).toEqual(expect.arrayContaining(['kind', 'strength']));
    expect(optionValues(overlay.objectFields?.['kind'])).toEqual(expect.arrayContaining(['none', 'solid']));
  });

  it('carries a hero stored on origin/master into the new shape, value for value', async () => {
    const { heroFromLegacy } = await import('./Hero.js');
    const box = {
      margin: { mode: 'uniform', value: 8 },
      padding: { mode: 'uniform', value: 48 },
      border: { width: 1, style: 'solid', color: '#d9e0e7' },
    };
    const legacy = {
      heading: 'Grow with Acme',
      subtitle: 'One place for every page.',
      buttonLabel: 'Get started',
      buttonLinkType: 'page',
      buttonLinkSlug: 'about',
      buttonHref: '/about',
      buttonTarget: '_blank',
      buttonVariant: { base: 'ghost', desktop: 'primary' },
      buttonBackgroundColor: '#1d4ed8',
      buttonTextColor: '#ffffff',
      background: { kind: 'gradient', gradientFrom: '#0f766e', gradientTo: '#134e4a', gradientAngle: 135 },
      overlayOpacity: 45,
      textColor: '#fafafa',
      contentAlign: 'right',
      minHeightPx: { base: 280, desktop: 480 },
      cornerRadius: 'medium',
      shadow: 'soft',
      ...box,
    };
    const next = heroFromLegacy(legacy);
    expect(next).toMatchObject({
      title: doc('Grow with Acme'),
      titleLevel: 'h2',
      subheading: doc('One place for every page.'),
      subheadingLevel: 'p',
      buttons: [
        {
          label: 'Get started',
          link: { kind: 'page', slug: 'about', target: '_blank' },
          style: 'primary',
          fill: { base: 'text', desktop: 'solid' },
          size: 'medium',
          backgroundColor: '#1d4ed8',
          textColor: '#ffffff',
        },
      ],
      media: { kind: 'gradient', from: '#0f766e', to: '#134e4a', angle: 135 },
      overlay: { kind: 'solid', strength: 45 },
      textColor: '#fafafa',
      align: 'end',
      minHeight: 'custom',
      minHeightPx: { base: 280, desktop: 480 },
      cornerRadius: 'medium',
      shadow: 'soft',
      ...box,
    });
    // Today's title and subtitle look is kept: no type token is imposed on a stored hero.
    expect(next).not.toHaveProperty('titleSize');
    expect(next).not.toHaveProperty('subheadingSize');
    // The keys that moved are gone from the new shape; those kept as they are stay.
    const kept = ['textColor', 'minHeightPx', 'cornerRadius', 'shadow', ...Object.keys(box)];
    for (const key of Object.keys(HERO_ON_ORIGIN).filter((key) => !kept.includes(key))) {
      expect(next, key).not.toHaveProperty(key);
    }
  });

  it('carries every variant, link type and target of the button', async () => {
    const { heroFromLegacy } = await import('./Hero.js');
    const fills = HERO_ON_ORIGIN.buttonVariant.map((buttonVariant) => heroFromLegacy({ heading: 'x', buttonLabel: 'Go', buttonVariant }).buttons?.[0]);
    expect(fills.map((spec) => [spec?.style, spec?.fill])).toEqual([
      ['primary', 'solid'],
      ['primary', 'outline'],
      ['primary', 'text'],
    ]);
    expect(heroFromLegacy({ heading: 'x', buttonLabel: 'Go', buttonLinkType: 'url', buttonHref: '/contact' }).buttons?.[0]?.link).toEqual({
      kind: 'url',
      href: '/contact',
    });
    for (const kind of ['product', 'category', 'page'] as const) {
      expect(heroFromLegacy({ heading: 'x', buttonLabel: 'Go', buttonLinkType: kind, buttonLinkSlug: 'acme-widget' }).buttons?.[0]?.link).toEqual({
        kind,
        slug: 'acme-widget',
      });
    }
    // No label, no button — as today, where an empty label rendered none.
    expect(heroFromLegacy({ heading: 'x', buttonLabel: '' }).buttons).toEqual([]);
    // "Transparent" was today's way of saying "no override".
    expect(heroFromLegacy({ heading: 'x', buttonLabel: 'Go', buttonBackgroundColor: 'transparent' }).buttons?.[0]).not.toHaveProperty('backgroundColor');
  });

  it('carries every background kind into the media', async () => {
    const { heroFromLegacy } = await import('./Hero.js');
    const media = (background: unknown) => heroFromLegacy({ heading: 'x', background }).media;
    expect(media(undefined)).toEqual({ kind: 'none' });
    expect(media({ kind: 'none' })).toEqual({ kind: 'none' });
    expect(media('#1d4ed8')).toEqual({ kind: 'solid', color: '#1d4ed8' });
    expect(media({ kind: 'solid', color: 'token:primary' })).toEqual({ kind: 'solid', color: 'token:primary' });
    expect(media({ kind: 'gradient', gradientFrom: '#ffffff', gradientTo: '#000000', gradientAngle: 90 })).toEqual({
      kind: 'gradient',
      from: '#ffffff',
      to: '#000000',
      angle: 90,
    });
    expect(media({ kind: 'image', imageSource: 'url', imageUrl: '/media/wide.jpg' })).toEqual({
      kind: 'image',
      image: { imageSource: 'url', src: '/media/wide.jpg', alt: '', fit: 'cover' },
    });
    expect(media({ kind: 'image', imageSource: 'library', imageAssetId: 'asset-1' })).toEqual({
      kind: 'image',
      image: { imageSource: 'library', assetId: 'asset-1', alt: '', fit: 'cover' },
    });
    expect(media({ kind: 'video', videoSource: 'url', videoUrl: '/media/loop.mp4' })).toEqual({
      kind: 'video',
      videoSource: 'url',
      videoUrl: '/media/loop.mp4',
    });
    expect(media({ kind: 'video', videoSource: 'library', videoAssetId: 'asset-2' })).toEqual({
      kind: 'video',
      videoSource: 'library',
      videoAssetId: 'asset-2',
    });
  });

  it('carries today\'s render defaults: white text, a 40 % overlay, start alignment and a 320 px minimum', async () => {
    const { heroFromLegacy } = await import('./Hero.js');
    expect(heroFromLegacy({ heading: 'x' })).toMatchObject({
      textColor: '#ffffff',
      overlay: { kind: 'solid', strength: 40 },
      align: 'start',
      minHeight: 'custom',
      minHeightPx: 320,
      buttons: [],
    });
    expect(['left', 'center', 'right'].map((contentAlign) => heroFromLegacy({ heading: 'x', contentAlign }).align)).toEqual([
      'start',
      'center',
      'end',
    ]);
    expect(heroFromLegacy({ heading: 'x', overlayOpacity: 0 }).overlay).toEqual({ kind: 'solid', strength: 0 });
  });
});

// ── cms.FeatureList, cms.Stats, cms.Testimonial (T048) ───────────────

/**
 * A field's counterpart path, checked on the fields the editor offers: `head`
 * must be a field, and `head.key` a property of its array items or of its
 * object.
 */
/**
 * T193 (owner review 2026-10-27): `cms.Hero`'s `spaceAfter` list moved into
 * its element list — every option it had is an item's `space` / `spacePx` in
 * `order`, beside the item's `element`. A baseline naming `spaceAfter` is met
 * there, and asserted to be; nothing else is relaxed.
 */
const MOVED_FIELDS: Readonly<Record<string, string>> = { spaceAfter: 'order' };

function expectMovedOrOffered(fields: Fields, baseline: readonly string[], message: string): string[] {
  const kept: string[] = [];
  for (const field of baseline) {
    const target = MOVED_FIELDS[field];
    if (target === undefined || field in fields) {
      kept.push(field);
      continue;
    }
    const moved = fields[target] as { arrayFields?: Fields } | undefined;
    expect(Object.keys(moved?.arrayFields ?? {}), `${message}: ${field} → ${target}`).toEqual(expect.arrayContaining(['element', 'space', 'spacePx']));
  }
  return kept;
}

/**
 * T194 (owner review 2026-10-27): a `cms.Video` file offers the fields of its
 * file source (library videos, or their URLs) and of its poster source
 * (library images, or their URLs) — one source's fields at a time, as
 * `cms.Image` does. Every field it had is still offered by one of the sources;
 * the parity below reads the union over the four combinations, and every
 * combination offers both source selects.
 */
const VIDEO_FILE_SOURCES = [
  { fileSource: 'library', posterSource: 'library' },
  { fileSource: 'library', posterSource: 'url' },
  { fileSource: 'url', posterSource: 'library' },
  { fileSource: 'url', posterSource: 'url' },
] as const;

async function fieldsAcrossSources(
  config: ComponentConfig,
  position: 'top' | 'nested',
  props: Record<string, unknown>,
): Promise<Fields> {
  const union: Record<string, unknown> = {};
  for (const sources of VIDEO_FILE_SOURCES) {
    const fields = await fieldsAt(config, position, { ...props, ...sources });
    expect(Object.keys(fields), JSON.stringify(sources)).toEqual(expect.arrayContaining(['fileSource', 'posterSource']));
    Object.assign(union, fields);
  }
  return union as Fields;
}

function expectCounterpart(fields: Fields, path: string, message: string): void {
  const [movedHead, movedKey] = path.split('.') as [string, string | undefined];
  if (MOVED_FIELDS[movedHead] !== undefined && !(movedHead in fields)) path = `${MOVED_FIELDS[movedHead]}${movedKey ? `.${movedKey}` : ''}`;
  const [head, key] = path.split('.') as [string, string | undefined];
  expect(Object.keys(fields), `${message} → ${head}`).toContain(head);
  if (!key) return;
  const field = fields[head] as { arrayFields?: Fields; objectFields?: Fields };
  expect(Object.keys(field.arrayFields ?? field.objectFields ?? {}), `${message} → ${path}`).toContain(key);
}

/**
 * `cms.FeatureList`'s fields on `origin/master` (b816c1d55, 2026-10-22):
 * `items` holds `icon`, `title` and `description`; `columns` (1–4) and `gap`
 * (px) are responsive numbers; `iconSize` is a number of px.
 */
const FEATURE_LIST_ON_ORIGIN = {
  items: ['icon', 'title', 'description'],
  columns: null,
  gap: null,
  iconColor: null,
  iconSize: null,
  align: ['left', 'center', 'right'],
  margin: null,
  padding: null,
  border: null,
} as const;

/**
 * Where each lives after the reshape (contracts/blocks.md `cms.FeatureList`):
 * an item's `description` is its rich `body`; `gap` and `iconSize` take a
 * token or their **Custom (px)** case.
 */
const FEATURE_LIST_PARITY: Record<keyof typeof FEATURE_LIST_ON_ORIGIN, string> = {
  items: 'items.icon+items.title+items.body',
  columns: 'columns',
  gap: 'gap+gapPx',
  iconColor: 'iconColor',
  iconSize: 'iconSize+iconSizePx',
  align: 'align',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

describe('option parity — cms.FeatureList (T048)', () => {
  it('maps every field the FeatureList has on origin/master', () => {
    expect(Object.keys(FEATURE_LIST_PARITY).sort()).toEqual(Object.keys(FEATURE_LIST_ON_ORIGIN).sort());
  });

  it('offers each counterpart at the top level and nested, the Custom px included', async () => {
    const block = (await import('./FeatureList.js')).FeatureList as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position, { gap: 'custom', iconSize: 'custom' });
      for (const [field, target] of Object.entries(FEATURE_LIST_PARITY)) {
        for (const path of target.split('+')) expectCounterpart(fields, path, `${field} (${position})`);
      }
    }
    expect(Object.keys(await fieldsAt(block, 'top'))).not.toContain('section');
    expect(Object.keys(await fieldsAt(block, 'nested'))).not.toContain('section');
  });

  it('keeps today\'s controls: responsive columns 1–4 and gap, the icon size and every alignment', async () => {
    const block = (await import('./FeatureList.js')).FeatureList as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'nested', { gap: 'custom', iconSize: 'custom' });
    for (const key of ['columns', 'gap', 'gapPx']) {
      expect((fields[key] as { metadata?: unknown }).metadata, `${key} is responsive`).toEqual(PB_RESPONSIVE_METADATA);
    }
    expect(fields['columns']).toMatchObject({ min: 1, max: 4 });
    expect(optionValues(fields['gap'])).toEqual(expect.arrayContaining(['custom']));
    expect(optionValues(fields['iconSize'])).toEqual(expect.arrayContaining(['small', 'medium', 'large', 'custom']));
    expect(optionValues(fields['align'])).toEqual(['start', 'center', 'end']);
  });

  it('carries a feature list stored on origin/master into the new shape, value for value', async () => {
    const { featureListFromLegacy } = await import('./FeatureList.js');
    const box = {
      margin: { mode: 'uniform', value: 8 },
      padding: { mode: 'uniform', value: 16 },
      border: { width: 1, style: 'solid', color: '#d9e0e7' },
    };
    const next = featureListFromLegacy({
      items: [
        { icon: 'truck', title: 'Fast delivery', description: 'Reliable logistics.' },
        { icon: 'lifeBuoy', title: 'Support' },
      ],
      columns: { base: 1, desktop: 3 },
      gap: { base: 16, desktop: 32 },
      iconColor: '#1d4ed8',
      iconSize: 36,
      align: 'right',
      ...box,
    });
    expect(next).toMatchObject({
      items: [
        { icon: 'truck', title: 'Fast delivery', body: doc('Reliable logistics.') },
        { icon: 'lifeBuoy', title: 'Support' },
      ],
      columns: { base: 1, desktop: 3 },
      gap: 'custom',
      gapPx: { base: 16, desktop: 32 },
      iconColor: '#1d4ed8',
      iconSize: 'custom',
      iconSizePx: 36,
      align: 'end',
      ...box,
    });
    expect(next.items[0]).not.toHaveProperty('description');
    expect(next.items[1]).not.toHaveProperty('body');
    expect(['left', 'center', 'right'].map((align) => featureListFromLegacy({ items: [], align }).align)).toEqual(['start', 'center', 'end']);
    expect(featureListFromLegacy({ items: [], gap: 24 })).toMatchObject({ gap: 'custom', gapPx: 24 });
    // Idempotent: the reshaped shape passes through untouched.
    expect(featureListFromLegacy(next as unknown as Record<string, unknown>)).toEqual(next);
  });
});

/**
 * `cms.Stats`' fields on `origin/master` (b816c1d55): `items` holds `value`
 * and `label`; `columns` (1–6) is a responsive number; `gap` a number of px.
 */
const STATS_ON_ORIGIN = {
  items: ['value', 'label'],
  columns: null,
  gap: null,
  align: ['left', 'center', 'right'],
  valueColor: null,
  margin: null,
  padding: null,
  border: null,
} as const;

/**
 * Where each lives after the reshape (contracts/blocks.md `cms.Stats`). The
 * contract's `grid` is today's `columns`, kept by name and range (1–6), so no
 * stored value moves.
 */
const STATS_PARITY: Record<keyof typeof STATS_ON_ORIGIN, string> = {
  items: 'items.value+items.label',
  columns: 'columns',
  gap: 'gap+gapPx',
  align: 'align',
  valueColor: 'valueColor',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

describe('option parity — cms.Stats (T048)', () => {
  it('maps every field the Stats block has on origin/master', () => {
    expect(Object.keys(STATS_PARITY).sort()).toEqual(Object.keys(STATS_ON_ORIGIN).sort());
  });

  it('offers each counterpart at the top level and nested, the Custom px included', async () => {
    const block = (await import('./Stats.js')).Stats as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position, { gap: 'custom' });
      for (const [field, target] of Object.entries(STATS_PARITY)) {
        for (const path of target.split('+')) expectCounterpart(fields, path, `${field} (${position})`);
      }
    }
    expect(Object.keys(await fieldsAt(block, 'top'))).not.toContain('section');
    expect(Object.keys(await fieldsAt(block, 'nested'))).not.toContain('section');
  });

  it('keeps today\'s controls: responsive columns 1–6, the gap and every alignment', async () => {
    const block = (await import('./Stats.js')).Stats as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'nested', { gap: 'custom' });
    expect((fields['columns'] as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(fields['columns']).toMatchObject({ min: 1, max: 6 });
    expect(optionValues(fields['gap'])).toEqual(expect.arrayContaining(['custom']));
    expect(optionValues(fields['align'])).toEqual(['start', 'center', 'end']);
  });

  it('carries a stats block stored on origin/master into the new shape, value for value', async () => {
    const { statsFromLegacy } = await import('./Stats.js');
    const box = { margin: { mode: 'uniform', value: 8 }, padding: { mode: 'uniform', value: 16 } };
    const next = statsFromLegacy({
      items: [{ value: '40+', label: 'Markets' }],
      columns: { base: 2, desktop: 6 },
      gap: 32,
      align: 'left',
      valueColor: '#1d4ed8',
      ...box,
    });
    expect(next).toMatchObject({
      items: [{ value: '40+', label: 'Markets' }],
      columns: { base: 2, desktop: 6 },
      gap: 'custom',
      gapPx: 32,
      align: 'start',
      valueColor: '#1d4ed8',
      ...box,
    });
    expect(['left', 'center', 'right'].map((align) => statsFromLegacy({ items: [], align }).align)).toEqual(['start', 'center', 'end']);
    expect(statsFromLegacy(next as unknown as Record<string, unknown>)).toEqual(next);
  });
});

/**
 * `cms.Testimonial`'s fields on `origin/master` (b816c1d55): the avatar is
 * `avatarSource` (`url`/`library`) with `avatarUrl` or `avatarAssetId`;
 * `background` is the shared `BACKGROUND_FIELD`.
 */
const TESTIMONIAL_ON_ORIGIN = {
  quote: null,
  author: null,
  role: null,
  avatarSource: ['url', 'library'],
  avatarUrl: null,
  avatarAssetId: null,
  background: null,
  cornerRadius: ['none', 'small', 'medium', 'large'],
  shadow: ['none', 'soft', 'medium'],
  margin: null,
  padding: null,
  border: null,
} as const;

/** Where each lives after the reshape (contracts/blocks.md `cms.Testimonial`): the avatar is one `ResponsiveImage`. */
const TESTIMONIAL_PARITY: Record<keyof typeof TESTIMONIAL_ON_ORIGIN, string> = {
  quote: 'quote',
  author: 'author',
  role: 'role',
  avatarSource: 'avatar',
  avatarUrl: 'avatar',
  avatarAssetId: 'avatar',
  background: 'background',
  cornerRadius: 'cornerRadius',
  shadow: 'shadow',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

describe('option parity — cms.Testimonial (T048)', () => {
  it('maps every field the Testimonial has on origin/master', () => {
    expect(Object.keys(TESTIMONIAL_PARITY).sort()).toEqual(Object.keys(TESTIMONIAL_ON_ORIGIN).sort());
  });

  it('offers each counterpart at the top level and nested, with today\'s corner and shadow options', async () => {
    const block = (await import('./Testimonial.js')).Testimonial as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position);
      for (const [field, target] of Object.entries(TESTIMONIAL_PARITY)) {
        for (const path of target.split('+')) expectCounterpart(fields, path, `${field} (${position})`);
      }
      expect(optionValues(fields['cornerRadius'])).toEqual(expect.arrayContaining([...TESTIMONIAL_ON_ORIGIN.cornerRadius]));
      expect(optionValues(fields['shadow'])).toEqual(expect.arrayContaining([...TESTIMONIAL_ON_ORIGIN.shadow]));
      expect(optionValues(fields['layout'])).toEqual(['card', 'image-overlay']);
    }
    expect(Object.keys(await fieldsAt(block, 'top'))).not.toContain('section');
    expect(Object.keys(await fieldsAt(block, 'nested'))).not.toContain('section');
  });

  it('carries a testimonial stored on origin/master into the new shape, value for value', async () => {
    const { testimonialFromLegacy } = await import('./Testimonial.js');
    const box = { margin: { mode: 'uniform', value: 8 }, padding: { mode: 'uniform', value: 24 } };
    const appearance = { background: { kind: 'solid', color: '#f8fafc' }, cornerRadius: 'medium', shadow: 'soft' };
    const library = testimonialFromLegacy({
      quote: 'Simple and fast.',
      author: 'Alex Doe',
      role: 'Buyer',
      avatarSource: 'library',
      avatarUrl: '',
      avatarAssetId: 'asset-9',
      ...appearance,
      ...box,
    });
    expect(library).toMatchObject({
      quote: doc('Simple and fast.'),
      author: 'Alex Doe',
      role: 'Buyer',
      avatar: { imageSource: 'library', assetId: 'asset-9', alt: 'Alex Doe avatar' },
      layout: 'card',
      ...appearance,
      ...box,
    });
    for (const key of ['avatarSource', 'avatarUrl', 'avatarAssetId']) expect(library, key).not.toHaveProperty(key);

    expect(testimonialFromLegacy({ quote: 'x', avatarSource: 'url', avatarUrl: '/media/a.jpg' }).avatar).toEqual({
      imageSource: 'url',
      src: '/media/a.jpg',
      alt: '',
    });
    // No avatar today (an empty URL), none after.
    expect(testimonialFromLegacy({ quote: 'x', avatarSource: 'url', avatarUrl: '' })).not.toHaveProperty('avatar');
    expect(testimonialFromLegacy(library as unknown as Record<string, unknown>)).toEqual(library);
  });
});

// ── cms.ContentSlider and the removed image slider (T053) ────────────

/** A field's own definition at `path` (`head` or `head.key`), or undefined. */
function fieldAt(fields: Fields, path: string): Record<string, unknown> | undefined {
  const [head, key] = path.split('.') as [string, string | undefined];
  const field = fields[head] as { arrayFields?: Fields; objectFields?: Fields } | undefined;
  if (!field || !key) return field as Record<string, unknown> | undefined;
  return (field.arrayFields ?? field.objectFields ?? {})[key] as Record<string, unknown> | undefined;
}

/**
 * The slider options `cms.ContentSlider` and the image slider share on
 * `origin/master` (b816c1d55, 2026-10-22): `slidesPerView` a responsive select
 * of 1–8, `gap` a responsive number of px (0–48), `intervalMs` 2000–15000, and
 * three yes/no radios. `hideOn` and `editorName` come from `withHideOn`.
 */
const SLIDER_OPTIONS_ON_ORIGIN = {
  slidesPerView: [1, 2, 3, 4, 5, 6, 7, 8],
  gap: null,
  autoplay: [true, false],
  intervalMs: null,
  showArrows: [true, false],
  showDots: [true, false],
  equalHeight: [true, false],
  margin: null,
  padding: null,
  border: null,
} as const;

/** Where each slider option lives on the Carousel (contracts/blocks.md `cms.ContentSlider`). */
const CAROUSEL_PARITY: Record<keyof typeof SLIDER_OPTIONS_ON_ORIGIN, string> = {
  slidesPerView: 'slidesPerView',
  gap: 'gap+gapPx',
  autoplay: 'autoplay',
  intervalMs: 'intervalMs',
  showArrows: 'controls.arrows',
  showDots: 'controls.dots',
  equalHeight: 'equalHeight',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

/** `cms.ContentSlider` on origin/master: the slider options plus its `slides` slot (Slide and Row allowed). */
const CONTENT_SLIDER_ON_ORIGIN = { slides: ['cms.Slide', 'cms.Row'], ...SLIDER_OPTIONS_ON_ORIGIN } as const;

async function carouselBlock(): Promise<ComponentConfig> {
  return (await import('./ContentSlider.js')).ContentSlider as unknown as ComponentConfig;
}

/** The Carousel's fields with every Custom case open. */
async function carouselFields(position: 'top' | 'nested'): Promise<Fields> {
  return fieldsAt(await carouselBlock(), position, { gap: 'custom' });
}

describe('option parity — cms.ContentSlider, now the Carousel (T053)', () => {
  it('maps every field the ContentSlider has on origin/master', () => {
    const parity = { slides: 'slides', ...CAROUSEL_PARITY };
    expect(Object.keys(parity).sort()).toEqual(Object.keys(CONTENT_SLIDER_ON_ORIGIN).sort());
  });

  it('offers each counterpart at the top level and nested, and still allows Slide and Row in its slides', async () => {
    for (const position of ['top', 'nested'] as const) {
      const fields = await carouselFields(position);
      for (const [field, target] of Object.entries({ slides: 'slides', ...CAROUSEL_PARITY })) {
        for (const path of target.split('+')) expectCounterpart(fields, path, `${field} (${position})`);
      }
      const slides = fields['slides'] as { type: string; allow?: string[] };
      expect(slides.type).toBe('slot');
      expect(slides.allow).toEqual(expect.arrayContaining([...CONTENT_SLIDER_ON_ORIGIN.slides]));
    }
    expect(Object.keys(await carouselFields('top'))).not.toContain('section');
    expect(Object.keys(await carouselFields('nested'))).not.toContain('section');
  });

  it('keeps today\'s ranges: 1 to 8 slides per view at every breakpoint, the px gap, the 2–15 s interval, every yes/no', async () => {
    const fields = await carouselFields('nested');
    const perView = fields['slidesPerView'] as { min?: number; max?: number; metadata?: unknown; type: string };
    expect(perView.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(perView.min).toBeLessThanOrEqual(1);
    expect(perView.max).toBeGreaterThanOrEqual(8);
    for (const key of ['gap', 'gapPx']) expect((fields[key] as { metadata?: unknown }).metadata, key).toEqual(PB_RESPONSIVE_METADATA);
    expect(optionValues(fields['gap'])).toEqual(expect.arrayContaining(['custom']));
    expect(fields['gapPx']).toMatchObject({ min: 0 });
    expect((fields['gapPx'] as { max: number }).max).toBeGreaterThanOrEqual(48);
    const interval = fields['intervalMs'] as { min: number; max: number };
    expect(interval.min).toBeLessThanOrEqual(2000);
    expect(interval.max).toBeGreaterThanOrEqual(15000);
    for (const path of ['autoplay', 'controls.arrows', 'controls.dots', 'equalHeight']) {
      expect(optionValues(fieldAt(fields, path)).sort(), path).toEqual([false, true]);
    }
  });

  it('carries a slider stored on origin/master into the new shape, value for value, so it renders as today', async () => {
    const { contentSliderFromLegacy } = await import('./ContentSlider.js');
    const box = { margin: { mode: 'uniform', value: 0 }, padding: { mode: 'uniform', value: 16 }, border: { width: 1, style: 'solid', color: '#d9e0e7' } };
    const slides = [{ type: 'cms.Slide', props: { id: 'slide-1', content: [] } }];
    const next = contentSliderFromLegacy({
      slides,
      slidesPerView: { base: 1, tablet: 2, desktop: 4 },
      gap: { base: 12, desktop: 24 },
      autoplay: true,
      intervalMs: 7000,
      showArrows: false,
      showDots: true,
      equalHeight: false,
      ...box,
    });
    expect(next).toMatchObject({
      slides,
      slidesPerView: { base: 1, tablet: 2, desktop: 4 },
      gap: 'custom',
      gapPx: { base: 12, desktop: 24 },
      autoplay: true,
      intervalMs: 7000,
      // Today's arrows sit over the slides' edges and the dots below them.
      controls: { arrows: false, dots: true, placement: 'overlay' },
      effect: 'slide',
      bleed: 'none',
      equalHeight: false,
      ...box,
    });
    expect(next).not.toHaveProperty('showArrows');
    expect(next).not.toHaveProperty('showDots');
    // origin's defaultProps, as a page stored then holds them.
    expect(contentSliderFromLegacy({ slides: [], slidesPerView: 1, gap: 16, autoplay: false, intervalMs: 5000, showArrows: true, showDots: true, equalHeight: true })).toMatchObject({
      slidesPerView: 1,
      gap: 'custom',
      gapPx: 16,
      controls: { arrows: true, dots: true, placement: 'overlay' },
    });
    // Idempotent: the reshaped shape passes through untouched.
    expect(contentSliderFromLegacy(next as unknown as Record<string, unknown>)).toEqual(next);
  });
});

/**
 * The image slider's (`ImageSlider`) item fields on `origin/master` (b816c1d55): an `image`
 * object (`imageSource` URL or library, `src`, `assetId`, mirrored flat on the
 * item), a `title` with its placement (eight values) and five title style
 * fields. Its slider options are {@link SLIDER_OPTIONS_ON_ORIGIN}.
 */
const IMAGE_SLIDER_ITEM_ON_ORIGIN = {
  image: ['imageSource', 'src', 'assetId'],
  imageSource: ['url', 'library'],
  src: null,
  assetId: null,
  title: null,
  titlePlacement: ['none', 'top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'],
  titleBackground: null,
  titleColor: null,
  titleBorderColor: null,
  titleBorderWidth: null,
  titleBorderRadius: ['none', 'small', 'medium', 'large'],
  titlePaddingPx: null,
} as const;

/** Where each item field lives on `cms.CarouselImage` (contracts/blocks.md, plan § Extend, don't narrow). */
const CAROUSEL_IMAGE_PARITY: Record<keyof typeof IMAGE_SLIDER_ITEM_ON_ORIGIN, string> = {
  image: 'image',
  imageSource: 'image',
  src: 'image',
  assetId: 'image',
  title: 'caption',
  titlePlacement: 'captionPlacement',
  titleBackground: 'captionStyle.background',
  titleColor: 'captionStyle.color',
  titleBorderColor: 'captionStyle.borderColor',
  titleBorderWidth: 'captionStyle.borderWidth',
  titleBorderRadius: 'captionStyle.borderRadius',
  titlePaddingPx: 'captionStyle.paddingPx',
};

describe('option parity — ImageSlider, removed: the Carousel with cms.CarouselImage items (T053)', () => {
  it('maps every item field and every slider option ImageSlider has on origin/master', () => {
    expect(Object.keys(CAROUSEL_IMAGE_PARITY).sort()).toEqual(Object.keys(IMAGE_SLIDER_ITEM_ON_ORIGIN).sort());
    expect(Object.keys(CAROUSEL_PARITY).sort()).toEqual(Object.keys(SLIDER_OPTIONS_ON_ORIGIN).sort());
  });

  it('a CarouselImage offers each item field\'s counterpart, with every placement and corner of today', async () => {
    const block = (await import('./CarouselImage.js')).CarouselImage as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'nested');
    for (const [field, target] of Object.entries(CAROUSEL_IMAGE_PARITY)) expectCounterpart(fields, target, field);
    expect(optionValues(fields['captionPlacement'])).toEqual(expect.arrayContaining([...IMAGE_SLIDER_ITEM_ON_ORIGIN.titlePlacement, 'below']));
    expect(optionValues(fieldAt(fields, 'captionStyle.borderRadius'))).toEqual(expect.arrayContaining([...IMAGE_SLIDER_ITEM_ON_ORIGIN.titleBorderRadius]));
    expect(fieldAt(fields, 'captionStyle.borderWidth')).toMatchObject({ min: 0 });
    expect((fieldAt(fields, 'captionStyle.borderWidth') as { max: number }).max).toBeGreaterThanOrEqual(12);
    expect((fieldAt(fields, 'captionStyle.paddingPx') as { max: number }).max).toBeGreaterThanOrEqual(48);
    // The image is picked from a URL or the library, as today's was.
    expect(fields['image']).toBeDefined();
  });

  it('the Carousel offers every slider option, and its slides take a CarouselImage', async () => {
    const fields = await carouselFields('nested');
    for (const [field, target] of Object.entries(CAROUSEL_PARITY)) {
      for (const path of target.split('+')) expectCounterpart(fields, path, field);
    }
    expect((fields['slides'] as { allow?: string[] }).allow).toContain('cms.CarouselImage');
  });

  it('a CarouselImage stores what an ImageSlider item held, value for value', async () => {
    const { carouselImageFromImageSliderItem } = await import('./CarouselImage.js');
    const item = {
      image: { imageSource: 'library', src: '', assetId: 'asset-1' },
      imageSource: 'library',
      src: '',
      assetId: 'asset-1',
      title: 'Harbour',
      titlePlacement: 'top-right',
      titleBackground: '#112233',
      titleColor: '#ffffff',
      titleBorderColor: '#abcdef',
      titleBorderWidth: 2,
      titleBorderRadius: 'medium',
      titlePaddingPx: 12,
    };
    expect(carouselImageFromImageSliderItem(item)).toEqual({
      image: { imageSource: 'library', assetId: 'asset-1', alt: 'Harbour' },
      caption: 'Harbour',
      captionPlacement: 'top-right',
      captionStyle: {
        background: '#112233',
        color: '#ffffff',
        borderColor: '#abcdef',
        borderWidth: 2,
        borderRadius: 'medium',
        paddingPx: 12,
      },
    });
    // A URL image, today's flat fields only, and no title.
    expect(carouselImageFromImageSliderItem({ src: 'https://example.com/a.jpg', titlePlacement: 'none' })).toEqual({
      image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: '' },
      captionPlacement: 'none',
      captionStyle: {},
    });
  });
});

// ── cms.Tabs and cms.Accordion: panels become blocks (T058) ──────────

/**
 * `cms.Tabs`' fields on `origin/master` (b816c1d55, 2026-10-22): `items` holds
 * a `label` and the panel as HTML (`content`, a textarea), `defaultTab` a
 * number, `variant` and `align` selects, and the box fields.
 */
const TABS_ON_ORIGIN = {
  items: ['label', 'content'],
  defaultTab: null,
  variant: ['underline', 'pills', 'boxed'],
  align: ['start', 'center', 'stretch'],
  margin: null,
  padding: null,
  border: null,
} as const;

/**
 * `cms.Accordion`'s fields on `origin/master` (b816c1d55): `items` holds a
 * `title` and the panel as HTML (`content`), `allowMultiple` a yes/no radio,
 * `defaultOpen` a number, `iconPosition` and `variant` selects, the box fields.
 */
const ACCORDION_ON_ORIGIN = {
  items: ['title', 'content'],
  allowMultiple: [true, false],
  defaultOpen: null,
  iconPosition: ['start', 'end'],
  variant: ['default', 'flush', 'bordered'],
  margin: null,
  padding: null,
  border: null,
} as const;

/**
 * Where each field lives after the reshape (contracts/blocks.md, plan § Extend,
 * don't narrow: "only the panel content changes from HTML to blocks"). The
 * panel is the item's `panel` slot: stored pages hold their HTML under
 * `content`, and a slot cannot read a string, so the blocks have a key of
 * their own and `content` stays the stored HTML until the editor converts it.
 */
const TABS_PARITY: Record<keyof typeof TABS_ON_ORIGIN, string> = {
  items: 'items.label+items.panel',
  defaultTab: 'defaultTab',
  variant: 'variant',
  align: 'align',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

const ACCORDION_PARITY: Record<keyof typeof ACCORDION_ON_ORIGIN, string> = {
  items: 'items.title+items.panel',
  allowMultiple: 'allowMultiple',
  defaultOpen: 'defaultOpen',
  iconPosition: 'iconPosition',
  variant: 'variant',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

/** The panel slot refuses a column and a nested tab or accordion block (R-13). */
const PANEL_DISALLOW = ['cms.Column', 'cms.Tabs', 'cms.Accordion'];

async function panelBlocks(): Promise<{ tabs: ComponentConfig; accordion: ComponentConfig }> {
  return {
    tabs: (await import('./Tabs.js')).Tabs as unknown as ComponentConfig,
    accordion: (await import('./Accordion.js')).Accordion as unknown as ComponentConfig,
  };
}

describe('option parity — cms.Tabs and cms.Accordion, panels as blocks (T058)', () => {
  it('maps every field Tabs and Accordion have on origin/master', () => {
    expect(Object.keys(TABS_PARITY).sort()).toEqual(Object.keys(TABS_ON_ORIGIN).sort());
    expect(Object.keys(ACCORDION_PARITY).sort()).toEqual(Object.keys(ACCORDION_ON_ORIGIN).sort());
  });

  it('offers each counterpart at the top level and nested, with every option value of today', async () => {
    const { tabs, accordion } = await panelBlocks();
    for (const position of ['top', 'nested'] as const) {
      const tabFields = await fieldsAt(tabs, position);
      for (const [field, target] of Object.entries(TABS_PARITY)) {
        for (const path of target.split('+')) expectCounterpart(tabFields, path, `Tabs ${field} (${position})`);
      }
      expect(optionValues(tabFields['variant'])).toEqual(expect.arrayContaining([...TABS_ON_ORIGIN.variant]));
      expect(optionValues(tabFields['align'])).toEqual(expect.arrayContaining([...TABS_ON_ORIGIN.align]));
      // T174 adds `slide` after today's two values.
      expect(optionValues(tabFields['effect']).slice(0, 2)).toEqual(['none', 'fade']);

      const accordionFields = await fieldsAt(accordion, position);
      for (const [field, target] of Object.entries(ACCORDION_PARITY)) {
        for (const path of target.split('+')) expectCounterpart(accordionFields, path, `Accordion ${field} (${position})`);
      }
      expect(optionValues(accordionFields['allowMultiple']).sort()).toEqual([false, true]);
      expect(optionValues(accordionFields['iconPosition'])).toEqual(expect.arrayContaining([...ACCORDION_ON_ORIGIN.iconPosition]));
      expect(optionValues(accordionFields['variant'])).toEqual(expect.arrayContaining([...ACCORDION_ON_ORIGIN.variant]));
    }
  });

  it('holds each panel in a slot that refuses a column and a nested tab or accordion block', async () => {
    const { tabs, accordion } = await panelBlocks();
    for (const block of [tabs, accordion]) {
      const panel = fieldAt(block.fields as Fields, 'items.panel') as { type: string; disallow?: string[] };
      expect(panel.type).toBe('slot');
      expect(panel.disallow).toEqual(expect.arrayContaining(PANEL_DISALLOW));
      // A new item starts with an empty panel, never with HTML.
      const item = (block.fields as Record<string, { defaultItemProps?: Record<string, unknown> }>)['items']!.defaultItemProps;
      expect(item).toMatchObject({ panel: [] });
      expect(item).not.toHaveProperty('content');
    }
  });

  it('carries a panel stored as HTML into a rich-content block holding that HTML, and keeps every option', async () => {
    const { tabsFromLegacy } = await import('./Tabs.js');
    const { accordionFromLegacy } = await import('./Accordion.js');
    const box = { margin: { mode: 'uniform', value: 8 }, padding: { mode: 'uniform', value: 12 }, border: { width: 1, style: 'solid', color: '#d9e0e7' } };

    const tabs = tabsFromLegacy({
      id: 'tabs-1',
      items: [
        { label: 'First', content: '<p>First <strong>panel</strong></p>' },
        { label: 'Second', content: '' },
      ],
      defaultTab: 1,
      variant: 'boxed',
      align: 'stretch',
      ...box,
    });
    expect(tabs).toMatchObject({ id: 'tabs-1', defaultTab: 1, variant: 'boxed', align: 'stretch', ...box });
    const [first, second] = tabs.items as unknown as Array<Record<string, unknown>>;
    expect(first).toEqual({
      label: 'First',
      panel: [
        {
          type: 'cms.RichContent',
          props: expect.objectContaining({ id: 'tabs-1-panel-0', html: '<p>First <strong>panel</strong></p>' }),
        },
      ],
    });
    // An empty panel has nothing to carry.
    expect(second).toEqual({ label: 'Second', panel: [] });

    const accordion = accordionFromLegacy({
      id: 'faq',
      items: [{ title: 'Question', content: '<ul><li>One</li></ul>' }],
      allowMultiple: true,
      defaultOpen: [0],
      iconPosition: 'start',
      variant: 'bordered',
      ...box,
    });
    expect(accordion).toMatchObject({ allowMultiple: true, defaultOpen: [0], iconPosition: 'start', variant: 'bordered', ...box });
    expect(accordion.items).toEqual([
      {
        title: 'Question',
        panel: [{ type: 'cms.RichContent', props: expect.objectContaining({ id: 'faq-panel-0', html: '<ul><li>One</li></ul>' }) }],
      },
    ]);

    // Idempotent: the reshaped shape passes through untouched.
    expect(tabsFromLegacy(tabs as unknown as Record<string, unknown>)).toEqual(tabs);
    expect(accordionFromLegacy(accordion as unknown as Record<string, unknown>)).toEqual(accordion);
  });

  it('converts a stored panel when the editor resolves the block', async () => {
    const { tabs, accordion } = await panelBlocks();
    const resolve = async (block: ComponentConfig, props: Record<string, unknown>) =>
      ((await block.resolveData!({ props } as never, { changed: {}, lastData: null, metadata: {}, trigger: 'load' } as never)) as {
        props: Record<string, unknown>;
      }).props;
    const tabProps = await resolve(tabs, { id: 't', items: [{ label: 'A', content: '<p>A</p>' }] });
    expect((tabProps['items'] as Array<Record<string, unknown>>)[0]).toMatchObject({ label: 'A', panel: [{ type: 'cms.RichContent' }] });
    const accordionProps = await resolve(accordion, { id: 'a', items: [{ title: 'Q', content: '<p>A</p>' }] });
    expect((accordionProps['items'] as Array<Record<string, unknown>>)[0]).toMatchObject({ title: 'Q', panel: [{ type: 'cms.RichContent' }] });
  });
});

// ── catalog.ProductGrid and catalog.ProductSlider (T071) ─────────────

/**
 * The product source both blocks share on `origin/master` (b816c1d55,
 * 2026-10-22): `source` (manual, category or search query), the picked slugs,
 * the category, the query and a limit of 1–24, plus the box fields.
 */
const PRODUCT_SOURCE_ON_ORIGIN = {
  source: ['manual', 'category', 'query'],
  productSlugs: null,
  categorySlug: null,
  searchQuery: null,
  limit: null,
  margin: null,
  padding: null,
  border: null,
} as const;

/** `catalog.ProductGrid` on origin/master: the source, responsive `columns` (1–4) and `gap` (px, 0–48), a responsive `view`, equal heights. */
const PRODUCT_GRID_ON_ORIGIN = {
  ...PRODUCT_SOURCE_ON_ORIGIN,
  equalItemHeight: [true, false],
  columns: null,
  gap: null,
  view: ['grid', 'list'],
} as const;

/** `catalog.ProductSlider` on origin/master: the source and the slider options of {@link SLIDER_OPTIONS_ON_ORIGIN}. */
const PRODUCT_SLIDER_ON_ORIGIN = { ...PRODUCT_SOURCE_ON_ORIGIN, ...SLIDER_OPTIONS_ON_ORIGIN } as const;

/** Every grid field keeps its own name and control; the additions are the header, the card style and the footer button. */
const PRODUCT_GRID_PARITY: Record<keyof typeof PRODUCT_GRID_ON_ORIGIN, string> = {
  source: 'source',
  productSlugs: 'productSlugs',
  categorySlug: 'categorySlug',
  searchQuery: 'searchQuery',
  limit: 'limit',
  equalItemHeight: 'equalItemHeight',
  columns: 'columns',
  gap: 'gap',
  view: 'view',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

/** The slider's options become the Carousel's (contracts/blocks.md: "Slider: takes the Carousel options"). */
const PRODUCT_SLIDER_PARITY: Record<keyof typeof PRODUCT_SLIDER_ON_ORIGIN, string> = {
  source: 'source',
  productSlugs: 'productSlugs',
  categorySlug: 'categorySlug',
  searchQuery: 'searchQuery',
  limit: 'limit',
  ...CAROUSEL_PARITY,
};

/** The fields contracts/blocks.md adds to both blocks. */
const PRODUCT_LISTING_ADDITIONS = ['header', 'cardVariant', 'ctaLabel', 'footerButton'];

async function productGridBlock(): Promise<ComponentConfig> {
  return (await import('./ProductGrid.js')).ProductGrid as unknown as ComponentConfig;
}

async function productSliderBlock(): Promise<ComponentConfig> {
  return (await import('./ProductSlider.js')).ProductSlider as unknown as ComponentConfig;
}

describe('option parity — catalog.ProductGrid (T071)', () => {
  it('maps every field the ProductGrid has on origin/master', () => {
    expect(Object.keys(PRODUCT_GRID_PARITY).sort()).toEqual(Object.keys(PRODUCT_GRID_ON_ORIGIN).sort());
  });

  it('offers each counterpart at the top level and nested, with today\'s ranges, plus the additions', async () => {
    const grid = await productGridBlock();
    for (const position of ['top', 'nested'] as const) {
      // The query field shows for a query source, the category for a category source, as today.
      for (const source of ['manual', 'category', 'query']) {
        const fields = await fieldsAt(grid, position, { source });
        for (const [field, target] of Object.entries(PRODUCT_GRID_PARITY)) {
          if (field === 'productSlugs' && source !== 'manual') continue;
          if (field === 'categorySlug' && source !== 'category') continue;
          if (field === 'searchQuery' && source !== 'query') continue;
          if (field === 'limit' && source === 'manual') continue;
          expectCounterpart(fields, target, `${field} (${position}, ${source})`);
        }
        for (const added of PRODUCT_LISTING_ADDITIONS) expectCounterpart(fields, added, `${added} (${position})`);
      }
    }
    const fields = await fieldsAt(grid, 'nested', { source: 'category' });
    expect(optionValues(fields['source'])).toEqual(['manual', 'category', 'query']);
    expect(optionValues(fields['view'])).toEqual(['grid', 'list']);
    expect(optionValues(fields['equalItemHeight']).sort()).toEqual([false, true]);
    expect(fields['columns']).toMatchObject({ min: 1, max: 4, metadata: PB_RESPONSIVE_METADATA });
    // R17 (T207, deliberately changed, standing rule 13): the px gap is the size select's Custom
    // with its px field (0–48 px kept); a stored number reads as Custom with that px.
    expect(fields['gap']).toMatchObject({ metadata: PB_RESPONSIVE_METADATA });
    expect(optionValues(fields['gap'])).toContain('custom');
    const customGap = await fieldsAt(grid, 'nested', { source: 'category', gap: 'custom' });
    expect(customGap['gapPx']).toMatchObject({ min: 0, metadata: PB_RESPONSIVE_METADATA });
    expect((customGap['gapPx'] as { max: number }).max).toBeGreaterThanOrEqual(48);
    expect((fields['limit'] as { max: number }).max).toBeGreaterThanOrEqual(24);
    expect(optionValues(fields['cardVariant'])).toEqual(['default', 'compact', 'horizontal', 'showcase']);
    expect(Object.keys(await fieldsAt(grid, 'top'))).not.toContain('section');
    expect(Object.keys(await fieldsAt(grid, 'nested'))).not.toContain('section');
  });

  it('keeps today\'s defaults, so a new grid looks as it does today', async () => {
    const grid = await productGridBlock();
    expect(grid.defaultProps).toMatchObject({
      source: 'manual',
      productSlugs: [],
      limit: 12,
      columns: 4,
      // R17 (T207, deliberately changed): today's 16 px gap as Custom 16 px — the same render.
      gap: 'custom',
      gapPx: 16,
      view: 'grid',
      equalItemHeight: true,
      cardVariant: 'default',
    });
  });
});

describe('option parity — catalog.ProductSlider, now with the Carousel options (T071)', () => {
  it('maps every field the ProductSlider has on origin/master', () => {
    expect(Object.keys(PRODUCT_SLIDER_PARITY).sort()).toEqual(Object.keys(PRODUCT_SLIDER_ON_ORIGIN).sort());
  });

  it('offers each counterpart at the top level and nested, plus the additions and the Carousel options', async () => {
    const slider = await productSliderBlock();
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(slider, position, { source: 'manual', gap: 'custom' });
      for (const [field, target] of Object.entries(PRODUCT_SLIDER_PARITY)) {
        if (field === 'categorySlug' || field === 'searchQuery' || field === 'limit') continue;
        for (const path of target.split('+')) expectCounterpart(fields, path, `${field} (${position})`);
      }
      // T129 (deliberately changed, standing rule 13): the arrow placement moved
      // from `controls.placement` to `controlsPlacement`, a value per breakpoint.
      for (const added of [...PRODUCT_LISTING_ADDITIONS, 'effect', 'bleed', 'controlsPlacement']) {
        expectCounterpart(fields, added, `${added} (${position})`);
      }
    }
  });

  it('keeps today\'s ranges: 1 to 8 slides per view, the px gap, the 2–15 s interval, every yes/no', async () => {
    const fields = await fieldsAt(await productSliderBlock(), 'nested', { gap: 'custom' });
    const perView = fields['slidesPerView'] as { min?: number; max?: number; metadata?: unknown };
    expect(perView.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(perView.min).toBeLessThanOrEqual(1);
    expect(perView.max).toBeGreaterThanOrEqual(8);
    expect(optionValues(fields['gap'])).toEqual(expect.arrayContaining(['custom']));
    expect((fields['gapPx'] as { max: number }).max).toBeGreaterThanOrEqual(48);
    const interval = fields['intervalMs'] as { min: number; max: number };
    expect(interval.min).toBeLessThanOrEqual(2000);
    expect(interval.max).toBeGreaterThanOrEqual(15000);
    for (const path of ['autoplay', 'controls.arrows', 'controls.dots', 'equalHeight']) {
      expect(optionValues(fieldAt(fields, path)).sort(), path).toEqual([false, true]);
    }
  });

  it('carries a slider stored on origin/master into the new shape, value for value, so it renders as today', async () => {
    const { productSliderFromLegacy } = await import('./ProductSlider.js');
    const stored = {
      source: 'category',
      productSlugs: [],
      categorySlug: 'chairs',
      searchQuery: '',
      limit: 8,
      slidesPerView: { base: 1, tablet: 4, desktop: 8 },
      gap: 16,
      autoplay: false,
      intervalMs: 5000,
      showArrows: true,
      showDots: true,
      equalHeight: true,
    };
    const next = productSliderFromLegacy(stored);
    expect(next).toMatchObject({
      source: 'category',
      categorySlug: 'chairs',
      limit: 8,
      slidesPerView: { base: 1, tablet: 4, desktop: 8 },
      gap: 'custom',
      gapPx: 16,
      autoplay: false,
      intervalMs: 5000,
      // Today's arrows sit over the slides' edges and the dots below them.
      controls: { arrows: true, dots: true, placement: 'overlay' },
      effect: 'slide',
      bleed: 'none',
      equalHeight: true,
    });
    expect(next).not.toHaveProperty('showArrows');
    expect(next).not.toHaveProperty('showDots');
    expect(productSliderFromLegacy(next as unknown as Record<string, unknown>)).toEqual(next);
  });

  it('keeps today\'s defaults, so a new slider looks as it does today', async () => {
    const slider = await productSliderBlock();
    expect(slider.defaultProps).toMatchObject({
      source: 'manual',
      limit: 12,
      slidesPerView: { base: 1, tablet: 4, desktop: 8 },
      gap: 'custom',
      gapPx: 16,
      autoplay: false,
      intervalMs: 5000,
      // T129 (deliberately changed, standing rule 13): today's placement, now `controlsPlacement`.
      controls: { arrows: true, dots: true },
      controlsPlacement: 'overlay',
      equalHeight: true,
      cardVariant: 'default',
    });
  });
});

// ── cms.NewsletterSignup (T076, owner decision (a)) ──────────────────

/**
 * `cms.NewsletterSignup`'s fields on `origin/master` (b816c1d55, 2026-10-22):
 * the external-endpoint form. `background`, `cornerRadius` and `shadow` are
 * the box appearance fields, `margin`, `padding` and `border` the box fields.
 */
const NEWSLETTER_SIGNUP_ON_ORIGIN = {
  heading: null,
  description: null,
  placeholder: null,
  buttonLabel: null,
  actionUrl: null,
  background: null,
  cornerRadius: null,
  shadow: null,
  margin: null,
  padding: null,
  border: null,
} as const;

/** The owner kept the block (decision (a), 2026-10-23): every field keeps its own name and control. */
const NEWSLETTER_SIGNUP_PARITY: Record<keyof typeof NEWSLETTER_SIGNUP_ON_ORIGIN, string> = {
  heading: 'heading',
  description: 'description',
  placeholder: 'placeholder',
  buttonLabel: 'buttonLabel',
  actionUrl: 'actionUrl',
  background: 'background',
  cornerRadius: 'cornerRadius',
  shadow: 'shadow',
  margin: 'margin',
  padding: 'padding',
  border: 'border',
};

/** `defaultProps` on origin/master, the box defaults aside. */
const NEWSLETTER_SIGNUP_DEFAULTS_ON_ORIGIN = {
  heading: 'Stay in the loop',
  description: 'Product updates and wholesale offers — no spam.',
  placeholder: 'you@company.com',
  buttonLabel: 'Subscribe',
  actionUrl: '',
  background: { kind: 'solid', color: '#f0fdfa' },
  padding: { mode: 'uniform', value: 24 },
  cornerRadius: 'medium',
};

async function newsletterSignupBlock(): Promise<ComponentConfig> {
  return (await import('./NewsletterSignup.js')).NewsletterSignup as unknown as ComponentConfig;
}

describe('option parity — cms.NewsletterSignup, kept as the external-endpoint form (T076)', () => {
  it('maps every field the NewsletterSignup has on origin/master', () => {
    expect(Object.keys(NEWSLETTER_SIGNUP_PARITY).sort()).toEqual(Object.keys(NEWSLETTER_SIGNUP_ON_ORIGIN).sort());
  });

  it('offers each counterpart at the top level and nested, plus the optional consent; no section settings (they live on cms.Section)', async () => {
    const block = await newsletterSignupBlock();
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position, { showConsent: true });
      for (const [field, target] of Object.entries(NEWSLETTER_SIGNUP_PARITY)) {
        expectCounterpart(fields, target, `${field} (${position})`);
      }
      expect(optionValues(fields['showConsent']).sort(), `showConsent (${position})`).toEqual([false, true]);
      expectCounterpart(fields, 'consentLabel', `consentLabel (${position})`);
    }
    expect(Object.keys(await fieldsAt(block, 'top'))).not.toContain('section');
    expect(Object.keys(await fieldsAt(block, 'nested'))).not.toContain('section');
    // The consent label is offered once the consent is switched on.
    expect(Object.keys(await fieldsAt(block, 'top', { showConsent: false }))).not.toContain('consentLabel');
  });

  it('keeps today\'s defaults, with the consent off, so a new form looks as it does today', async () => {
    const block = await newsletterSignupBlock();
    expect(block.defaultProps).toMatchObject({ ...NEWSLETTER_SIGNUP_DEFAULTS_ON_ORIGIN, showConsent: false });
    expect(block.defaultProps).not.toHaveProperty('section');
  });
});

// ── R5 extensions (T133–T135) ────────────────────────────────────────

/**
 * Phase R5 (owner request 2026-10-23) extends blocks this branch already
 * reshaped, or blocks unchanged since `origin/master`. The baseline here is
 * each block's field set **on this branch before R5** (2026-10-23, read from
 * the built config), recorded as literals: every field stays offered at the
 * top level and nested, and the R5 additions join it. `hideOn` and
 * `editorName` come from `withHideOn`; `cms.RichContent` is registered
 * through it, so its own config has neither.
 */
const R5_BASELINE = {
  Hero: {
    load: async () => (await import('./Hero.js')).Hero,
    props: { titleSize: 'custom', subheadingSize: 'custom', statementSize: 'custom', minHeight: 'custom' },
    fields: [
      'hideOn', 'media', 'mediaPlacement', 'overlay', 'textColor', 'eyebrow', 'title', 'titleLevel',
      'subheading', 'subheadingLevel', 'statement', 'statementLevel', 'body', 'buttons', 'socialProof', 'align',
      'reveal', 'cornerRadius', 'shadow', 'titleSize', 'titleSizePx', 'subheadingSize', 'subheadingSizePx',
      'statementSize', 'statementSizePx', 'minHeight', 'minHeightPx', 'gaps', 'margin', 'padding', 'border',
    ],
    added: ['order', 'mediaWidth'],
  },
  Accordion: {
    load: async () => (await import('./Accordion.js')).Accordion,
    props: { titleSize: 'custom' },
    fields: ['hideOn', 'items', 'allowMultiple', 'defaultOpen', 'iconPosition', 'variant', 'margin', 'padding', 'border'],
    added: ['titleLevel', 'titleSize', 'titleSizePx'],
  },
  Text: {
    load: async () => (await import('./Text.js')).Text,
    props: { textMaxWidth: 'custom' },
    fields: [
      'hideOn', 'text', 'fontFamily', 'fontStyle', 'color', 'fontSize', 'fontWeight', 'textAlign',
      'lineHeight', 'margin', 'padding', 'border',
    ],
    added: ['textMaxWidth', 'textMaxWidthPx'],
  },
  Statement: {
    load: async () => (await import('./Statement.js')).Statement,
    props: { headingSize: 'custom', textMaxWidth: 'custom' },
    fields: ['hideOn', 'heading', 'headingLevel', 'body', 'align', 'background', 'reveal', 'headingSize', 'headingSizePx'],
    added: ['textMaxWidth', 'textMaxWidthPx'],
  },
  RichContent: {
    load: async () => (await import('./RichContent.js')).RichContent,
    props: { textMaxWidth: 'custom' },
    fields: ['content', 'margin', 'padding', 'border'],
    added: ['textMaxWidth', 'textMaxWidthPx'],
  },
  ProductGrid: {
    load: async () => (await import('./ProductGrid.js')).ProductGrid,
    props: {},
    fields: [
      'hideOn', 'source', 'productSlugs', 'equalItemHeight',
      'header', 'headingLevel', 'cardVariant', 'ctaLabel', 'footerButton', 'columns', 'gap', 'view', 'headingSize',
      'margin', 'padding', 'border',
    ],
    added: ['cardTextLine'],
  },
  ProductSlider: {
    load: async () => (await import('./ProductSlider.js')).ProductSlider,
    props: {},
    fields: [
      'hideOn', 'source', 'productSlugs', 'header',
      'headingLevel', 'cardVariant', 'ctaLabel', 'effect', 'controls', 'bleed', 'autoplay', 'intervalMs', 'equalHeight',
      'footerButton', 'headingSize', 'slidesPerView', 'gap', 'margin', 'padding', 'border',
    ],
    added: ['cardTextLine'],
  },
} as const;

describe('option parity — R5 extensions keep every option (T133–T135)', () => {
  it.each(Object.keys(R5_BASELINE) as Array<keyof typeof R5_BASELINE>)(
    '%s keeps every field it had before R5, at the top level and nested, and offers the additions',
    async (name) => {
      const entry = R5_BASELINE[name];
      const block = (await entry.load()) as unknown as ComponentConfig;
      for (const position of ['top', 'nested'] as const) {
        const offered = Object.keys(await fieldsAt(block, position, { ...entry.props }));
        expect(offered, `${name} (${position})`).toEqual(expect.arrayContaining([...entry.fields]));
        expect(offered, `${name} additions (${position})`).toEqual(expect.arrayContaining([...entry.added]));
      }
    },
  );

  it('the additions default to today: no order, media in the hero, no title heading or size, no measure, the card style\'s own line', async () => {
    for (const name of Object.keys(R5_BASELINE) as Array<keyof typeof R5_BASELINE>) {
      const block = (await R5_BASELINE[name].load()) as unknown as ComponentConfig;
      for (const added of R5_BASELINE[name].added) {
        expect((block.defaultProps ?? {}) as Record<string, unknown>, `${name}.${added}`).not.toHaveProperty(added);
      }
    }
  });
});

// ── R5: the carousel's controls, grid and filter; the tab bar (T129–T132) ──

/**
 * The options the Carousel's track, its item blocks and `cms.Tabs` offer on
 * this branch before R5 (2026-10-23, after T054/T059/T071/T123), as literals.
 * R5 adds to them; nothing here may go. `controls.placement` moves to
 * `controlsPlacement` (a value per breakpoint) with every value it had.
 */
const CAROUSEL_TRACK_BEFORE_R5 = {
  fields: ['slidesPerView', 'gap', 'gapPx', 'effect', 'controls', 'bleed', 'autoplay', 'intervalMs', 'equalHeight'],
  effect: ['slide', 'fade'],
  bleed: ['none', 'end', 'both'],
  placement: ['below', 'header', 'overlay'],
} as const;

const R5_CAROUSELS = {
  'cms.ContentSlider': async () => (await import('./ContentSlider.js')).ContentSlider,
  'catalog.ProductSlider': async () => (await import('./ProductSlider.js')).ProductSlider,
  'blog.LatestPosts': async () => (await import('./LatestPosts.js')).LatestPosts,
} as const;

describe('option parity — R5 carousel controls, grid and filter; the tab bar (T129–T132)', () => {
  it.each(Object.keys(R5_CAROUSELS) as Array<keyof typeof R5_CAROUSELS>)(
    '%s keeps every track option and offers each placement per breakpoint, plus the arrow look',
    async (name) => {
      const block = (await R5_CAROUSELS[name]()) as unknown as ComponentConfig;
      for (const position of ['top', 'nested'] as const) {
        const fields = await fieldsAt(block, position, { gap: 'custom', layout: 'carousel' });
        for (const key of CAROUSEL_TRACK_BEFORE_R5.fields) expect(Object.keys(fields), `${name} ${key} (${position})`).toContain(key);
        expect(optionValues(fields['effect'])).toEqual(expect.arrayContaining([...CAROUSEL_TRACK_BEFORE_R5.effect]));
        expect(optionValues(fields['bleed'])).toEqual(expect.arrayContaining([...CAROUSEL_TRACK_BEFORE_R5.bleed]));
        for (const path of ['controls.arrows', 'controls.dots']) expect(optionValues(fieldAt(fields, path)).sort(), path).toEqual([false, true]);
        const placement = fields['controlsPlacement'] as { metadata?: unknown } | undefined;
        expect(placement?.metadata, `${name} controlsPlacement (${position})`).toEqual(PB_RESPONSIVE_METADATA);
        // R19B (T253, deliberately widened, standing rule 13): a superset — the Carousel adds `slide`.
        expect(optionValues(placement)).toEqual(expect.arrayContaining([...CAROUSEL_TRACK_BEFORE_R5.placement]));
        for (const path of ['controls.arrowVariant', 'controls.arrowShape', 'controls.arrowSize', 'controls.arrowColor']) {
          expectCounterpart(fields, path, `${name} ${path} (${position})`);
        }
      }
    },
  );

  it('cms.ContentSlider adds the grid and the filter; a carousel stays the default', async () => {
    const block = (await R5_CAROUSELS['cms.ContentSlider']()) as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position, { layout: 'grid' });
      expect(optionValues(fields['layout'])).toEqual(['carousel', 'grid']);
      expect((fields['columns'] as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
      for (const path of ['filter.show', 'filter.allLabel', 'filter.tags']) expectCounterpart(fields, path, `${path} (${position})`);
    }
    expect((block.defaultProps ?? {}) as Record<string, unknown>).toMatchObject({ layout: 'carousel', controlsPlacement: 'below' });
  });

  it('the item blocks keep their options and add tags; cms.LinkTile keeps every ratio, now per breakpoint', async () => {
    const items = {
      'cms.CarouselImage': [(await import('./CarouselImage.js')).CarouselImage, ['image', 'caption', 'captionPlacement', 'captionStyle', 'link', 'hoverZoom']],
      'cms.CarouselSplit': [(await import('./CarouselSplit.js')).CarouselSplit, ['media', 'mediaSide', 'title', 'body', 'buttons', 'hoverZoom']],
      'cms.LinkTile': [(await import('./LinkTile.js')).LinkTile, ['image', 'ratio', 'title', 'linkLabel', 'link', 'hoverZoom']],
      'cms.DownloadTile': [(await import('./DownloadTile.js')).DownloadTile, ['title', 'subtitle', 'fileAssetId', 'hoverImage', 'linkLabel']],
      'cms.Slide': [(await import('./Slide.js')).Slide, ['content', 'margin', 'padding', 'border']],
    } as const;
    for (const [name, [block, before]] of Object.entries(items)) {
      const keys = Object.keys(await fieldsAt(block as unknown as ComponentConfig, 'nested'));
      expect(keys, name).toEqual(expect.arrayContaining([...before, 'tags']));
    }
    const tile = await fieldsAt((await import('./LinkTile.js')).LinkTile as unknown as ComponentConfig, 'nested');
    expect(optionValues(tile['ratio'])).toEqual(expect.arrayContaining(['1:1', '4:3', '3:4', '3:2', '16:9']));
    expect((tile['ratio'] as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    const image = await fieldsAt((await import('./CarouselImage.js')).CarouselImage as unknown as ComponentConfig, 'nested');
    expectCounterpart(image, 'captionScrim.kind', 'captionScrim.kind');
  });

  it('cms.Tabs keeps every option and adds the tab bar\'s look', async () => {
    const { tabs } = await panelBlocks();
    const fields = await fieldsAt(tabs, 'top');
    expect(optionValues(fields['variant'])).toEqual(['underline', 'pills', 'boxed']);
    // T174 adds `slide` after today's two values.
    expect(optionValues(fields['effect']).slice(0, 2)).toEqual(['none', 'fade']);
    expect(optionValues(fields['align'])).toEqual(['start', 'center', 'stretch']);
    // T163: `tabStyle.size` moved to `tabSize` (a value per breakpoint), with the same three values.
    for (const path of ['tabSize', 'tabStyle.barBackground', 'tabStyle.barBorderColor', 'tabStyle.activeBackground', 'tabStyle.activeColor', 'tabStyle.inactiveBackground', 'tabStyle.inactiveColor']) {
      expectCounterpart(fields, path, path);
    }
    expect(optionValues(fields['tabSize'])).toEqual(['s', 'm', 'l']);
    expect((tabs.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('tabStyle');
  });
});

// ── cms.Video and cms.Image (T126, T127) ─────────────────────────────

/**
 * `videoConfig.fields` of `packages/cms-components/src/components/Video.tsx`
 * on `origin/master` (b816c1d55, 2026-10-22), with the option values of its
 * select fields (`autoplay`, `muted`, `loop`, `controls` are yes/no radios).
 */
const VIDEO_ON_ORIGIN = {
  url: null,
  provider: ['auto', 'youtube', 'vimeo', 'generic'],
  aspectRatio: ['16:9', '4:3', '1:1'],
  title: null,
  autoplay: [true, false],
  muted: [true, false],
  loop: [true, false],
  controls: [true, false],
  maxWidth: null,
  align: ['left', 'center', 'right'],
  margin: null,
  padding: null,
  border: null,
} as const;

/** `imageConfig.fields` of `Image.tsx` on `origin/master` (b816c1d55, 2026-10-22). */
const IMAGE_ON_ORIGIN = {
  imageSource: ['url', 'library'],
  src: null,
  assetId: null,
  alt: null,
  // R17 (T212): the URL and its target are the shared link's (`link`, a `LinkValue` of kind `url`
  // with "Open in new tab"); see the mapping below.
  href: null,
  linkTarget: ['_self', '_blank'],
  objectFit: ['cover', 'contain', 'fill', 'none'],
  opacity: null,
  cornerRadius: null,
  widthMode: ['auto', 'full', 'custom'],
  widthPx: null,
  align: ['left', 'center', 'right'],
  margin: null,
  padding: null,
  border: null,
} as const;

describe('option parity — cms.Video, extended with a self-hosted file (T126)', () => {
  it('offers every field the Video has on origin/master, as itself, for an embed', async () => {
    const block = (await import('./Video.js')).Video as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'top', { source: 'embed', widthMode: 'custom' });
    for (const [field, values] of Object.entries(VIDEO_ON_ORIGIN)) {
      expectCounterpart(fields, field, field);
      // The aspect ratio became a responsive ratio field: every aspect token, per breakpoint.
      if (values && field !== 'aspectRatio') expect(optionValues(fields[field]), field).toEqual(expect.arrayContaining([...values]));
    }
  });

  it('the aspect ratio keeps today\'s three values among the tokens it accepts', async () => {
    const { ASPECT_TOKENS } = await import('@endora-commerce/page-builder-core');
    expect([...ASPECT_TOKENS]).toEqual(expect.arrayContaining([...VIDEO_ON_ORIGIN.aspectRatio]));
  });
});

describe('option parity — cms.Image, extended with art direction, ratio, overlay and caption (T127)', () => {
  it('offers every field the Image has on origin/master, as itself, for either source', async () => {
    const block = (await import('./Image.js')).Image as unknown as ComponentConfig;
    for (const imageSource of ['url', 'library'] as const) {
      const fields = await fieldsAt(block, 'top', { imageSource, widthMode: 'custom' });
      for (const [field, values] of Object.entries(IMAGE_ON_ORIGIN)) {
        if (field === (imageSource === 'url' ? 'assetId' : 'src')) continue; // one source's field at a time, as on origin
        // R17 (T212, deliberately changed, standing rule 13): the URL and its target live in `link`,
        // whose `url` kind takes the href and whose target takes both of today's values.
        if (field === 'href' || field === 'linkTarget') {
          expectCounterpart(fields, field === 'href' ? 'link.href' : 'link.target', `${field} (${imageSource})`);
          if (values) expect(optionValues(fieldAt(fields, 'link.target')), field).toEqual(expect.arrayContaining([...values]));
          continue;
        }
        expectCounterpart(fields, field, `${field} (${imageSource})`);
        if (values) expect(optionValues(fields[field]), field).toEqual(expect.arrayContaining([...values]));
      }
    }
  });
});

// ── R7: mobile video URL, hero spacing per element, tab panel gap (T142, T145, T146) ──

/**
 * The options `cms.Video` (file source), `cms.Hero`, `cms.MediaText` and
 * `cms.Tabs` offer on this branch before R7 (2026-10-26, after T126–T141), as
 * literals. R7 adds to them; nothing here may go.
 */
const R7_BASELINE = {
  Video: {
    load: async () => (await import('./Video.js')).Video,
    props: { source: 'file' },
    fields: [
      'source', 'url', 'videoAssetId', 'mobileVideoAssetId', 'posterAssetId', 'aspectRatio', 'mediaCornerRadius',
      'title', 'autoplay', 'muted', 'loop', 'controls', 'maxWidth', 'align', 'margin', 'padding', 'border',
    ],
    nested: {},
    added: ['mobileUrl'],
    addedNested: {},
  },
  Hero: {
    load: async () => (await import('./Hero.js')).Hero,
    props: {},
    fields: [
      'media', 'mediaPlacement', 'mediaWidth', 'order', 'overlay', 'eyebrow', 'title', 'subheading', 'statement', 'body',
      'buttons', 'socialProof', 'align', 'minHeight', 'gaps', 'reveal', 'margin', 'padding', 'border',
    ],
    nested: {
      media: ['kind', 'color', 'from', 'to', 'angle', 'image', 'videoSource', 'videoUrl', 'videoAssetId', 'mobileVideoAssetId', 'posterAssetId', 'ratio'],
    },
    added: ['spaceAfter'],
    addedNested: { media: ['mobileVideoUrl'], spaceAfter: ['element', 'space', 'spacePx'] },
  },
  MediaText: {
    load: async () => (await import('./MediaText.js')).MediaText,
    props: {},
    fields: ['media'],
    nested: { media: ['kind', 'image', 'videoAssetId', 'posterAssetId', 'ratio', 'autoplay'] },
    added: [],
    addedNested: { media: ['videoSource', 'videoUrl', 'mobileVideoAssetId', 'mobileVideoUrl'] },
  },
  Tabs: {
    load: async () => (await import('./Tabs.js')).Tabs,
    props: { panelGap: 'custom' },
    fields: ['items', 'defaultTab', 'variant', 'effect', 'align', 'tabStyle', 'margin', 'padding', 'border'],
    nested: {},
    added: ['panelGap', 'panelGapPx'],
    addedNested: {},
  },
} as const;

describe('option parity — R7 extensions keep every option (T142, T145, T146)', () => {
  it.each(Object.keys(R7_BASELINE) as Array<keyof typeof R7_BASELINE>)(
    '%s keeps every field it had before R7, at the top level and nested, and offers the additions',
    async (name) => {
      const entry = R7_BASELINE[name];
      const block = (await entry.load()) as unknown as ComponentConfig;
      for (const position of ['top', 'nested'] as const) {
        const fields =
          name === 'Video' ? await fieldsAcrossSources(block, position, { ...entry.props }) : await fieldsAt(block, position, { ...entry.props });
        const offered = Object.keys(fields);
        expect(offered, `${name} (${position})`).toEqual(expect.arrayContaining([...entry.fields]));
        expect(offered, `${name} additions (${position})`).toEqual(
          expect.arrayContaining(expectMovedOrOffered(fields, entry.added, `${name} (${position})`)),
        );
        for (const [head, keys] of Object.entries({ ...entry.nested, ...entry.addedNested } as Record<string, readonly string[]>)) {
          for (const key of keys) expectCounterpart(fields, `${head}.${key}`, `${name} ${head}.${key} (${position})`);
        }
      }
    },
  );

  it('the additions default to today: no mobile URL, no space after any element, no panel gap', async () => {
    for (const name of Object.keys(R7_BASELINE) as Array<keyof typeof R7_BASELINE>) {
      const block = (await R7_BASELINE[name].load()) as unknown as ComponentConfig;
      const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
      for (const added of R7_BASELINE[name].added) expect(defaults, `${name}.${added}`).not.toHaveProperty(added);
    }
    const hero = (await R7_BASELINE.Hero.load()) as unknown as ComponentConfig;
    expect(((hero.defaultProps ?? {}) as { media?: Record<string, unknown> }).media).not.toHaveProperty('mobileVideoUrl');
  });

  it('the hero spacing offers every spacing token and Custom px; the tab panel gap is a value per breakpoint', async () => {
    const hero = await fieldsAt((await R7_BASELINE.Hero.load()) as unknown as ComponentConfig, 'top');
    // T193: the space after an element is an item's own in the element list; `default` first keeps `gaps` or today's.
    const spaceAfter = hero['order'] as { arrayFields: Fields };
    expect(optionValues(spaceAfter.arrayFields['element'])).toEqual(['eyebrow', 'title', 'subheading', 'statement', 'body', 'buttons', 'socialProof']);
    expect(optionValues(spaceAfter.arrayFields['space'])).toEqual(['default', 'none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom']);
    const tabs = await fieldsAt((await R7_BASELINE.Tabs.load()) as unknown as ComponentConfig, 'top', { panelGap: 'custom' });
    expect(optionValues(tabs['panelGap'])).toEqual(['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom']);
    expect((tabs['panelGap'] as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect((tabs['panelGapPx'] as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    const plain = await fieldsAt((await R7_BASELINE.Tabs.load()) as unknown as ComponentConfig, 'top');
    expect(Object.keys(plain)).not.toContain('panelGapPx');
  });
});

// ── R7: cms.Section overlap (T148) ───────────────────────────────────

/**
 * `cms.Section`'s fields on this branch before R7 (2026-10-26, after T117 and
 * T124), with the option values of its selects, as literals. The Section is
 * top-level only, so only the top level is read; `contentWidth` and
 * `customMaxWidthPx` show with a bleed width and a custom content width.
 * T148 adds `overlap` (Responsive tab); nothing here may go.
 */
const SECTION_BEFORE_R7 = {
  hideOn: null,
  scheme: ['inherit', 'light', 'muted', 'dark'],
  background: null,
  width: ['contained', 'wide', 'full', 'viewport', 'bleed', 'custom'],
  contentWidth: ['contained', 'wide', 'full', 'custom'],
  customMaxWidthPx: null,
  anchor: null,
  reveal: null,
  spaceTop: null,
  spaceBottom: null,
  contentPosition: ['start', 'center', 'end'],
  content: null,
} as const;

describe('option parity — cms.Section, extended with an overlap (T148)', () => {
  it('keeps every field and option it had before R7, and offers the overlap per breakpoint, unset by default', async () => {
    const block = (await import('./SectionBlock.js')).Section as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'top', { width: 'bleed', contentWidth: 'custom' });
    for (const [field, values] of Object.entries(SECTION_BEFORE_R7)) {
      expectCounterpart(fields, field, field);
      if (values) expect(optionValues(fields[field]), field).toEqual([...values]);
    }
    expect(Object.keys(fields)).toContain('overlap');
    expect((fields['overlap'] as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect((block.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('overlap');
  });
});

// ── R7: filter style, item typography, controls alignment (T143, T144, T147) ──

/**
 * The options the Carousel's filter and track, `cms.CarouselImage` and
 * `cms.LinkTile` offer on this branch before R7 (2026-10-26, after T129–T131
 * and T140), as literals. R7 adds to them; nothing here may go.
 */
const CAROUSEL_BEFORE_R7 = {
  filter: ['filter.show', 'filter.allLabel', 'filter.tags'],
  controls: ['controls.arrows', 'controls.dots', 'controls.arrowVariant', 'controls.arrowShape', 'controls.arrowSize', 'controls.arrowColor'],
  arrowVariant: ['default', 'outline', 'solid'],
  placement: ['below', 'header', 'overlay'],
} as const;

const CAROUSEL_IMAGE_BEFORE_R7 = ['image', 'caption', 'mediaCornerRadius', 'captionPlacement', 'captionStyle', 'captionScrim', 'link', 'hoverZoom', 'tags'] as const;
const LINK_TILE_BEFORE_R7 = ['image', 'ratio', 'mediaCornerRadius', 'title', 'linkLabel', 'link', 'hoverZoom', 'tags'] as const;

describe('option parity — R7 filter style, item typography and controls alignment (T143, T144, T147)', () => {
  it.each(Object.keys(R5_CAROUSELS) as Array<keyof typeof R5_CAROUSELS>)(
    '%s keeps its controls and offers their alignment per breakpoint and the next arrow\'s own style, unset by default',
    async (name) => {
      const block = (await R5_CAROUSELS[name]()) as unknown as ComponentConfig;
      for (const position of ['top', 'nested'] as const) {
        const fields = await fieldsAt(block, position, { layout: 'carousel' });
        for (const path of CAROUSEL_BEFORE_R7.controls) expectCounterpart(fields, path, `${name} ${path} (${position})`);
        expect(optionValues(fieldAt(fields, 'controls.arrowVariant'))).toEqual([...CAROUSEL_BEFORE_R7.arrowVariant]);
        // R19B (T253, deliberately widened, standing rule 13): a superset — the Carousel adds `slide`.
        expect(optionValues(fields['controlsPlacement'])).toEqual(expect.arrayContaining([...CAROUSEL_BEFORE_R7.placement]));
        const align = fields['controlsAlign'] as { metadata?: unknown } | undefined;
        expect(align?.metadata, `${name} controlsAlign (${position})`).toEqual(PB_RESPONSIVE_METADATA);
        // R20F (T313): extended with the dots at the start, the arrows at the end.
        expect(optionValues(align)).toEqual(['center', 'start', 'end', 'between', 'split', 'dots-start']);
        expect(optionValues(fieldAt(fields, 'controls.nextArrowVariant'))).toEqual(['same', ...CAROUSEL_BEFORE_R7.arrowVariant]);
      }
      const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
      expect(defaults, name).not.toHaveProperty('controlsAlign');
      expect((defaults['controls'] ?? {}) as Record<string, unknown>, name).not.toHaveProperty('nextArrowVariant');
    },
  );

  it('cms.ContentSlider keeps its filter fields and adds the bar\'s style and alignment, pills at the start first', async () => {
    const block = (await R5_CAROUSELS['cms.ContentSlider']()) as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position);
      for (const path of CAROUSEL_BEFORE_R7.filter) expectCounterpart(fields, path, `${path} (${position})`);
      expect(optionValues(fieldAt(fields, 'filter.style'))).toEqual(['pills', 'underline']);
      expect(optionValues(fieldAt(fields, 'filter.align'))).toEqual(['start', 'center', 'end']);
    }
    expect((block.defaultProps ?? {}) as Record<string, unknown>).toMatchObject({ filter: { show: false, allLabel: '', tags: [] } });
  });

  it('cms.CarouselImage and cms.LinkTile keep every option and add the text\'s size and font role; the tile its label style', async () => {
    const image = (await import('./CarouselImage.js')).CarouselImage as unknown as ComponentConfig;
    const tile = (await import('./LinkTile.js')).LinkTile as unknown as ComponentConfig;
    const imageFields = await fieldsAt(image, 'nested', { captionSize: 'custom' });
    for (const key of CAROUSEL_IMAGE_BEFORE_R7) expectCounterpart(imageFields, key, `CarouselImage ${key}`);
    for (const key of ['captionSize', 'captionSizePx', 'captionFont']) expectCounterpart(imageFields, key, `CarouselImage ${key}`);
    const tileFields = await fieldsAt(tile, 'nested', { titleSize: 'custom', labelSize: 'custom' });
    for (const key of LINK_TILE_BEFORE_R7) expectCounterpart(tileFields, key, `LinkTile ${key}`);
    expect(optionValues(tileFields['ratio'])).toEqual(expect.arrayContaining(['1:1', '4:3', '3:4', '3:2', '16:9']));
    for (const key of ['titleSize', 'titleSizePx', 'titleFont', 'labelSize', 'labelSizePx', 'labelFont', 'labelStyle']) {
      expectCounterpart(tileFields, key, `LinkTile ${key}`);
    }
    expect(optionValues(tileFields['labelStyle'])).toEqual(['link', 'button', 'none']);
    for (const [name, block, added] of [
      ['CarouselImage', image, ['captionSize', 'captionSizePx', 'captionFont']],
      ['LinkTile', tile, ['titleSize', 'titleSizePx', 'titleFont', 'labelSize', 'labelSizePx', 'labelFont', 'labelStyle']],
    ] as const) {
      for (const key of added) expect((block.defaultProps ?? {}) as Record<string, unknown>, `${name}.${key}`).not.toHaveProperty(key);
    }
  });
});

// ── R8: text weight, heading measure, controls to the first slide (T151–T153) ──

/**
 * The fields each block offers on this branch before R8 (2026-10-26, after
 * T142–T149), at the top level with its default props (`layout: 'carousel'`
 * for the carousels), as literals. R8 adds a weight to headings and item
 * texts (T151), a measure to block headings and the hero title (T152), and
 * `controlsAlignTo` to the carousels (T153); nothing here may go, and no
 * addition is in `defaultProps`.
 */
const R8_BASELINE = {
  'cms.CtaCard': {
    load: async () => (await import('./CtaCard.js')).CtaCard,
    fields: ['hideOn', 'cardScheme', 'decorative', 'heading', 'headingLevel', 'body', 'list', 'listColumns', 'buttons', 'image', 'imageSide', 'headingSize'],
    added: ['headingWeight', 'headingMaxWidth'],
  },
  'cms.MediaText': {
    load: async () => (await import('./MediaText.js')).MediaText,
    fields: ['hideOn', 'heading', 'headingLevel', 'media', 'mediaSide', 'mobileOrder', 'split', 'verticalAlign', 'body', 'features', 'buttons', 'footnote', 'rows', 'headingSize'],
    added: ['headingWeight', 'headingMaxWidth'],
  },
  'cms.BackgroundPanel': {
    load: async () => (await import('./BackgroundPanel.js')).BackgroundPanel,
    fields: ['hideOn', 'image', 'textSide', 'mobileTextPosition', 'icon', 'iconAssetId', 'heading', 'headingLevel', 'body', 'buttons', 'headingSize', 'minHeight'],
    added: ['headingWeight', 'headingMaxWidth'],
  },
  'cms.LinkList': {
    load: async () => (await import('./LinkList.js')).LinkList,
    fields: ['hideOn', 'heading', 'headingLevel', 'items', 'divider', 'headingSize'],
    added: ['headingWeight', 'headingMaxWidth'],
  },
  'cms.FeatureList': {
    load: async () => (await import('./FeatureList.js')).FeatureList,
    fields: ['hideOn', 'heading', 'headingLevel', 'items', 'iconColor', 'iconSize', 'align', 'image', 'headingSize', 'columns', 'gap', 'titleSize', 'margin', 'padding', 'border'],
    added: ['headingWeight', 'headingMaxWidth', 'titleWeight'],
  },
  'cms.Stats': {
    load: async () => (await import('./Stats.js')).Stats,
    fields: ['hideOn', 'heading', 'headingLevel', 'image', 'items', 'align', 'valueColor', 'headingSize', 'columns', 'gap', 'valueSize', 'margin', 'padding', 'border'],
    added: ['headingWeight', 'headingMaxWidth'],
  },
  'cms.Statement': {
    load: async () => (await import('./Statement.js')).Statement,
    fields: ['hideOn', 'heading', 'headingLevel', 'body', 'align', 'background', 'reveal', 'headingSize', 'textMaxWidth'],
    added: ['headingWeight'],
  },
  'cms.ContentSlider': {
    load: async () => (await import('./ContentSlider.js')).ContentSlider,
    fields: ['hideOn', 'header', 'headingLevel', 'slides', 'layout', 'effect', 'controls', 'bleed', 'autoplay', 'intervalMs', 'equalHeight', 'filter', 'headingSize', 'slidesPerView', 'gap', 'controlsPlacement', 'controlsAlign', 'margin', 'padding', 'border'],
    added: ['headingWeight', 'headingMaxWidth', 'controlsAlignTo'],
  },
  'catalog.ProductGrid': {
    load: async () => (await import('./ProductGrid.js')).ProductGrid,
    fields: ['hideOn', 'source', 'equalItemHeight', 'header', 'headingLevel', 'cardVariant', 'cardTextLine', 'ctaLabel', 'footerButton', 'productSlugs', 'columns', 'gap', 'view', 'headingSize', 'margin', 'padding', 'border'],
    added: ['headingWeight', 'headingMaxWidth', 'cardTitleWeight'],
  },
  'catalog.ProductSlider': {
    load: async () => (await import('./ProductSlider.js')).ProductSlider,
    fields: ['hideOn', 'source', 'header', 'headingLevel', 'cardVariant', 'cardTextLine', 'ctaLabel', 'effect', 'controls', 'bleed', 'autoplay', 'intervalMs', 'equalHeight', 'footerButton', 'productSlugs', 'headingSize', 'slidesPerView', 'gap', 'controlsPlacement', 'controlsAlign', 'margin', 'padding', 'border'],
    added: ['headingWeight', 'headingMaxWidth', 'cardTitleWeight', 'controlsAlignTo'],
  },
  'blog.LatestPosts': {
    load: async () => (await import('./LatestPosts.js')).LatestPosts,
    fields: ['hideOn', 'header', 'headingLevel', 'limit', 'categorySlug', 'layout', 'readMoreLabel', 'effect', 'controls', 'bleed', 'autoplay', 'intervalMs', 'equalHeight', 'headingSize', 'slidesPerView', 'gap', 'controlsPlacement', 'controlsAlign'],
    added: ['headingWeight', 'headingMaxWidth', 'controlsAlignTo'],
  },
  'cms.Hero': {
    load: async () => (await import('./Hero.js')).Hero,
    fields: ['hideOn', 'media', 'mediaPlacement', 'mediaWidth', 'overlay', 'textColor', 'eyebrow', 'title', 'titleLevel', 'subheading', 'subheadingLevel', 'statement', 'statementLevel', 'body', 'buttons', 'socialProof', 'order', 'align', 'spaceAfter', 'reveal', 'cornerRadius', 'shadow', 'titleSize', 'subheadingSize', 'statementSize', 'minHeight', 'gaps', 'margin', 'padding', 'border'],
    added: ['titleWeight', 'titleMaxWidth'],
  },
  'cms.CarouselImage': {
    load: async () => (await import('./CarouselImage.js')).CarouselImage,
    fields: ['hideOn', 'image', 'caption', 'mediaCornerRadius', 'captionPlacement', 'captionFont', 'captionStyle', 'captionScrim', 'link', 'hoverZoom', 'tags', 'captionSize'],
    added: ['captionWeight'],
  },
  'cms.LinkTile': {
    load: async () => (await import('./LinkTile.js')).LinkTile,
    fields: ['hideOn', 'image', 'mediaCornerRadius', 'title', 'titleFont', 'linkLabel', 'labelStyle', 'labelFont', 'link', 'hoverZoom', 'tags', 'ratio', 'titleSize', 'labelSize'],
    added: ['titleWeight', 'labelWeight'],
  },
} as const;

describe('option parity — R8 text weight, heading measure and controls to the first slide (T151–T153)', () => {
  it.each(Object.keys(R8_BASELINE) as Array<keyof typeof R8_BASELINE>)(
    '%s keeps every field it had before R8 and offers the additions, none of them in defaultProps',
    async (name) => {
      const entry = R8_BASELINE[name];
      const block = (await entry.load()) as unknown as ComponentConfig;
      const resolved = await fieldsAt(block, 'top', { layout: 'carousel' });
      const offered = Object.keys(resolved);
      expect(offered, name).toEqual(expect.arrayContaining(expectMovedOrOffered(resolved, entry.fields, name)));
      expect(offered, `${name} additions`).toEqual(expect.arrayContaining([...entry.added]));
      const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
      for (const key of entry.added) expect(defaults, `${name}.${key}`).not.toHaveProperty(key);
    },
  );

  it('a weight is Default (the block\'s own) first, then 300–800; a measure has no width first; the first slide is not the default', async () => {
    const tile = await fieldsAt((await R8_BASELINE['cms.LinkTile'].load()) as unknown as ComponentConfig, 'top');
    expect(optionValues(tile['titleWeight'])).toEqual(['default', 300, 400, 500, 600, 700, 800]);
    const hero = await fieldsAt((await R8_BASELINE['cms.Hero'].load()) as unknown as ComponentConfig, 'top');
    expect(optionValues(hero['titleMaxWidth'])).toEqual(['none', 'narrow', 'medium', 'wide', 'custom']);
    expect((hero['titleMaxWidth'] as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    const slider = await fieldsAt((await R8_BASELINE['cms.ContentSlider'].load()) as unknown as ComponentConfig, 'top', { layout: 'carousel' });
    expect(optionValues(slider['controlsAlignTo'])).toEqual(['container', 'slide']);
  });
});

// ── R8: the tab bar on narrow screens, a Column's distribution, a block's order (T155, T156) ──

/**
 * `cms.Tabs`' and `cms.Column`'s fields on this branch before R8 (2026-10-26,
 * after T146), as literals, and a block's own fields in a Column (`cms.Text`,
 * whose `hideOn` is the shared wrapper's). R8 adds `barOverflow` to the Tabs,
 * `distribute` to the Column and the wrapper's `stackOrder` (Responsive tab) to
 * a block whose parent is a Column; nothing here may go, and none of the
 * additions is in `defaultProps`.
 */
const TABS_BEFORE_R8 = ['items', 'defaultTab', 'variant', 'effect', 'align', 'tabStyle', 'panelGap', 'margin', 'padding', 'border'] as const;
const COLUMN_BEFORE_R8 = {
  hideOn: null,
  span: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  content: null,
  margin: null,
  padding: null,
  border: null,
  background: null,
  cornerRadius: null,
  shadow: null,
} as const;

describe('option parity — R8 tab bar overflow, column distribution and block order (T155, T156)', () => {
  it('cms.Tabs keeps every field and offers wrap (today) or scroll for the bar, unset by default', async () => {
    const block = (await import('./Tabs.js')).Tabs as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position);
      for (const key of TABS_BEFORE_R8) expectCounterpart(fields, key, `Tabs ${key} (${position})`);
      expect(optionValues(fields['barOverflow']), position).toEqual(['wrap', 'scroll']);
    }
    expect((block.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('barOverflow');
  });

  it('cms.Column keeps every field and option, and offers the vertical distribution, start (today) first, unset by default', async () => {
    const block = (await import('./Column.js')).Column as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'nested');
    for (const [key, values] of Object.entries(COLUMN_BEFORE_R8)) {
      expectCounterpart(fields, key, `Column ${key}`);
      if (values) expect(optionValues(fields[key]), key).toEqual([...values]);
    }
    expect(optionValues(fields['distribute'])).toEqual(['start', 'center', 'end', 'space-between', 'last-to-bottom']);
    expect((block.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('distribute');
  });

  it('a block in a Column keeps its fields and offers its order per breakpoint; elsewhere the order is not offered', async () => {
    const block = (await import('./Text.js')).Text as unknown as ComponentConfig;
    const top = Object.keys(await fieldsAt(block, 'top'));
    const nested = await fieldsAt(block, 'nested');
    // The block's own (resolved) fields are the same in a column; the order is the one addition.
    expect(Object.keys(nested)).toEqual([...top, 'stackOrder']);
    expect(top).toEqual(expect.arrayContaining(['hideOn', 'text', 'margin', 'padding', 'border']));
    const order = nested['stackOrder'] as { metadata?: unknown } | undefined;
    // R17 (T200, deliberately changed): also marked as the shared field translated once in `core`.
    expect(order?.metadata).toMatchObject(PB_RESPONSIVE_METADATA);
    expect(optionValues(order)).toEqual(['auto', 'first', '1', '2', '3', '4', '5', '6', 'last']);
    expect(top).not.toContain('stackOrder');
    expect((block.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('stackOrder');
  });
});

// ── R9: a Column's order, MediaText feature titles, the filter bar overflow, mobile posters (T159–T162) ──

/**
 * The options `cms.Column`, `cms.MediaText`, `cms.ContentSlider`'s filter,
 * `cms.Video` (file source) and the hero's video media offer on this branch
 * before R9 (2026-10-26, after T150–T156), as literals. R9 adds a Column's
 * order per breakpoint (T159), the feature titles' size and weight (T160), the
 * filter bar's overflow (T161) and a mobile poster (T162); nothing here may go,
 * and no addition is in `defaultProps`.
 */
const R9_BEFORE = {
  column: ['hideOn', 'span', 'distribute', 'content', 'margin', 'padding', 'border', 'background', 'cornerRadius', 'shadow'],
  mediaText: [
    'hideOn', 'heading', 'headingLevel', 'headingWeight', 'headingMaxWidth', 'media', 'mediaSide', 'mobileOrder', 'split',
    'verticalAlign', 'body', 'features', 'buttons', 'footnote', 'rows', 'headingSize',
  ],
  mediaTextMedia: ['kind', 'image', 'videoSource', 'videoAssetId', 'videoUrl', 'mobileVideoAssetId', 'mobileVideoUrl', 'posterAssetId', 'ratio', 'autoplay'],
  heroMedia: ['kind', 'color', 'from', 'to', 'angle', 'image', 'videoSource', 'videoUrl', 'videoAssetId', 'mobileVideoAssetId', 'mobileVideoUrl', 'posterAssetId', 'ratio'],
  video: [
    'source', 'url', 'videoAssetId', 'mobileVideoAssetId', 'mobileUrl', 'posterAssetId', 'aspectRatio', 'mediaCornerRadius',
    'title', 'autoplay', 'muted', 'loop', 'controls', 'maxWidth', 'align', 'margin', 'padding', 'border',
  ],
  filter: ['show', 'allLabel', 'tags', 'style', 'align'],
} as const;

describe('option parity — R9 column order, feature titles, filter overflow, mobile posters (T159–T162)', () => {
  it('T159 cms.Column keeps every field and offers its order in the row per breakpoint, as placed first, unset by default', async () => {
    const block = (await import('./Column.js')).Column as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'nested');
    expect(Object.keys(fields)).toEqual(expect.arrayContaining([...R9_BEFORE.column]));
    expect(optionValues(fields['span'])).toEqual([...COLUMN_BEFORE_R8.span]);
    const order = fields['stackOrder'] as { metadata?: unknown } | undefined;
    expect(order?.metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect(optionValues(order)).toEqual(['auto', 'first', '1', '2', '3', '4', '5', '6', 'last']);
    expect((block.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('stackOrder');
  });

  it('T160 cms.MediaText keeps every field and offers the feature titles\' size (Default first, per breakpoint, Custom px) and weight', async () => {
    const block = (await import('./MediaText.js')).MediaText as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position, { featureTitleSize: 'custom' });
      expect(Object.keys(fields), position).toEqual(expect.arrayContaining([...R9_BEFORE.mediaText, 'featureTitleSize', 'featureTitleSizePx', 'featureTitleWeight']));
      const size = fields['featureTitleSize'] as { metadata?: unknown };
      expect(size.metadata).toEqual(PB_RESPONSIVE_METADATA);
      expect(optionValues(size)).toEqual(['default', 'display', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'lead', 'body', 'small', 'custom']);
      expect((fields['featureTitleSizePx'] as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
      expect(optionValues(fields['featureTitleWeight'])).toEqual(['default', 300, 400, 500, 600, 700, 800]);
    }
    expect(Object.keys(await fieldsAt(block, 'top'))).not.toContain('featureTitleSizePx');
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['featureTitleSize', 'featureTitleSizePx', 'featureTitleWeight']) expect(defaults).not.toHaveProperty(key);
  });

  it('T161 cms.ContentSlider keeps its filter fields and offers wrap (today) or one scrolling line, unset by default', async () => {
    const block = (await import('./ContentSlider.js')).ContentSlider as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position);
      for (const key of R9_BEFORE.filter) expectCounterpart(fields, `filter.${key}`, `filter.${key} (${position})`);
      expect(optionValues(fieldAt(fields, 'filter.overflow'))).toEqual(['wrap', 'scroll']);
    }
    expect(((block.defaultProps ?? {}) as { filter?: Record<string, unknown> }).filter).not.toHaveProperty('overflow');
  });

  it('T162 the video media keep every option and add a mobile poster, asset or URL, unset by default', async () => {
    const video = (await import('./Video.js')).Video as unknown as ComponentConfig;
    const file = Object.keys(await fieldsAcrossSources(video, 'top', { source: 'file' }));
    expect(file).toEqual(expect.arrayContaining([...R9_BEFORE.video, 'mobilePosterAssetId', 'mobilePosterUrl']));
    const embed = Object.keys(await fieldsAt(video, 'top', { source: 'embed' }));
    expect(embed).not.toContain('mobilePosterAssetId');
    expect(embed).not.toContain('mobilePosterUrl');

    const hero = (await import('./Hero.js')).Hero as unknown as ComponentConfig;
    const mediaText = (await import('./MediaText.js')).MediaText as unknown as ComponentConfig;
    for (const [name, block, before] of [
      ['Hero', hero, R9_BEFORE.heroMedia],
      ['MediaText', mediaText, R9_BEFORE.mediaTextMedia],
    ] as const) {
      const fields = await fieldsAt(block, 'top');
      for (const key of [...before, 'mobilePosterAssetId', 'mobilePosterUrl']) expectCounterpart(fields, `media.${key}`, `${name} media.${key}`);
      const media = ((block.defaultProps ?? {}) as { media?: Record<string, unknown> }).media ?? {};
      expect(media, name).not.toHaveProperty('mobilePosterAssetId');
      expect(media, name).not.toHaveProperty('mobilePosterUrl');
    }
    const rows = (await fieldsAt(mediaText, 'top'))['rows'] as { arrayFields: Fields };
    expect(Object.keys((rows.arrayFields['media'] as { objectFields: Fields }).objectFields)).toEqual(
      expect.arrayContaining(['mobilePosterAssetId', 'mobilePosterUrl']),
    );
    for (const key of ['mobilePosterAssetId', 'mobilePosterUrl']) expect((video.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty(key);
  });
});

// ── R9: cosmetic options — the tab size per breakpoint, the carousel arrow icon (T163) ──

/**
 * `cms.Tabs`' fields and the carousels' `controls` sub-fields on this branch
 * before T163 (2026-10-26, after T155 and T147), as literals. T163 adds the
 * tab size per breakpoint (`tabSize`, which takes over `tabStyle.size` with
 * its three values) and the arrows' icon (`controls.arrowIcon`, the chevron of
 * today first); nothing here may go and neither addition is in `defaultProps`.
 */
const T163_BEFORE = {
  tabs: ['items', 'defaultTab', 'variant', 'effect', 'align', 'tabStyle', 'barOverflow', 'panelGap', 'margin', 'padding', 'border'],
  tabStyle: ['barBackground', 'barBorderColor', 'activeBackground', 'activeColor', 'inactiveBackground', 'inactiveColor'],
  tabSize: ['s', 'm', 'l'],
  controls: ['arrows', 'dots', 'arrowVariant', 'arrowShape', 'arrowSize', 'arrowColor', 'nextArrowVariant'],
} as const;

describe('option parity — R9 tab size per breakpoint and the carousel arrow icon (T163)', () => {
  it('cms.Tabs keeps every field and offers the tab size per breakpoint, unset by default', async () => {
    const block = (await import('./Tabs.js')).Tabs as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position);
      for (const key of T163_BEFORE.tabs) expectCounterpart(fields, key, `Tabs ${key} (${position})`);
      for (const key of T163_BEFORE.tabStyle) expectCounterpart(fields, `tabStyle.${key}`, `Tabs tabStyle.${key} (${position})`);
      const size = fields['tabSize'] as { metadata?: unknown } | undefined;
      expect(size?.metadata, position).toEqual(PB_RESPONSIVE_METADATA);
      expect(optionValues(size), position).toEqual([...T163_BEFORE.tabSize]);
    }
    expect((block.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('tabSize');
  });

  it.each(['cms.ContentSlider', 'catalog.ProductSlider', 'blog.LatestPosts'] as const)(
    '%s keeps every control and offers the arrow icon, the chevron of today first, unset by default',
    async (name) => {
      const block = (await R5_CAROUSELS[name]()) as unknown as ComponentConfig;
      for (const position of ['top', 'nested'] as const) {
        const fields = await fieldsAt(block, position, { layout: 'carousel' });
        for (const key of T163_BEFORE.controls) expectCounterpart(fields, `controls.${key}`, `${name} controls.${key} (${position})`);
        expect(optionValues(fieldAt(fields, 'controls.arrowIcon')), position).toEqual(['chevron', 'arrow']);
      }
      const controls = ((block.defaultProps ?? {}) as { controls?: Record<string, unknown> }).controls ?? {};
      expect(controls).not.toHaveProperty('arrowIcon');
    },
  );
});

// ── R10: a Column's placement in its Row's grid (T165) ──

/**
 * The fields `cms.Column` offers on this branch before R10 (2026-10-26, after
 * T159), as literals. R10 adds the row span, the column start and the row
 * start per breakpoint (T165); nothing here may go, and no addition is in
 * `defaultProps`.
 */
const T165_BEFORE = {
  column: ['hideOn', 'span', 'stackOrder', 'distribute', 'content', 'margin', 'padding', 'border', 'background', 'cornerRadius', 'shadow'],
  stackOrder: ['auto', 'first', '1', '2', '3', '4', '5', '6', 'last'],
  distribute: ['start', 'center', 'end', 'space-between', 'last-to-bottom'],
} as const;

describe('option parity — R10 column placement in the row grid (T165)', () => {
  it('cms.Column keeps every field and offers its row span, column start and row start per breakpoint, unset by default', async () => {
    const block = (await import('./Column.js')).Column as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'nested');
    for (const key of T165_BEFORE.column) expectCounterpart(fields, key, `Column ${key}`);
    expect(optionValues(fields['span'])).toEqual([...COLUMN_BEFORE_R8.span]);
    expect(optionValues(fields['stackOrder'])).toEqual([...T165_BEFORE.stackOrder]);
    expect(optionValues(fields['distribute'])).toEqual([...T165_BEFORE.distribute]);
    const placement = {
      rowSpan: [1, 2, 3, 4],
      columnStart: ['auto', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      rowStart: ['auto', '1', '2', '3', '4'],
    };
    for (const [name, values] of Object.entries(placement)) {
      const field = fields[name] as { metadata?: unknown } | undefined;
      expect(field?.metadata, name).toEqual(PB_RESPONSIVE_METADATA);
      expect(optionValues(field), name).toEqual(values);
      expect((block.defaultProps ?? {}) as Record<string, unknown>, name).not.toHaveProperty(name);
    }
  });
});

// ── R10: the card's image box and divider, full-width buttons per breakpoint (T168) ──

/**
 * The top-level fields of `catalog.ProductGrid`, `catalog.ProductSlider`,
 * `cms.Button` and the blocks with a button list on this branch before T168
 * (2026-10-26, after T163), as literals, and the properties of one
 * `ButtonSpec`. T168 adds the card's image box background and a divider under
 * the card to the listings, a full width per breakpoint to `cms.Button`
 * (`fullWidth`, top level) and to each button list (`buttonsFullWidth`, block
 * level — never inside the nested spec); nothing here may go and no addition
 * is in `defaultProps`.
 */
const T168_BEFORE = {
  'catalog.ProductGrid': [
    'hideOn', 'source', 'equalItemHeight', 'columns', 'gap', 'view', 'header', 'headingLevel', 'headingSize', 'headingWeight',
    'headingMaxWidth', 'cardVariant', 'cardTextLine', 'cardTitleWeight', 'ctaLabel', 'footerButton', 'margin', 'padding', 'border', 'productSlugs',
  ],
  'catalog.ProductSlider': [
    'hideOn', 'source', 'header', 'headingLevel', 'headingSize', 'headingWeight', 'headingMaxWidth', 'cardVariant', 'cardTextLine',
    'cardTitleWeight', 'ctaLabel', 'slidesPerView', 'gap', 'gapPx', 'effect', 'controls', 'controlsPlacement', 'controlsAlign',
    'controlsAlignTo', 'bleed', 'autoplay', 'intervalMs', 'equalHeight', 'footerButton', 'margin', 'padding', 'border', 'productSlugs',
  ],
  'cms.Button': ['hideOn', 'button', 'align', 'margin', 'padding', 'border'],
  'cms.Hero': [
    'hideOn', 'media', 'mediaPlacement', 'mediaWidth', 'overlay', 'textColor', 'eyebrow', 'title', 'titleLevel', 'titleSize', 'titleWeight',
    'titleMaxWidth', 'subheading', 'subheadingLevel', 'subheadingSize', 'statement', 'statementLevel', 'statementSize', 'body', 'buttons',
    'socialProof', 'order', 'align', 'minHeight', 'spaceAfter', 'gaps', 'reveal', 'cornerRadius', 'shadow', 'margin', 'padding', 'border',
  ],
  'cms.MediaText': [
    'hideOn', 'heading', 'headingLevel', 'headingSize', 'headingWeight', 'headingMaxWidth', 'media', 'mediaSide', 'mobileOrder', 'split',
    'verticalAlign', 'body', 'features', 'featureTitleSize', 'featureTitleWeight', 'buttons', 'footnote', 'rows',
  ],
  'cms.CtaCard': [
    'hideOn', 'cardScheme', 'decorative', 'heading', 'headingLevel', 'headingSize', 'headingWeight', 'headingMaxWidth', 'body', 'list',
    'listColumns', 'buttons', 'image', 'imageSide',
  ],
  'cms.BackgroundPanel': [
    'hideOn', 'image', 'textSide', 'mobileTextPosition', 'icon', 'iconAssetId', 'heading', 'headingLevel', 'headingSize', 'headingWeight',
    'headingMaxWidth', 'body', 'buttons', 'minHeight',
  ],
  'cms.CarouselSplit': ['hideOn', 'media', 'mediaSide', 'icon', 'iconAssetId', 'title', 'body', 'buttons', 'hoverZoom', 'tags'],
} as const;
const T168_BUTTON_SPEC = ['label', 'link', 'style', 'fill', 'size', 'icon', 'iconPosition', 'backgroundColor', 'textColor'] as const;

const T168_BLOCKS = {
  'catalog.ProductGrid': async () => (await import('./ProductGrid.js')).ProductGrid,
  'catalog.ProductSlider': async () => (await import('./ProductSlider.js')).ProductSlider,
  'cms.Button': async () => (await import('./Button.js')).Button,
  'cms.Hero': async () => (await import('./Hero.js')).Hero,
  'cms.MediaText': async () => (await import('./MediaText.js')).MediaText,
  'cms.CtaCard': async () => (await import('./CtaCard.js')).CtaCard,
  'cms.BackgroundPanel': async () => (await import('./BackgroundPanel.js')).BackgroundPanel,
  'cms.CarouselSplit': async () => (await import('./CarouselSplit.js')).CarouselSplit,
} as const;

describe('option parity — R10 card image box and divider, full-width buttons (T168)', () => {
  it.each(['catalog.ProductGrid', 'catalog.ProductSlider'] as const)(
    '%s keeps every field and offers the card image background and a divider (none first), unset by default',
    async (name) => {
      const block = (await T168_BLOCKS[name]()) as unknown as ComponentConfig;
      for (const position of ['top', 'nested'] as const) {
        const offered = Object.keys(await fieldsAt(block, position));
        expect(offered, `${name} (${position})`).toEqual(expect.arrayContaining([...T168_BEFORE[name], 'cardImageBackground', 'cardDivider']));
        // The divider's colour shows once a line is chosen.
        expect(offered, position).not.toContain('cardDividerColor');
        const lined = await fieldsAt(block, position, { cardDivider: 'line' });
        expect(Object.keys(lined), position).toContain('cardDividerColor');
        expect(optionValues(lined['cardDivider'])).toEqual(['none', 'line']);
        expect((lined['cardImageBackground'] as { type?: string }).type).toBe('custom');
      }
      const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
      for (const key of ['cardImageBackground', 'cardDivider', 'cardDividerColor']) expect(defaults, `${name}.${key}`).not.toHaveProperty(key);
    },
  );

  it('cms.Button keeps every field and its ButtonSpec, and offers the full width per breakpoint at the top level, unset by default', async () => {
    const block = (await T168_BLOCKS['cms.Button']()) as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position);
      expect(Object.keys(fields), position).toEqual(expect.arrayContaining([...T168_BEFORE['cms.Button'], 'fullWidth']));
      const spec = Object.keys((fields['button'] as { objectFields: Fields }).objectFields);
      expect(spec).toEqual([...T168_BUTTON_SPEC]);
      const full = fields['fullWidth'] as { metadata?: unknown };
      expect(full.metadata).toEqual(PB_RESPONSIVE_METADATA);
      expect(optionValues(full)).toEqual(['auto', 'full']);
    }
    expect((block.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('fullWidth');
  });

  it.each(['cms.Hero', 'cms.MediaText', 'cms.CtaCard', 'cms.BackgroundPanel', 'cms.CarouselSplit'] as const)(
    '%s keeps every field and offers its buttons\' full width per breakpoint at the block level, unset by default',
    async (name) => {
      const block = (await T168_BLOCKS[name]()) as unknown as ComponentConfig;
      for (const position of ['top', 'nested'] as const) {
        const fields = await fieldsAt(block, position);
        expect(Object.keys(fields), `${name} (${position})`).toEqual(
          expect.arrayContaining([...expectMovedOrOffered(fields, T168_BEFORE[name], `${name} (${position})`), 'buttonsFullWidth']),
        );
        const full = fields['buttonsFullWidth'] as { metadata?: unknown };
        expect(full.metadata).toEqual(PB_RESPONSIVE_METADATA);
        expect(optionValues(full)).toEqual(['auto', 'full']);
        // Nothing is added inside a button of the list.
        const buttons = fields['buttons'] as { arrayFields?: Fields } | undefined;
        if (buttons?.arrayFields) expect(Object.keys(buttons.arrayFields)).not.toContain('fullWidth');
      }
      expect((block.defaultProps ?? {}) as Record<string, unknown>, name).not.toHaveProperty('buttonsFullWidth');
    },
  );
});

// ── R10: background size, repeat and position (T167) ──────────────────

/**
 * The background field of `cms.Section` and `cms.SectionGroup` on this branch
 * before T167 (2026-10-26, after T158), as literals: its kinds, the image's
 * focal position and the decorative toggle. T167 adds, for an image, its size
 * and repeat, and for the decorative layer its size, repeat and position — each
 * showing today's value (`cover`, no repeat; the layer from the top) until
 * changed, and none of them written by default. The field is one composite
 * control, so it is rendered (server-side) and its selects read by name.
 */
const T167_BEFORE = {
  kinds: ['none', 'solid', 'gradient', 'image', 'video'],
  imagePosition: ['center', 'top', 'bottom', 'left', 'right'],
} as const;

/** The block's background field rendered on the server with `value`, as HTML. */
async function backgroundControl(block: ComponentConfig, value: Record<string, unknown>): Promise<string> {
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const field = (await fieldsAt(block, 'top'))['background'] as unknown as { render: (props: Record<string, unknown>) => unknown };
  const html = renderToString(
    createElement(field.render as never, { field, name: 'background', id: 'background', value, onChange: () => undefined }),
  );
  return html;
}

/** The option values of the `<select aria-label="…">` in `html`, and the selected one. */
function selectNamed(html: string, label: string): { options: string[]; selected: string | null } | null {
  const match = new RegExp(`<select aria-label="${label.replace(/[()]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  if (!match) return null;
  const options = [...match[1]!.matchAll(/<option value="([^"]*)"( selected="")?/g)];
  return { options: options.map((option) => option[1]!), selected: options.find((option) => option[2])?.[1] ?? null };
}

describe('option parity — R10 background size, repeat and position on a Section and a Section group (T167)', () => {
  it.each(['cms.Section', 'cms.SectionGroup'] as const)('%s keeps its background kinds and focal position, and offers the image size and repeat', async (name) => {
    const block = (
      name === 'cms.Section' ? (await import('./SectionBlock.js')).Section : (await import('./SectionGroupBlock.js')).SectionGroup
    ) as unknown as ComponentConfig;
    const html = await backgroundControl(block, { kind: 'image' });
    expect(selectNamed(html, 'Background')?.options).toEqual([...T167_BEFORE.kinds]);
    expect(selectNamed(html, 'Image position')).toEqual({ options: [...T167_BEFORE.imagePosition], selected: 'center' });
    expect(selectNamed(html, 'Image size')).toEqual({ options: ['cover', 'contain', 'auto', 'px', 'percent'], selected: 'cover' });
    expect(selectNamed(html, 'Image repeat')).toEqual({ options: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'], selected: 'no-repeat' });
    expect(html).toContain('Decorative backdrop (dark scheme)');
    // The decorative layer's own options show only once it is on.
    expect(selectNamed(html, 'Backdrop size')).toBeNull();
  });

  it.each(['cms.Section', 'cms.SectionGroup'] as const)('%s offers the decorative layer\'s size, repeat and position with its toggle, today\'s values shown', async (name) => {
    const block = (
      name === 'cms.Section' ? (await import('./SectionBlock.js')).Section : (await import('./SectionGroupBlock.js')).SectionGroup
    ) as unknown as ComponentConfig;
    const html = await backgroundControl(block, { kind: 'solid', color: '#000000', decorative: true });
    expect(selectNamed(html, 'Backdrop size')).toEqual({ options: ['cover', 'contain', 'auto', 'px', 'percent'], selected: 'cover' });
    expect(selectNamed(html, 'Backdrop repeat')).toEqual({ options: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'], selected: 'no-repeat' });
    expect(selectNamed(html, 'Backdrop position')).toEqual({ options: [...T167_BEFORE.imagePosition], selected: 'top' });
    // Not an image: no image size or repeat.
    expect(selectNamed(html, 'Image size')).toBeNull();
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    expect(defaults).not.toHaveProperty('background');
  });
});

// ── R11: the tabs' hover look and an animated panel change (T174) ──

/**
 * `cms.Tabs`' fields, `tabStyle` sub-fields and `effect` values on this branch
 * before T174 (2026-10-26, after T163), as literals. T174 adds the tabs' hover
 * colours (`tabStyle.hoverBackground`, `tabStyle.hoverColor`) and a third panel
 * change (`slide`, after today's `none` and `fade`); nothing here may go, the
 * default stays `none` and no hover colour is in `defaultProps`.
 */
const T174_BEFORE = {
  tabs: ['items', 'defaultTab', 'variant', 'effect', 'align', 'tabStyle', 'tabSize', 'barOverflow', 'panelGap', 'margin', 'padding', 'border'],
  tabStyle: ['barBackground', 'barBorderColor', 'activeBackground', 'activeColor', 'inactiveBackground', 'inactiveColor'],
  effect: ['none', 'fade'],
} as const;

describe('option parity — R11 tab hover look and panel change (T174)', () => {
  it('cms.Tabs keeps every field and effect, and offers hover colours and a slide, unset by default', async () => {
    const block = (await import('./Tabs.js')).Tabs as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position);
      for (const key of T174_BEFORE.tabs) expectCounterpart(fields, key, `Tabs ${key} (${position})`);
      for (const key of T174_BEFORE.tabStyle) expectCounterpart(fields, `tabStyle.${key}`, `Tabs tabStyle.${key} (${position})`);
      for (const key of ['hoverBackground', 'hoverColor']) expectCounterpart(fields, `tabStyle.${key}`, `Tabs tabStyle.${key} (${position})`);
      expect(optionValues(fields['effect']), position).toEqual([...T174_BEFORE.effect, 'slide']);
    }
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    expect(defaults['effect']).toBe('none');
    expect(defaults).not.toHaveProperty('tabStyle');
  });
});

// ── R11: carousel ends and the hover look of carousel items and tiles (T171, T172) ──

/**
 * The three carousels' top-level fields and `controls` sub-fields, and the
 * two item blocks' fields, on this branch before R11 (2026-10-26, after T163
 * and T168), as literals. T171 adds `loop` (unset = today's wrap-around at
 * the ends) and the disabled arrows' look (`controls.disabledArrowLook`,
 * `controls.disabledArrowColor`); T172 adds a hover colour to the carousel
 * image's caption and the link tile's title and label. Nothing here may go,
 * and none of the additions is in `defaultProps`.
 */
const R11_CAROUSEL_CONTROLS_BEFORE = ['arrows', 'dots', 'arrowVariant', 'arrowShape', 'arrowSize', 'arrowIcon', 'arrowColor', 'nextArrowVariant'] as const;
const R11_CAROUSELS = {
  'cms.ContentSlider': {
    load: async () => (await import('./ContentSlider.js')).ContentSlider,
    fields: ['hideOn', 'header', 'headingLevel', 'slides', 'layout', 'effect', 'controls', 'bleed', 'autoplay', 'intervalMs', 'equalHeight', 'filter', 'headingSize', 'slidesPerView', 'gap', 'controlsPlacement', 'controlsAlign', 'controlsAlignTo', 'headingWeight', 'headingMaxWidth', 'margin', 'padding', 'border'],
  },
  'catalog.ProductSlider': {
    load: async () => (await import('./ProductSlider.js')).ProductSlider,
    fields: ['hideOn', 'source', 'header', 'headingLevel', 'cardVariant', 'cardTextLine', 'ctaLabel', 'effect', 'controls', 'bleed', 'autoplay', 'intervalMs', 'equalHeight', 'footerButton', 'productSlugs', 'headingSize', 'slidesPerView', 'gap', 'controlsPlacement', 'controlsAlign', 'controlsAlignTo', 'headingWeight', 'headingMaxWidth', 'cardTitleWeight', 'margin', 'padding', 'border'],
  },
  'blog.LatestPosts': {
    load: async () => (await import('./LatestPosts.js')).LatestPosts,
    fields: ['hideOn', 'header', 'headingLevel', 'limit', 'categorySlug', 'layout', 'readMoreLabel', 'effect', 'controls', 'bleed', 'autoplay', 'intervalMs', 'equalHeight', 'headingSize', 'slidesPerView', 'gap', 'controlsPlacement', 'controlsAlign', 'controlsAlignTo', 'headingWeight', 'headingMaxWidth'],
  },
} as const;
const R11_ITEMS = {
  'cms.CarouselImage': {
    load: async () => (await import('./CarouselImage.js')).CarouselImage,
    fields: ['hideOn', 'image', 'caption', 'mediaCornerRadius', 'captionPlacement', 'captionFont', 'captionStyle', 'captionScrim', 'link', 'hoverZoom', 'tags', 'captionSize', 'captionWeight'],
    added: ['captionHoverColor'],
  },
  'cms.LinkTile': {
    load: async () => (await import('./LinkTile.js')).LinkTile,
    fields: ['hideOn', 'image', 'mediaCornerRadius', 'title', 'titleFont', 'linkLabel', 'labelStyle', 'labelFont', 'link', 'hoverZoom', 'tags', 'ratio', 'titleSize', 'labelSize', 'titleWeight', 'labelWeight'],
    added: ['titleHoverColor', 'labelHoverColor'],
  },
} as const;

describe('option parity — R11 carousel ends and item hover look (T171, T172)', () => {
  it.each(Object.keys(R11_CAROUSELS) as Array<keyof typeof R11_CAROUSELS>)(
    '%s keeps every field and control, and offers the loop and the disabled arrows\' look, none in defaultProps',
    async (name) => {
      const block = (await R11_CAROUSELS[name].load()) as unknown as ComponentConfig;
      const fields = await fieldsAt(block, 'top', { layout: 'carousel' });
      for (const key of R11_CAROUSELS[name].fields) expectCounterpart(fields, key, `${name} ${key}`);
      for (const key of R11_CAROUSEL_CONTROLS_BEFORE) expectCounterpart(fields, `controls.${key}`, `${name} controls.${key}`);
      expectCounterpart(fields, 'loop', `${name} loop`);
      expectCounterpart(fields, 'controls.disabledArrowLook', `${name} controls.disabledArrowLook`);
      expectCounterpart(fields, 'controls.disabledArrowColor', `${name} controls.disabledArrowColor`);
      // Looping first: an unset value is today's wrap-around.
      expect(optionValues(fields['loop']), name).toEqual([true, false]);
      const controls = fields['controls'] as { objectFields: Fields };
      expect(optionValues(controls.objectFields['disabledArrowLook']), name).toEqual(['dim', 'outline-light', 'color']);
      const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
      expect(defaults, name).not.toHaveProperty('loop');
      const defaultControls = (defaults['controls'] ?? {}) as Record<string, unknown>;
      expect(defaultControls, name).not.toHaveProperty('disabledArrowLook');
      expect(defaultControls, name).not.toHaveProperty('disabledArrowColor');
    },
  );

  it.each(Object.keys(R11_ITEMS) as Array<keyof typeof R11_ITEMS>)(
    '%s keeps every field and offers a hover colour, none in defaultProps',
    async (name) => {
      const block = (await R11_ITEMS[name].load()) as unknown as ComponentConfig;
      const fields = await fieldsAt(block, 'top');
      for (const key of [...R11_ITEMS[name].fields, ...R11_ITEMS[name].added]) expectCounterpart(fields, key, `${name} ${key}`);
      const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
      for (const key of R11_ITEMS[name].added) expect(defaults, `${name}.${key}`).not.toHaveProperty(key);
    },
  );
});

// ── R11: the accordion's look (T175) ──

/**
 * The fields `cms.Accordion` offers on this branch before R11 (2026-10-26,
 * after T134), with the option values of its selects, as literals. R11 adds
 * the icon, the dividers, the item style and the title padding (+ its Custom
 * px); nothing here may go, every option value stays, and no addition is in
 * `defaultProps`.
 */
const T175_BEFORE = {
  fields: ['hideOn', 'items', 'allowMultiple', 'defaultOpen', 'iconPosition', 'variant', 'titleLevel', 'titleSize', 'titleSizePx', 'margin', 'padding', 'border'],
  items: ['title', 'panel'],
  allowMultiple: [true, false],
  iconPosition: ['start', 'end'],
  variant: ['default', 'flush', 'bordered'],
  titleLevel: ['none', 'h2', 'h3', 'h4', 'h5', 'h6'],
} as const;

describe('option parity — R11 the accordion\'s icon, dividers, item style and title padding (T175)', () => {
  it('cms.Accordion keeps every field and option value, and offers the look, none in defaultProps', async () => {
    const block = (await import('./Accordion.js')).Accordion as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position, { titleSize: 'custom', titlePadding: 'custom' });
      for (const key of T175_BEFORE.fields) expectCounterpart(fields, key, `Accordion ${key} (${position})`);
      for (const key of T175_BEFORE.items) expectCounterpart(fields, `items.${key}`, `Accordion items.${key} (${position})`);
      for (const key of ['allowMultiple', 'iconPosition', 'variant', 'titleLevel'] as const) {
        expect(optionValues(fields[key]), `${key} (${position})`).toEqual([...T175_BEFORE[key]]);
      }
      for (const key of ['icon', 'dividers', 'itemStyle', 'titlePadding', 'titlePaddingPx']) expectCounterpart(fields, key, `Accordion ${key} (${position})`);
      expect(optionValues(fields['icon']), position).toEqual(['plus', 'chevron']);
      expect((fields['titlePadding'] as { metadata?: unknown }).metadata, position).toEqual(PB_RESPONSIVE_METADATA);
    }
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['icon', 'dividers', 'itemStyle', 'titlePadding', 'titlePaddingPx']) expect(defaults, key).not.toHaveProperty(key);
  });
});

// ── R12: resting colours of a tile, the accordion's title colour, divider position and icon size (T178, T179) ──

/**
 * The fields `cms.LinkTile` and `cms.Accordion` offer on this branch after R11
 * (2026-10-26, after T172 and T175), with the accordion's option values, as
 * literals. T178 adds the tile's resting title and label colour; T179 the
 * accordion's title colour, the divider position and the icon size (+ its
 * Custom px). Nothing here may go, every option value stays, and no addition
 * is in `defaultProps`.
 */
const R12_LINK_TILE_BEFORE = [
  'hideOn', 'image', 'ratio', 'mediaCornerRadius', 'title', 'titleSize', 'titleSizePx', 'titleFont', 'titleWeight', 'titleHoverColor',
  'linkLabel', 'labelStyle', 'labelSize', 'labelSizePx', 'labelFont', 'labelWeight', 'labelHoverColor', 'link', 'hoverZoom', 'tags',
] as const;
const R12_ACCORDION_BEFORE = {
  fields: [
    'hideOn', 'items', 'allowMultiple', 'defaultOpen', 'iconPosition', 'variant', 'titleLevel', 'titleSize', 'titleSizePx',
    'icon', 'itemStyle', 'dividers', 'titlePadding', 'titlePaddingPx', 'margin', 'padding', 'border',
  ],
  items: ['title', 'panel'],
  allowMultiple: [true, false],
  iconPosition: ['start', 'end'],
  variant: ['default', 'flush', 'bordered'],
  titleLevel: ['none', 'h2', 'h3', 'h4', 'h5', 'h6'],
  icon: ['plus', 'chevron'],
  itemStyle: ['plain', 'boxed'],
  dividers: ['none', 'between', 'all'],
} as const;

describe('option parity — R12 resting tile colours, the accordion\'s title colour, divider position and icon size (T178, T179)', () => {
  it('cms.LinkTile keeps every field and offers a resting title and label colour, none in defaultProps', async () => {
    const block = (await import('./LinkTile.js')).LinkTile as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'top', { titleSize: 'custom', labelSize: 'custom' });
    for (const key of R12_LINK_TILE_BEFORE) expectCounterpart(fields, key, `LinkTile ${key}`);
    for (const key of ['titleColor', 'labelColor']) expectCounterpart(fields, key, `LinkTile ${key}`);
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['titleColor', 'labelColor']) expect(defaults, key).not.toHaveProperty(key);
  });

  it('cms.Accordion keeps every field and option value, and offers the title colour, divider position and icon size, none in defaultProps', async () => {
    const block = (await import('./Accordion.js')).Accordion as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position, { titleSize: 'custom', titlePadding: 'custom', iconSize: 'custom' });
      for (const key of R12_ACCORDION_BEFORE.fields) expectCounterpart(fields, key, `Accordion ${key} (${position})`);
      for (const key of R12_ACCORDION_BEFORE.items) expectCounterpart(fields, `items.${key}`, `Accordion items.${key} (${position})`);
      for (const key of ['allowMultiple', 'iconPosition', 'variant', 'titleLevel', 'icon', 'itemStyle', 'dividers'] as const) {
        expect(optionValues(fields[key]), `${key} (${position})`).toEqual([...R12_ACCORDION_BEFORE[key], ...accordionOptionsAddedLater(key)]);
      }
      for (const key of ['titleColor', 'dividerPosition', 'iconSize', 'iconSizePx']) expectCounterpart(fields, key, `Accordion ${key} (${position})`);
      // Under the item first: an unset value is today's line.
      expect(optionValues(fields['dividerPosition']), position).toEqual(['item', 'title']);
      expect(optionValues(fields['iconSize']), position).toEqual(['s', 'm', 'l', 'custom']);
    }
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['titleColor', 'dividerPosition', 'iconSize', 'iconSizePx']) expect(defaults, key).not.toHaveProperty(key);
  });
});

// ── R13: a tile's resting colours per breakpoint, the accordion's spacing and title weight (T181–T183) ──

/**
 * The fields `cms.LinkTile` and `cms.Accordion` offer on this branch after R12
 * (2026-10-26, after T178 and T179), with the accordion's option values, as
 * literals. T181 makes the tile's resting `titleColor`/`labelColor` a value
 * per breakpoint (the same keys, now on the Responsive tab; a single stored
 * colour keeps working, see `LinkTile.test.tsx`); T182 adds the accordion's
 * `panelGap` and `itemGap` (each with its Custom px) per breakpoint; T183 its
 * `titleWeight`. Nothing here may go, every option value stays, and no
 * addition is in `defaultProps`.
 */
const R13_LINK_TILE_BEFORE = [
  'hideOn', 'image', 'ratio', 'mediaCornerRadius', 'title', 'titleSize', 'titleSizePx', 'titleFont', 'titleWeight', 'titleColor', 'titleHoverColor',
  'linkLabel', 'labelStyle', 'labelSize', 'labelSizePx', 'labelFont', 'labelWeight', 'labelColor', 'labelHoverColor', 'link', 'hoverZoom', 'tags',
] as const;
const R13_ACCORDION_BEFORE = {
  fields: [
    'hideOn', 'items', 'allowMultiple', 'defaultOpen', 'iconPosition', 'variant', 'titleLevel', 'titleSize', 'titleSizePx', 'titleColor',
    'icon', 'iconSize', 'iconSizePx', 'itemStyle', 'dividers', 'dividerPosition', 'titlePadding', 'titlePaddingPx', 'margin', 'padding', 'border',
  ],
  items: ['title', 'panel'],
  allowMultiple: [true, false],
  iconPosition: ['start', 'end'],
  variant: ['default', 'flush', 'bordered'],
  titleLevel: ['none', 'h2', 'h3', 'h4', 'h5', 'h6'],
  icon: ['plus', 'chevron'],
  iconSize: ['s', 'm', 'l', 'custom'],
  itemStyle: ['plain', 'boxed'],
  dividers: ['none', 'between', 'all'],
  dividerPosition: ['item', 'title'],
  titlePadding: ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom'],
} as const;

describe('option parity — R13 resting tile colours per breakpoint, the accordion\'s spacing and title weight (T181–T183)', () => {
  it('cms.LinkTile keeps every field and offers its resting title and label colours per breakpoint, none in defaultProps', async () => {
    const block = (await import('./LinkTile.js')).LinkTile as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'top', { titleSize: 'custom', labelSize: 'custom' });
    for (const key of R13_LINK_TILE_BEFORE) expectCounterpart(fields, key, `LinkTile ${key}`);
    for (const key of ['titleColor', 'labelColor']) {
      expect((fields[key] as { metadata?: unknown }).metadata, key).toEqual(PB_RESPONSIVE_METADATA);
    }
    // The hover colours stay one value for every width.
    for (const key of ['titleHoverColor', 'labelHoverColor']) expect((fields[key] as { metadata?: unknown }).metadata, key).toBeUndefined();
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['titleColor', 'labelColor']) expect(defaults, key).not.toHaveProperty(key);
  });

  it('cms.Accordion keeps every field and option value, and offers the panel gap, the item gap and the title weight, none in defaultProps', async () => {
    const block = (await import('./Accordion.js')).Accordion as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position, {
        titleSize: 'custom', titlePadding: 'custom', iconSize: 'custom', panelGap: 'custom', itemGap: 'custom',
      });
      for (const key of R13_ACCORDION_BEFORE.fields) expectCounterpart(fields, key, `Accordion ${key} (${position})`);
      for (const key of R13_ACCORDION_BEFORE.items) expectCounterpart(fields, `items.${key}`, `Accordion items.${key} (${position})`);
      for (const key of ['allowMultiple', 'iconPosition', 'variant', 'titleLevel', 'icon', 'iconSize', 'itemStyle', 'dividers', 'dividerPosition', 'titlePadding'] as const) {
        expect(optionValues(fields[key]), `${key} (${position})`).toEqual([...R13_ACCORDION_BEFORE[key], ...accordionOptionsAddedLater(key)]);
      }
      for (const key of ['panelGap', 'panelGapPx', 'itemGap', 'itemGapPx', 'titleWeight']) expectCounterpart(fields, key, `Accordion ${key} (${position})`);
      for (const key of ['panelGap', 'panelGapPx', 'itemGap', 'itemGapPx']) {
        expect((fields[key] as { metadata?: unknown }).metadata, `${key} (${position})`).toEqual(PB_RESPONSIVE_METADATA);
      }
      expect(optionValues(fields['panelGap']), position).toEqual(['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom']);
      expect(optionValues(fields['itemGap']), position).toEqual(['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom']);
      // Default (today's weight) first, then 300–800.
      expect(optionValues(fields['titleWeight']), position).toEqual(['default', 300, 400, 500, 600, 700, 800]);
    }
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['panelGap', 'panelGapPx', 'itemGap', 'itemGapPx', 'titleWeight']) expect(defaults, key).not.toHaveProperty(key);
  });
});

// ── R14: the accordion's title weight per breakpoint, its panel's bottom space and the gap after an open item (T185, T186) ──

/**
 * The fields `cms.Accordion` offers on this branch after R13 (2026-10-26,
 * after T182 and T183), with its option values, as literals. T185 makes
 * `titleWeight` a value per breakpoint (the same key and options, now on the
 * Responsive tab; a single stored weight keeps working, see
 * `Accordion.test.tsx`); T186 adds `panelPaddingBottom` and `openItemGap`
 * (each with its Custom px) per breakpoint. Nothing here may go, every option
 * value stays, and no addition is in `defaultProps`.
 */
const R14_ACCORDION_BEFORE = {
  fields: [
    'hideOn', 'items', 'allowMultiple', 'defaultOpen', 'iconPosition', 'variant', 'titleLevel', 'titleSize', 'titleSizePx', 'titleColor',
    'titleWeight', 'icon', 'iconSize', 'iconSizePx', 'itemStyle', 'dividers', 'dividerPosition', 'titlePadding', 'titlePaddingPx',
    'panelGap', 'panelGapPx', 'itemGap', 'itemGapPx', 'margin', 'padding', 'border',
  ],
  items: ['title', 'panel'],
  allowMultiple: [true, false],
  iconPosition: ['start', 'end'],
  variant: ['default', 'flush', 'bordered'],
  titleLevel: ['none', 'h2', 'h3', 'h4', 'h5', 'h6'],
  titleWeight: ['default', 300, 400, 500, 600, 700, 800],
  icon: ['plus', 'chevron'],
  iconSize: ['s', 'm', 'l', 'custom'],
  itemStyle: ['plain', 'boxed'],
  dividers: ['none', 'between', 'all'],
  dividerPosition: ['item', 'title'],
  titlePadding: ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom'],
  panelGap: ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom'],
  itemGap: ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom'],
} as const;

describe('option parity — R14 the accordion\'s title weight per breakpoint, panel bottom space and open-item gap (T185, T186)', () => {
  it('cms.Accordion keeps every field and option value, makes the title weight responsive and offers the two spaces, none in defaultProps', async () => {
    const block = (await import('./Accordion.js')).Accordion as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position, {
        titleSize: 'custom', titlePadding: 'custom', iconSize: 'custom', panelGap: 'custom', itemGap: 'custom',
        panelPaddingBottom: 'custom', openItemGap: 'custom',
      });
      for (const key of R14_ACCORDION_BEFORE.fields) expectCounterpart(fields, key, `Accordion ${key} (${position})`);
      for (const key of R14_ACCORDION_BEFORE.items) expectCounterpart(fields, `items.${key}`, `Accordion items.${key} (${position})`);
      for (const key of [
        'allowMultiple', 'iconPosition', 'variant', 'titleLevel', 'titleWeight', 'icon', 'iconSize', 'itemStyle', 'dividers', 'dividerPosition',
        'titlePadding', 'panelGap', 'itemGap',
      ] as const) {
        expect(optionValues(fields[key]), `${key} (${position})`).toEqual([...R14_ACCORDION_BEFORE[key], ...accordionOptionsAddedLater(key)]);
      }
      expect((fields['titleWeight'] as { metadata?: unknown }).metadata, `titleWeight (${position})`).toEqual(PB_RESPONSIVE_METADATA);
      for (const key of ['panelPaddingBottom', 'panelPaddingBottomPx', 'openItemGap', 'openItemGapPx']) {
        expectCounterpart(fields, key, `Accordion ${key} (${position})`);
        expect((fields[key] as { metadata?: unknown }).metadata, `${key} (${position})`).toEqual(PB_RESPONSIVE_METADATA);
      }
      expect(optionValues(fields['panelPaddingBottom']), position).toEqual(['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom']);
      expect(optionValues(fields['openItemGap']), position).toEqual(['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom']);
    }
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['titleWeight', 'panelPaddingBottom', 'panelPaddingBottomPx', 'openItemGap', 'openItemGapPx']) {
      expect(defaults, key).not.toHaveProperty(key);
    }
  });
});

// ── R14: the tile's title and label weight, and the carousel image's caption weight, per breakpoint (T188) ──

/**
 * The fields `cms.LinkTile` and `cms.CarouselImage` offer on this branch after
 * R13 (2026-10-26), as literals. T188 makes `titleWeight`, `labelWeight` and
 * `captionWeight` values per breakpoint: the same keys and options, now on the
 * Responsive tab (a single stored weight keeps working, see
 * `LinkTile.test.tsx`). Nothing here may go, every option value stays, and
 * none is in `defaultProps`.
 */
const R14_LINK_TILE_BEFORE = R13_LINK_TILE_BEFORE;
const R14_CAROUSEL_IMAGE_BEFORE = [
  'hideOn', 'image', 'caption', 'mediaCornerRadius', 'captionPlacement', 'captionSize', 'captionSizePx', 'captionFont', 'captionWeight',
  'captionStyle', 'captionHoverColor', 'captionScrim', 'link', 'hoverZoom', 'tags',
] as const;
const R14_WEIGHTS = ['default', 300, 400, 500, 600, 700, 800];

describe('option parity — R14 the tile\'s title and label weight and the caption weight per breakpoint (T188)', () => {
  it('cms.LinkTile keeps every field and makes the title and label weights responsive, with today\'s options, none in defaultProps', async () => {
    const block = (await import('./LinkTile.js')).LinkTile as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'top', { titleSize: 'custom', labelSize: 'custom' });
    for (const key of R14_LINK_TILE_BEFORE) expectCounterpart(fields, key, `LinkTile ${key}`);
    for (const key of ['titleWeight', 'labelWeight']) {
      expect(optionValues(fields[key]), key).toEqual(R14_WEIGHTS);
      expect((fields[key] as { metadata?: unknown }).metadata, key).toEqual(PB_RESPONSIVE_METADATA);
    }
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['titleWeight', 'labelWeight']) expect(defaults, key).not.toHaveProperty(key);
  });

  it('cms.CarouselImage keeps every field and makes the caption weight responsive, with today\'s options, not in defaultProps', async () => {
    const block = (await import('./CarouselImage.js')).CarouselImage as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'top', { captionSize: 'custom' });
    for (const key of R14_CAROUSEL_IMAGE_BEFORE) expectCounterpart(fields, key, `CarouselImage ${key}`);
    expect(optionValues(fields['captionWeight'])).toEqual(R14_WEIGHTS);
    expect((fields['captionWeight'] as { metadata?: unknown }).metadata).toEqual(PB_RESPONSIVE_METADATA);
    expect((block.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('captionWeight');
  });
});

// ── R15: the post card's look and the header button's placement (T189) ──

/**
 * The fields `blog.LatestPosts` offers on this branch after R14 (2026-10-27),
 * as literals: at the top level in its carousel layout (with every Custom
 * shown) and, for the grid, `columns`. T189 adds the post card's look — its
 * background, corners, padding, text padding, image ratio, zoom on hover,
 * chip style, title size and weight, and the read-more link's icon,
 * alignment and weight — and the header's lead size and colour and its
 * button's placement and width. Nothing here may go, every option value
 * stays, and none of the additions is in `defaultProps`.
 */
const R15_LATEST_POSTS_BEFORE = [
  'hideOn', 'header', 'headingLevel', 'headingSize', 'headingSizePx', 'headingWeight', 'headingMaxWidth', 'headingMaxWidthPx',
  'limit', 'categorySlug', 'layout', 'readMoreLabel', 'slidesPerView', 'gap', 'gapPx', 'effect', 'loop', 'controls',
  'controlsPlacement', 'controlsAlign', 'controlsAlignTo', 'bleed', 'autoplay', 'intervalMs', 'equalHeight',
] as const;
const R15_LATEST_POSTS_SELECTS = {
  layout: ['carousel', 'grid'],
  effect: ['slide', 'fade'],
  loop: [true, false],
  bleed: ['none', 'end', 'both'],
  controlsPlacement: ['below', 'header', 'overlay'],
  // R20F (T313): extended with the dots at the start, the arrows at the end.
  controlsAlign: ['center', 'start', 'end', 'between', 'split', 'dots-start'],
  controlsAlignTo: ['container', 'slide'],
} as const;
const R15_LATEST_POSTS_ADDED = {
  cardBackground: null,
  cardRadius: ['none', 'small', 'medium', 'large'],
  cardPadding: ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom'],
  cardPaddingPx: null,
  cardTextPadding: ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom'],
  cardTextPaddingPx: null,
  imageRatio: null,
  // R17 (T204, deliberately changed): a switch now, with the same two values.
  hoverZoom: [true, false],
  chipStyle: ['filled', 'outline', 'none'],
  cardTitleSize: null,
  cardTitleSizePx: null,
  cardTitleWeight: ['default', 300, 400, 500, 600, 700, 800],
  readMoreIcon: ['none', 'arrow', 'plus'],
  readMoreAlign: ['start', 'end'],
  readMoreWeight: ['default', 300, 400, 500, 600, 700, 800],
  leadSize: null,
  leadSizePx: null,
  leadColor: null,
  headerButtonPlacement: ['below', 'end', 'after'],
  headerButtonFullWidth: ['auto', 'full'],
} as const;
const R15_RESPONSIVE = [
  'cardPadding', 'cardPaddingPx', 'cardTextPadding', 'cardTextPaddingPx', 'imageRatio', 'cardTitleSize', 'cardTitleSizePx',
  'cardTitleWeight', 'leadSize', 'leadSizePx', 'headerButtonPlacement', 'headerButtonFullWidth',
] as const;

describe('option parity — R15 the post card\'s look and the header button\'s placement (T189)', () => {
  it('blog.LatestPosts keeps every field and option value and offers the card, lead and button options, none in defaultProps', async () => {
    const block = (await import('./LatestPosts.js')).LatestPosts as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'top', {
      layout: 'carousel', headingSize: 'custom', gap: 'custom', headingMaxWidth: 'custom',
      cardPadding: 'custom', cardTextPadding: 'custom', cardTitleSize: 'custom', leadSize: 'custom',
    });
    for (const key of R15_LATEST_POSTS_BEFORE) expectCounterpart(fields, key, `LatestPosts ${key}`);
    for (const [key, values] of Object.entries(R15_LATEST_POSTS_SELECTS)) expect(optionValues(fields[key]), key).toEqual([...values]);
    for (const [key, values] of Object.entries(R15_LATEST_POSTS_ADDED)) {
      expectCounterpart(fields, key, `LatestPosts ${key}`);
      if (values !== null) expect(optionValues(fields[key]), key).toEqual([...values]);
    }
    for (const key of R15_RESPONSIVE) expect((fields[key] as { metadata?: unknown }).metadata, key).toEqual(PB_RESPONSIVE_METADATA);
    // The grid keeps its columns and offers the same card options.
    const grid = await fieldsAt(block, 'top', { layout: 'grid' });
    expectCounterpart(grid, 'columns', 'LatestPosts columns (grid)');
    for (const key of ['cardBackground', 'imageRatio', 'chipStyle', 'readMoreIcon', 'headerButtonPlacement']) expectCounterpart(grid, key, `LatestPosts ${key} (grid)`);
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(R15_LATEST_POSTS_ADDED)) expect(defaults, key).not.toHaveProperty(key);
  });
});

// ── Feature 169: the accordion's filled items, the download tile's icon presets (T011, T015) ──

/**
 * `specs/169-page-builder-contact-form/` T011 — option values added to the accordion after the
 * R12–R14 baselines above, **appended last**: each earlier baseline still holds in order, followed
 * by exactly these.
 */
const F169_ACCORDION_ADDED: Partial<Record<string, readonly string[]>> = { itemStyle: ['filled'] };

function accordionOptionsAddedLater(key: string): string[] {
  return [...(F169_ACCORDION_ADDED[key] ?? [])];
}

describe('option parity — feature 169 accordion filled items and download tile icon presets (T011, T015)', () => {
  it('cms.Accordion keeps plain and boxed and adds filled last; the field set is unchanged', async () => {
    const block = (await import('./Accordion.js')).Accordion as unknown as ComponentConfig;
    for (const position of ['top', 'nested'] as const) {
      const fields = await fieldsAt(block, position);
      expect(optionValues(fields['itemStyle']), position).toEqual(['plain', 'boxed', 'filled']);
    }
    expect((block.defaultProps ?? {}) as Record<string, unknown>).not.toHaveProperty('itemStyle');
  });

  it('cms.DownloadTile keeps every field and adds the icon size and style after the icon button icon, none in defaultProps', async () => {
    const block = (await import('./DownloadTile.js')).DownloadTile as unknown as ComponentConfig;
    const fields = await fieldsAt(block, 'top', { linkLook: 'icon' });
    const keys = Object.keys(fields);
    expect(keys.indexOf('iconButtonSize')).toBe(keys.indexOf('iconButtonIcon') + 1);
    expect(keys.indexOf('iconButtonStyle')).toBe(keys.indexOf('iconButtonIcon') + 2);
    expect(optionValues(fields['iconButtonSize'])).toEqual(['s', 'm', 'l']);
    expect(optionValues(fields['iconButtonStyle'])).toEqual(['outline', 'filled']);
    for (const key of ['linkLook', 'iconButtonIcon', 'showType', 'scheme']) expectCounterpart(fields, key, `DownloadTile ${key}`);
    const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;
    for (const key of ['iconButtonSize', 'iconButtonStyle']) expect(defaults, key).not.toHaveProperty(key);
  });
});
