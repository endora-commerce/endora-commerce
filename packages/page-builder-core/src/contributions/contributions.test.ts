import type { ComponentConfig, Config } from '@puckeditor/core';
import { cmsFieldDescriptorSchema } from '@endora-commerce/contracts/cms';
import { describe, expect, it } from 'vitest';

import {
  fieldsFromDescriptor,
  isOwnerPresent,
  withContributedBlocks,
  withPresence,
} from './index.js';

/**
 * `specs/141-module-block-renderers/contracts/block-renderers.md` R5.2.1 — the
 * composition steps, each a pure function.
 */

const block = (marker: string): ComponentConfig =>
  ({ render: () => marker }) as unknown as ComponentConfig;

const base: Config = {
  components: { 'cms.Text': block('first-party'), 'catalog.ProductGrid': block('first-party') },
} as Config;

const rendererOf = (config: Config, name: string): unknown =>
  (config.components as Record<string, ComponentConfig>)[name]?.render;

describe('withContributedBlocks', () => {
  it('adds a block its own module contributes', () => {
    const badge = block('crm');
    const result = withContributedBlocks(base, [{ moduleId: 'crm', blocks: { 'crm.Badge': badge } }]);
    expect(rendererOf(result.config, 'crm.Badge')).toBe(badge.render);
    expect(result.added).toEqual(['crm.Badge']);
    expect(result.collisions).toEqual([]);
    expect(result.foreign).toEqual([]);
    // The input is not mutated.
    expect(Object.keys(base.components ?? {})).toEqual(['cms.Text', 'catalog.ProductGrid']);
  });

  it('keeps a name that is already present and reports the contribution', () => {
    const result = withContributedBlocks(base, [
      { moduleId: 'cms', blocks: { 'cms.Text': block('hijack') } },
    ]);
    expect(rendererOf(result.config, 'cms.Text')).toBe(rendererOf(base, 'cms.Text'));
    expect(result.collisions).toEqual([{ name: 'cms.Text', moduleId: 'cms' }]);
    expect(result.added).toEqual([]);
  });

  it('keeps the first of two contributions for one name and reports the second', () => {
    const first = block('first');
    const result = withContributedBlocks(base, [
      { moduleId: 'crm', blocks: { 'crm.Badge': first } },
      { moduleId: 'crm', blocks: { 'crm.Badge': block('second') } },
    ]);
    expect(rendererOf(result.config, 'crm.Badge')).toBe(first.render);
    expect(result.collisions).toEqual([{ name: 'crm.Badge', moduleId: 'crm' }]);
  });

  it('drops a name whose owner segment is not the contributing module, and reports it', () => {
    const result = withContributedBlocks(base, [
      { moduleId: 'crm', blocks: { 'loyalty.Badge': block('foreign'), NotNamespaced: block('x') } },
    ]);
    expect(rendererOf(result.config, 'loyalty.Badge')).toBeUndefined();
    expect(rendererOf(result.config, 'NotNamespaced')).toBeUndefined();
    expect(result.foreign).toEqual([
      { name: 'loyalty.Badge', moduleId: 'crm' },
      { name: 'NotNamespaced', moduleId: 'crm' },
    ]);
    expect(result.added).toEqual([]);
  });

  it('does not check the owner of a local block, and still keeps an existing name', () => {
    const local = block('local');
    const result = withContributedBlocks(base, [
      { moduleId: null, blocks: { 'overlay_crm.Banner': local, 'cms.Text': block('hijack') } },
    ]);
    expect(rendererOf(result.config, 'overlay_crm.Banner')).toBe(local.render);
    expect(rendererOf(result.config, 'cms.Text')).toBe(rendererOf(base, 'cms.Text'));
    expect(result.collisions).toEqual([{ name: 'cms.Text', moduleId: null }]);
    expect(result.foreign).toEqual([]);
  });

  it('tolerates a contribution with no blocks and a block that is not a config', () => {
    const result = withContributedBlocks(base, [
      { moduleId: 'crm', blocks: undefined },
      { moduleId: 'crm', blocks: { 'crm.Broken': null as unknown as ComponentConfig } },
    ]);
    expect(result.added).toEqual([]);
    expect(result.foreign).toEqual([{ name: 'crm.Broken', moduleId: 'crm' }]);
  });
});

describe('withPresence', () => {
  const placeholder = (name: string, owner: string): ComponentConfig =>
    block(`placeholder:${name}:${owner}`);

  it('replaces every component whose owner is absent and keeps the present ones', () => {
    const config = withPresence(base, { ids: ['cms'] }, placeholder);
    expect(rendererOf(config, 'cms.Text')).toBe(rendererOf(base, 'cms.Text'));
    const replaced = (config.components as Record<string, ComponentConfig>)['catalog.ProductGrid'];
    expect((replaced?.render as unknown as () => string)()).toBe('placeholder:catalog.ProductGrid:catalog');
  });

  it('keeps everything when presence could not be decided', () => {
    expect(withPresence(base, { all: true }, placeholder)).toBe(base);
  });

  it('leaves a name that states no owner alone', () => {
    const legacy = { components: { LegacyBlock: block('legacy') } } as Config;
    const config = withPresence(legacy, { ids: [] }, placeholder);
    expect(rendererOf(config, 'LegacyBlock')).toBe(rendererOf(legacy, 'LegacyBlock'));
  });

  it('answers presence for one owner', () => {
    expect(isOwnerPresent({ all: true }, 'crm')).toBe(true);
    expect(isOwnerPresent({ ids: ['crm'] }, 'crm')).toBe(true);
    expect(isOwnerPresent({ ids: ['cms'] }, 'crm')).toBe(false);
  });
});

describe('fieldsFromDescriptor', () => {
  it('maps every descriptor field type to a Puck field', () => {
    const types = cmsFieldDescriptorSchema.shape.type.options;
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      const fields = fieldsFromDescriptor({
        fields: { value: { type, label: 'Value', options: [{ label: 'A', value: 'a' }] } },
      });
      const field = fields['value'] as { type?: string; label?: string } | undefined;
      expect(field, type).toBeDefined();
      expect(typeof field?.type, type).toBe('string');
      expect(field?.label, type).toBe('Value');
    }
  });

  it('carries options for a select and a radio, and falls back to the key for a label', () => {
    const fields = fieldsFromDescriptor({
      fields: {
        tone: { type: 'select', options: [{ label: 'Gold', value: 'gold' }] },
        size: { type: 'radio', options: [{ label: 'S', value: 1 }] },
      },
    }) as Record<string, { type: string; label?: string; options?: unknown }>;
    expect(fields['tone']).toEqual({
      type: 'select',
      label: 'tone',
      options: [{ label: 'Gold', value: 'gold' }],
    });
    expect(fields['size']?.type).toBe('radio');
    expect(fields['size']?.options).toEqual([{ label: 'S', value: 1 }]);
  });

  it('gives a structured value an editor that round-trips it', () => {
    const fields = fieldsFromDescriptor({
      fields: { items: { type: 'array' }, style: { type: 'object' } },
    }) as Record<string, { type: string; render?: unknown }>;
    expect(fields['items']?.type).toBe('custom');
    expect(typeof fields['items']?.render).toBe('function');
    expect(fields['style']?.type).toBe('custom');
  });

  it('is empty for a block that declares no field', () => {
    expect(fieldsFromDescriptor({ fields: {} })).toEqual({});
  });
});
