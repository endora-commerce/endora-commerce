import { describe, expect, it } from 'vitest';
import { walkAssetIds, walkBlockEmbeds, walkTemplateEmbeds, walkUnknownComponents } from './walk-embeds.js';
import { EMAIL_SAFE_COMPONENT_NAMES } from '../schema/component-types.js';

const tree = {
  root: { props: {} },
  content: [
    { type: 'transactional_emails.EmailInsertBlock', props: { code: 'header' } },
    { type: 'transactional_emails.EmailImage', props: { src: 'x', logoAssetId: 'asset-1' } },
    { type: 'transactional_emails.EmailInsertTemplate', props: { code: 'promo' } },
    { type: 'NotSafe', props: {} },
    { type: 'transactional_emails.EmailInsertBlock', props: { code: '' } },
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

  it('flags components not in the known set (legacy InsertTemplate is withdrawn)', () => {
    const known = new Set<string>(EMAIL_SAFE_COMPONENT_NAMES);
    expect([...walkUnknownComponents(tree, known)].sort()).toEqual(
      ['transactional_emails.EmailInsertTemplate', 'NotSafe'].sort(),
    );
  });

  it('does not treat TipTap JSON under EmailRichText as unknown components', () => {
    const known = new Set<string>(EMAIL_SAFE_COMPONENT_NAMES);
    const withRichText = {
      root: { props: {} },
      content: [
        {
          type: 'transactional_emails.EmailRichText',
          props: {
            align: 'left',
            html: '<p>Hello <strong>world</strong></p>',
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Hello ' },
                    { type: 'text', marks: [{ type: 'bold' }], text: 'world' },
                  ],
                },
              ],
            },
          },
        },
        { type: 'NotSafe', props: {} },
      ],
    };
    expect([...walkUnknownComponents(withRichText, known)]).toEqual(['NotSafe']);
  });
});
