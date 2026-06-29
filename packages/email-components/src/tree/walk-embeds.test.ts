import { describe, expect, it } from 'vitest';
import { walkAssetIds, walkBlockEmbeds, walkTemplateEmbeds, walkUnknownComponents } from './walk-embeds.js';
import { EMAIL_SAFE_COMPONENT_NAMES } from '../schema/component-types.js';

const tree = {
  root: { props: {} },
  content: [
    { type: 'EmailInsertBlock', props: { code: 'header' } },
    { type: 'EmailImage', props: { src: 'x', logoAssetId: 'asset-1' } },
    { type: 'EmailInsertTemplate', props: { code: 'promo' } },
    { type: 'NotSafe', props: {} },
    { type: 'EmailInsertBlock', props: { code: '' } },
  ],
};

describe('walk-embeds', () => {
  it('collects block embed codes (ignoring empty)', () => {
    expect([...walkBlockEmbeds(tree)]).toEqual(['header']);
  });

  it('collects template embed codes', () => {
    expect([...walkTemplateEmbeds(tree)]).toEqual(['promo']);
  });

  it('collects asset ids by key suffix', () => {
    expect([...walkAssetIds(tree)]).toContain('asset-1');
  });

  it('flags components not in the known set', () => {
    const known = new Set<string>(EMAIL_SAFE_COMPONENT_NAMES);
    expect([...walkUnknownComponents(tree, known)]).toEqual(['NotSafe']);
  });
});
