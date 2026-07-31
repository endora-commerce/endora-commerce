import { describe, expect, it } from 'vitest';
import { codeFromTemplateName } from '../../../src/modules/cms/components/cms-template-layout';
import { isEmptyPageBuilderData } from '../../../src/modules/cms/components/page-builder-data';

describe('cms-template-layout guards', () => {
  it('derives a stable code from the template name', () => {
    expect(codeFromTemplateName(' Hello World! ')).toBe('hello-world');
  });

  it('blocks save when the canvas is empty', () => {
    expect(isEmptyPageBuilderData({ root: { props: {} }, content: [] })).toBe(true);
    expect(
      isEmptyPageBuilderData({
        root: { props: {} },
        content: [{ type: 'Heading', props: { id: '1', text: 'Hi' } }],
      }),
    ).toBe(false);
  });
});
