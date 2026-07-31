import { describe, expect, it } from 'vitest';
import { emptyPageBuilderData, isEmptyPageBuilderData } from '../../../src/modules/cms/components/page-builder-data';

describe('page-builder-data', () => {
  it('treats empty content as empty', () => {
    expect(isEmptyPageBuilderData(null)).toBe(true);
    expect(isEmptyPageBuilderData(emptyPageBuilderData())).toBe(true);
  });

  it('treats trees with components as non-empty', () => {
    expect(
      isEmptyPageBuilderData({
        root: { props: {} },
        content: [{ type: 'Heading', props: { id: '1', text: 'Hi' } }],
      }),
    ).toBe(false);
  });
});
