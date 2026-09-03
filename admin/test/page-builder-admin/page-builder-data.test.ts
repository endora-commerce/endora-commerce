import { describe, expect, it } from 'vitest';
import { emptyPageBuilderData, isEmptyPageBuilderData } from '@endora-commerce/page-builder-admin';

describe('page-builder-data', () => {
  it('treats empty content as empty', () => {
    expect(isEmptyPageBuilderData(null)).toBe(true);
    expect(isEmptyPageBuilderData(emptyPageBuilderData())).toBe(true);
  });

  it('treats trees with components as non-empty', () => {
    expect(
      isEmptyPageBuilderData({
        root: { props: {} },
        content: [{ type: 'cms.Heading', props: { id: '1', text: 'Hi' } }],
      }),
    ).toBe(false);
  });
});
