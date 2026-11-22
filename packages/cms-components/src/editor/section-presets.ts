import type { ComponentData } from '@puckeditor/core';
import { plainTextToInlineRichText, type ButtonSpec } from '@endora-commerce/page-builder-core';
import { ContentSlider } from '../components/ContentSlider.js';
import { CtaCard } from '../components/CtaCard.js';
import { DownloadTile } from '../components/DownloadTile.js';
import { FeatureList } from '../components/FeatureList.js';
import { Hero } from '../components/Hero.js';
import { MediaText } from '../components/MediaText.js';
import { Section } from '../components/SectionBlock.js';
import { plainTextToDoc } from '../components/section-parts.js';
import { Statement } from '../components/Statement.js';
import type { SectionPresetCopy } from './section-preset-copy.js';

/**
 * Section presets (`specs/163-page-builder-marketing-pages/` FR-042, research
 * R-22): six ready-made sections an editor inserts from the block drawer and
 * then edits. Code-side, so they are versioned with the blocks they build; the
 * tree literals name declared blocks, which `check:block-names` reads.
 *
 * Each preset is one top-level `cms.Section` holding its block (plan § *Owner
 * ruling 2026-10-23*: the section settings — anchor, scheme, background,
 * spacing, width — live on the Section), with the Section's neutral defaults.
 *
 * A builder takes the placeholder copy already resolved in the **content
 * language being edited** — a row of `SECTION_PRESET_COPY`
 * (`section-preset-copy.ts`), picked by the editor with `contentDefaultsIn`
 * (issue #1684, research R-22 as amended). The copy is content seeded into the
 * document, not admin chrome: only the preset's name and description below are
 * `cms` bundle keys, in the admin's language.
 */

export type SectionPresetId = 'hero' | 'mediaText' | 'ctaCard' | 'downloads' | 'featureGrid' | 'statement';

export interface SectionPreset {
  id: SectionPresetId;
  /** `cms` keys of the preset's name and one-line description in the panel. */
  labelKey: string;
  descriptionKey: string;
  /** A fresh tree, with new ids, every call, carrying `copy` — the content language's row. */
  build: (copy: SectionPresetCopy) => ComponentData;
}

function newId(type: string): string {
  return `${type}-${crypto.randomUUID()}`;
}

function button(label: string, style: ButtonSpec['style'], fill: ButtonSpec['fill']): ButtonSpec {
  return { label, link: { kind: 'url', href: '/' }, style, fill, size: 'medium' };
}

function defaults(config: { defaultProps?: unknown }): Record<string, unknown> {
  return { ...((config.defaultProps as Record<string, unknown> | undefined) ?? {}) };
}

/** The preset's block inside a fresh `cms.Section`; `settings` are the Section's own props (T117), where they differ from its defaults. */
function inSection(block: ComponentData, settings?: Record<string, unknown>): ComponentData {
  return {
    type: 'cms.Section',
    props: {
      ...defaults(Section),
      id: newId('cms.Section'),
      ...settings,
      content: [block],
    },
  };
}

function heroPreset({ hero: copy }: SectionPresetCopy): ComponentData {
  // The hero has its own height and inner spacing, so its Section adds none.
  return inSection({
    type: 'cms.Hero',
    props: {
      ...defaults(Hero),
      id: newId('cms.Hero'),
      eyebrow: copy.eyebrow,
      title: plainTextToInlineRichText(copy.title),
      body: plainTextToDoc(copy.body),
      buttons: [
        button(copy.primaryButton, 'primary', 'solid'),
        button(copy.secondaryButton, 'primary', 'outline'),
      ],
    },
  }, { spaceTop: 'none', spaceBottom: 'none' });
}

function mediaTextPreset({ mediaText: copy }: SectionPresetCopy): ComponentData {
  return inSection({
    type: 'cms.MediaText',
    props: {
      ...defaults(MediaText),
      id: newId('cms.MediaText'),
      heading: plainTextToInlineRichText(copy.heading),
      body: plainTextToDoc(copy.body),
      buttons: [button(copy.button, 'primary', 'solid')],
    },
  });
}

function ctaCardPreset({ ctaCard: copy }: SectionPresetCopy): ComponentData {
  return inSection({
    type: 'cms.CtaCard',
    props: {
      ...defaults(CtaCard),
      id: newId('cms.CtaCard'),
      heading: plainTextToInlineRichText(copy.heading),
      body: plainTextToDoc(copy.body),
      buttons: [button(copy.button, 'primary', 'solid')],
    },
  });
}

function downloadTile(file: SectionPresetCopy['downloads']['files'][number], linkLabel: string): ComponentData {
  return {
    type: 'cms.DownloadTile',
    props: {
      ...defaults(DownloadTile),
      id: newId('cms.DownloadTile'),
      title: file.title,
      subtitle: file.subtitle,
      linkLabel,
    },
  };
}

function downloadsPreset({ downloads: copy }: SectionPresetCopy): ComponentData {
  return inSection({
    type: 'cms.ContentSlider',
    props: {
      ...defaults(ContentSlider),
      id: newId('cms.ContentSlider'),
      header: { heading: plainTextToInlineRichText(copy.heading), lead: copy.lead },
      slidesPerView: { base: 1.15, tablet: 2, desktop: 3 },
      slides: copy.files.map((file) => downloadTile(file, copy.linkLabel)),
    },
  });
}

function featureGridPreset({ featureGrid: copy }: SectionPresetCopy): ComponentData {
  const base = defaults(FeatureList);
  const icons = ((base['items'] as Array<{ icon?: string }> | undefined) ?? []).map((item) => item.icon);
  return inSection({
    type: 'cms.FeatureList',
    props: {
      ...base,
      id: newId('cms.FeatureList'),
      heading: plainTextToInlineRichText(copy.heading),
      columns: { base: 1, tablet: 2, desktop: 3 },
      items: copy.items.map((item, index) => ({
        ...(icons[index] ? { icon: icons[index] } : {}),
        title: plainTextToInlineRichText(item.title),
        body: plainTextToDoc(item.body),
      })),
    },
  });
}

function statementPreset({ statement: copy }: SectionPresetCopy): ComponentData {
  return inSection({
    type: 'cms.Statement',
    props: {
      ...defaults(Statement),
      id: newId('cms.Statement'),
      heading: plainTextToInlineRichText(copy.heading),
      body: plainTextToDoc(copy.body),
    },
  });
}

export const SECTION_PRESETS: readonly SectionPreset[] = [
  { id: 'hero', labelKey: 'presets.hero.label', descriptionKey: 'presets.hero.description', build: heroPreset },
  {
    id: 'mediaText',
    labelKey: 'presets.mediaText.label',
    descriptionKey: 'presets.mediaText.description',
    build: mediaTextPreset,
  },
  { id: 'ctaCard', labelKey: 'presets.ctaCard.label', descriptionKey: 'presets.ctaCard.description', build: ctaCardPreset },
  {
    id: 'downloads',
    labelKey: 'presets.downloads.label',
    descriptionKey: 'presets.downloads.description',
    build: downloadsPreset,
  },
  {
    id: 'featureGrid',
    labelKey: 'presets.featureGrid.label',
    descriptionKey: 'presets.featureGrid.description',
    build: featureGridPreset,
  },
  {
    id: 'statement',
    labelKey: 'presets.statement.label',
    descriptionKey: 'presets.statement.description',
    build: statementPreset,
  },
];

/** Every block name a preset tree carries, root first, depth first through its slots. */
export function presetBlockNames(tree: ComponentData): string[] {
  const names = [tree.type];
  for (const value of Object.values(tree.props as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (child && typeof child === 'object' && typeof (child as ComponentData).type === 'string' && 'props' in child) {
        names.push(...presetBlockNames(child as ComponentData));
      }
    }
  }
  return names;
}
