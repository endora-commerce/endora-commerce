import { describe, expect, it } from 'vitest';
import {
  walkAssetIds,
  walkBlockEmbeds,
  walkTemplateEmbeds,
  walkUnknownComponents,
} from '../../../../packages/modules/cms/src/backend/services/content-tree-walker.js';

describe('walkAssetIds', () => {
  it('collects assetId values from any nested props', () => {
    const tree = {
      content: [
        { type: 'cms.Image', props: { assetId: 'A', alt: 'x' } },
        { type: 'cms.Button', props: { iconAssetId: 'B' } },
        { type: 'Card', props: { mainImageAssetId: 'C', child: { props: { assetId: 'D' } } } },
      ],
    };
    expect(Array.from(walkAssetIds(tree)).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('ignores empty strings + non-string values', () => {
    const tree = { content: [{ type: 'X', props: { assetId: '', otherAssetId: 42 } }] };
    expect(walkAssetIds(tree).size).toBe(0);
  });
});

describe('walkBlockEmbeds + walkTemplateEmbeds', () => {
  it('collects InsertBlock + InsertTemplate codes by type, ignoring other types', () => {
    const tree = {
      content: [
        { type: 'cms.InsertBlock', props: { code: 'block-1' } },
        { type: 'cms.InsertBlock', props: { code: 'block-2' } },
        { type: 'cms.InsertTemplate', props: { code: 'tpl-1' } },
        { type: 'cms.Text', props: { code: 'should-be-ignored' } },
      ],
    };
    expect(Array.from(walkBlockEmbeds(tree)).sort()).toEqual(['block-1', 'block-2']);
    expect(Array.from(walkTemplateEmbeds(tree)).sort()).toEqual(['tpl-1']);
  });
});

describe('walkUnknownComponents', () => {
  it('returns components whose type is not in the known set', () => {
    const known = new Set(['cms.Row', 'cms.Text']);
    const tree = {
      content: [
        { type: 'cms.Row', props: {} },
        { type: 'TestCallout', props: { title: 'hi' } },
        { type: 'cms.Text', props: { html: '' } },
        { type: 'Mystery', props: {} },
      ],
    };
    expect(Array.from(walkUnknownComponents(tree, known)).sort()).toEqual(['Mystery', 'TestCallout']);
  });
});
